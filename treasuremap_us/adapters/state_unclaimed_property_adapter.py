"""State unclaimed property, business/entity claimants only — PHASE 2.

Per-state portals vary: some offer bulk downloads (VERIFIED_DOWNLOAD),
most are search forms, several sit behind CAPTCHA (BLOCKED). Each state
gets its own registry entry when activated; start with tier-1 states in
config/states.yaml. Recovery-fee caps in states.yaml gate monetisation.
"""

from .base import BaseAdapter


class StateUnclaimedPropertyAdapter(BaseAdapter):
    source_id = "state_unclaimed_property"  # placeholder; per-state ids at activation

    def fetch_live(self):
        raise NotImplementedError("PHASE 2 — activate per-state after verification")
