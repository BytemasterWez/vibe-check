"""Polite HTTP layer. Every fetch:
  - identifies the operator in the User-Agent,
  - rate-limits per host,
  - honours robots.txt for crawl-type access,
  - archives the raw response under data/raw/ (evidence trail),
  - classifies failures so the verifier can distinguish a source-side block
    (CAPTCHA/403 from the origin) from a runner-side block (egress policy).

Never add CAPTCHA-solving, session spoofing, or header camouflage here —
if a source needs those, its status is BLOCKED or VERIFIED_BROWSER_SESSION
/ VERIFIED_MANUAL_ONLY and it stays out of cron ingestion.
"""

import hashlib
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

from . import RAW_DIR
from .registry import operator

_last_request_at: dict[str, float] = {}
_robots_cache: dict[str, urllib.robotparser.RobotFileParser] = {}

CAPTCHA_MARKERS = ("captcha", "recaptcha", "hcaptcha", "cf-challenge",
                   "are you a robot", "unusual traffic")


class FetchResult:
    def __init__(self, url, status_code=None, ok=False, outcome="error",
                 content_type="", body=b"", error="", raw_path=""):
        self.url = url
        self.status_code = status_code
        self.ok = ok
        # outcome: ok | http_error | origin_blocked | captcha_suspected |
        #          runner_network_blocked | robots_disallowed | error
        self.outcome = outcome
        self.content_type = content_type
        self.body = body
        self.error = error
        self.raw_path = raw_path

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def summary(self) -> dict:
        return {"url": self.url, "status_code": self.status_code,
                "outcome": self.outcome, "content_type": self.content_type,
                "bytes": len(self.body), "error": self.error,
                "raw_path": self.raw_path}


def _throttle(host: str, min_interval: float):
    waited = time.monotonic() - _last_request_at.get(host, 0)
    if waited < min_interval:
        time.sleep(min_interval - waited)
    _last_request_at[host] = time.monotonic()


def _robots_allows(url: str, user_agent: str) -> bool:
    host = urlparse(url).netloc
    if host not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{urlparse(url).scheme}://{host}/robots.txt")
        try:
            rp.read()
        except Exception:
            rp = None  # robots unreachable: treat as allowed, origin decides
        _robots_cache[host] = rp
    rp = _robots_cache[host]
    return True if rp is None else rp.can_fetch(user_agent, url)


def _archive(url: str, body: bytes) -> str:
    digest = hashlib.sha256(url.encode()).hexdigest()[:16]
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = RAW_DIR / day / f"{urlparse(url).netloc}_{digest}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    (path.with_suffix(".meta")).write_text(
        f"url: {url}\nfetched_at: {datetime.now(timezone.utc).isoformat()}\n",
        encoding="utf-8")
    return str(path)


def fetch(url: str, check_robots: bool = True, timeout: int = 30,
          archive: bool = True) -> FetchResult:
    op = operator()
    ua = op["user_agent"]
    if op.get("respect_robots_txt", True) and check_robots:
        if not _robots_allows(url, ua):
            return FetchResult(url, outcome="robots_disallowed",
                               error="disallowed by robots.txt")
    _throttle(urlparse(url).netloc, op.get("min_seconds_between_requests", 5))
    try:
        resp = requests.get(url, headers={"User-Agent": ua}, timeout=timeout)
    except requests.exceptions.ProxyError as exc:
        return FetchResult(url, outcome="runner_network_blocked", error=str(exc))
    except requests.exceptions.ConnectionError as exc:
        text = str(exc)
        outcome = ("runner_network_blocked"
                   if "403" in text or "CONNECT" in text.upper() or "tunnel" in text.lower()
                   else "error")
        return FetchResult(url, outcome=outcome, error=text)
    except requests.exceptions.RequestException as exc:
        return FetchResult(url, outcome="error", error=str(exc))

    body = resp.content
    lowered = body[:20000].decode("utf-8", errors="replace").lower()
    captcha = any(m in lowered for m in CAPTCHA_MARKERS)
    outcome = "ok"
    if resp.status_code in (401, 403, 429):
        outcome = "origin_blocked"
    elif resp.status_code >= 400:
        outcome = "http_error"
    if captcha:
        outcome = "captcha_suspected"
    raw_path = _archive(url, body) if archive and body else ""
    return FetchResult(url, resp.status_code, outcome == "ok", outcome,
                       resp.headers.get("Content-Type", ""), body,
                       raw_path=raw_path)
