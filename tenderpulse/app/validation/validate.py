"""Validation gate between normalisation and storage.

A record either passes cleanly or goes to quarantine with an explicit reason —
nothing is silently dropped or silently "fixed".
"""
from datetime import datetime, timedelta


class ValidationError(Exception):
    pass


REQUIRED_FIELDS = ("ocid", "title", "source_name")

# Sanity bounds: government tenders outside these dates are data errors.
MIN_PLAUSIBLE_DATE = datetime(2000, 1, 1)
MAX_PLAUSIBLE_YEARS_AHEAD = 15


def validate_notice(record: dict, now: datetime | None = None) -> list[str]:
    """Return a list of failure reasons; empty list means the record is valid."""
    now = now or datetime.utcnow()
    problems: list[str] = []

    for field in REQUIRED_FIELDS:
        if not record.get(field):
            problems.append(f"missing required field: {field}")

    if record.get("ocid") and not str(record["ocid"]).startswith("ocds-"):
        problems.append(f"ocid does not look like an OCDS identifier: {record['ocid']}")

    max_future = now + timedelta(days=365 * MAX_PLAUSIBLE_YEARS_AHEAD)
    for field in ("published_date", "deadline_date", "contract_start", "contract_end"):
        value = record.get(field)
        if value is None:
            continue
        if not isinstance(value, datetime):
            problems.append(f"{field} is not a datetime: {value!r}")
        elif value < MIN_PLAUSIBLE_DATE or value > max_future:
            problems.append(f"{field} outside plausible range: {value.isoformat()}")

    if record.get("published_date") and record["published_date"] > now + timedelta(days=2):
        problems.append("published_date is in the future")

    for field in ("value_amount", "value_min", "value_max"):
        value = record.get(field)
        if value is not None and value < 0:
            problems.append(f"{field} is negative: {value}")

    return problems
