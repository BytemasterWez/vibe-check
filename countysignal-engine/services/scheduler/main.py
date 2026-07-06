"""Scheduler: enqueues ingestion jobs based on each source contract's
update_frequency, then the downstream pipeline stages. Schedules come from
contracts — nothing here is source-specific.
"""

from __future__ import annotations

import json
import logging
import time

import redis

from engine.config import get_settings
from engine.contracts import load_recipe_contracts, load_source_contracts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("cse.scheduler")

QUEUE = "cse:jobs"
CHECK_INTERVAL_S = 3600

FREQUENCY_SECONDS = {
    "hourly": 3600,
    "daily": 86400,
    "weekly": 7 * 86400,
    "monthly": 30 * 86400,
    "quarterly": 91 * 86400,
    "annual": 365 * 86400,
}


def main() -> None:
    settings = get_settings()
    r = redis.from_url(settings.redis_url)
    logger.info("scheduler ready")
    while True:
        contracts = load_source_contracts()   # reloaded each tick: config is live
        now = time.time()
        for source_id, contract in contracts.items():
            interval = FREQUENCY_SECONDS.get(contract.update_frequency or "", 0)
            if not interval:
                continue
            key = f"cse:last_ingest:{source_id}"
            last = float(r.get(key) or 0)
            if now - last >= interval:
                r.rpush(QUEUE, json.dumps({"type": "ingest", "source_id": source_id,
                                           "mode": "full"}))
                r.set(key, now)
                logger.info("enqueued ingest for %s", source_id)

        # Refresh features + recipe scores daily after ingestion windows.
        key = "cse:last_pipeline"
        if now - float(r.get(key) or 0) >= 86400:
            r.rpush(QUEUE, json.dumps({"type": "features"}))
            for recipe_id, recipe in load_recipe_contracts().items():
                r.rpush(QUEUE, json.dumps({"type": "event", "event_id": recipe.event_id}))
                r.rpush(QUEUE, json.dumps({"type": "scoring", "recipe_id": recipe_id}))
            r.set(key, now)
            logger.info("enqueued daily feature/event/scoring refresh")

        time.sleep(CHECK_INTERVAL_S)


if __name__ == "__main__":
    main()
