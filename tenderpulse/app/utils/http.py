"""HTTP fetch with retry/backoff. Both government APIs are unauthenticated JSON."""
import logging
import time

import requests

from .. import config

log = logging.getLogger("tenderpulse.http")


class SourceUnavailable(Exception):
    """Raised when a source cannot be reached after all retries."""


def get_json(url: str, params: dict | None = None) -> dict:
    last_err: Exception | None = None
    for attempt in range(config.HTTP_RETRIES):
        try:
            resp = requests.get(
                url,
                params=params,
                timeout=config.HTTP_TIMEOUT,
                headers={"Accept": "application/json", "User-Agent": "TenderPulse/0.1"},
            )
            if resp.status_code == 429 or resp.status_code >= 500:
                raise SourceUnavailable(f"HTTP {resp.status_code} from {resp.url}")
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, SourceUnavailable, ValueError) as err:
            last_err = err
            wait = 2**attempt
            log.warning("fetch failed (%s), retry in %ss: %s", attempt + 1, wait, err)
            time.sleep(wait)
    raise SourceUnavailable(f"giving up on {url}: {last_err}")
