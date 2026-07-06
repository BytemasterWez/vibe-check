"""Apply ordered SQL migrations from db/migrations.

Applied migrations are recorded (with content hashes) in
public.schema_migrations, so reruns are no-ops and drift is detectable.
Run: python -m scripts.migrate
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import text

from engine.config import MIGRATIONS_DIR
from engine.db import get_engine
from engine.provenance import content_hash


def main() -> int:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text(
            """CREATE TABLE IF NOT EXISTS public.schema_migrations (
                   filename text PRIMARY KEY,
                   content_hash text NOT NULL,
                   applied_at timestamptz NOT NULL DEFAULT now())"""))
        applied = {r.filename: r.content_hash for r in conn.execute(
            text("SELECT filename, content_hash FROM public.schema_migrations"))}

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        sql = path.read_text()
        digest = content_hash(sql.encode())
        if path.name in applied:
            if applied[path.name] != digest:
                print(f"ERROR: {path.name} changed after being applied "
                      f"(recorded {applied[path.name][:12]}, on disk {digest[:12]}). "
                      "Write a new migration instead.", file=sys.stderr)
                return 1
            print(f"skip  {path.name}")
            continue
        with engine.begin() as conn:
            conn.execute(text(sql))
            conn.execute(text(
                "INSERT INTO public.schema_migrations (filename, content_hash) "
                "VALUES (:f, :h)"), {"f": path.name, "h": digest})
        print(f"apply {path.name}")

    # Set the read-only role password out-of-band from the migration file.
    ro_password = os.environ.get("CSE_API_RO_PASSWORD")
    if ro_password:
        with engine.begin() as conn:
            conn.execute(text(
                f"ALTER ROLE countysignal_api_ro WITH PASSWORD '{ro_password}'"))
        print("set   countysignal_api_ro password")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
