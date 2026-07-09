"""Transform a raw OCDS release into a canonical notice record.

Deterministic only — no LLM involvement anywhere in the data path.
Field mapping documented in docs/SCHEMA.md.
"""
import hashlib
import json
from datetime import datetime, timezone


def payload_hash(release: dict) -> str:
    return hashlib.sha256(
        json.dumps(release, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def parse_date(value: str | None) -> datetime | None:
    """OCDS dates arrive as ISO 8601 with offset ('+01:00'), 'Z', or date-only."""
    if not value or not isinstance(value, str):
        return None
    raw = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def parse_amount(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "").replace("£", "").strip())
    except ValueError:
        return None


def clean_text(value) -> str:
    if not value:
        return ""
    return " ".join(str(value).split())


def _regions(release: dict) -> list[str]:
    found: set[str] = set()
    tender = release.get("tender") or {}
    for item in tender.get("items") or []:
        for addr in item.get("deliveryAddresses") or []:
            if addr.get("region"):
                found.add(clean_text(addr["region"]))
        addr = item.get("deliveryAddress") or {}
        if addr.get("region"):
            found.add(clean_text(addr["region"]))
    for party in release.get("parties") or []:
        if "buyer" in (party.get("roles") or []):
            region = (party.get("address") or {}).get("region")
            if region:
                found.add(clean_text(region))
    return sorted(found)


def _cpv(release: dict) -> tuple[list[str], list[str]]:
    tender = release.get("tender") or {}
    codes, descs = [], []
    main = tender.get("classification") or {}
    if main.get("id"):
        codes.append(str(main["id"]))
        descs.append(clean_text(main.get("description")))
    for extra in tender.get("additionalClassifications") or []:
        if extra.get("id") and str(extra["id"]) not in codes:
            codes.append(str(extra["id"]))
            descs.append(clean_text(extra.get("description")))
    return codes, descs


def _buyer(release: dict) -> tuple[str, str]:
    buyer = release.get("buyer") or {}
    if buyer.get("name"):
        return clean_text(buyer["name"]), str(buyer.get("id") or "")
    for party in release.get("parties") or []:
        if "buyer" in (party.get("roles") or []):
            return clean_text(party.get("name")), str(party.get("id") or "")
    return "", ""


def _values(tender: dict) -> tuple[float | None, float | None, float | None, str]:
    value = tender.get("value") or {}
    min_v = tender.get("minValue") or {}
    max_v = tender.get("maxValue") or {}
    amount = parse_amount(value.get("amount"))
    amount_min = parse_amount(min_v.get("amount"))
    amount_max = parse_amount(max_v.get("amount"))
    currency = value.get("currency") or min_v.get("currency") or max_v.get("currency") or ""
    if amount is None and amount_min is not None and amount_max is not None:
        amount = (amount_min + amount_max) / 2
    return amount, amount_min, amount_max, currency


def normalise_release(release: dict, source_name: str, source_url: str) -> dict:
    """Return a dict matching the Notice canonical schema (unvalidated)."""
    tender = release.get("tender") or {}
    suitability = tender.get("suitability") or {}
    cpv_codes, cpv_descs = _cpv(release)
    buyer_name, buyer_id = _buyer(release)
    amount, amount_min, amount_max, currency = _values(tender)
    tags = release.get("tag") or []

    return {
        "source_name": source_name,
        "source_url": source_url,
        "ocid": clean_text(release.get("ocid")),
        "release_id": clean_text(release.get("id")),
        "notice_type": tags[0] if tags else "",
        "status": clean_text(tender.get("status")),
        "title": clean_text(tender.get("title")),
        "description": clean_text(tender.get("description")),
        "buyer_name": buyer_name,
        "buyer_id": buyer_id,
        "cpv_codes": cpv_codes,
        "cpv_descriptions": cpv_descs,
        "procurement_category": clean_text(tender.get("mainProcurementCategory")),
        "value_amount": amount,
        "value_min": amount_min,
        "value_max": amount_max,
        "value_currency": currency,
        "published_date": parse_date(tender.get("datePublished") or release.get("date")),
        "deadline_date": parse_date((tender.get("tenderPeriod") or {}).get("endDate")),
        "contract_start": parse_date((tender.get("contractPeriod") or {}).get("startDate")),
        "contract_end": parse_date((tender.get("contractPeriod") or {}).get("endDate")),
        "regions": _regions(release),
        "sme_suitable": suitability.get("sme"),
        "vcse_suitable": suitability.get("vcse"),
        "raw_payload_hash": payload_hash(release),
    }
