"""Federal/state court registry funds and condemnation awards — PHASE 4.

Federal district court registry funds (CRIS) and eminent-domain deposits
where the landowner never withdrew the award. Discovery is docket-driven
(PACER is a paid API: VERIFIED_PAID_API) — design the PACER cost budget
before activation."""

from .base import BaseAdapter


class CourtRegistryFundsAdapter(BaseAdapter):
    source_id = "court_registry_funds"

    def fetch_live(self):
        raise NotImplementedError("PHASE 4 — activate after verification")
