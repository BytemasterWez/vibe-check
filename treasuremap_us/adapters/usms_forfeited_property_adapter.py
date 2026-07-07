"""U.S. Marshals Service forfeited real property (PHASE 2 of the asset
engine — registered now so verification runs from day one).

Access model (research, pending programmatic verification):
  - usmarshals.gov/what-we-do/asset-forfeiture/real-property describes the
    programme; live sales largely run through the Bid4Assets USMS
    storefront (bid4assets.com/storefront/usms).
  - Bid4Assets requires an account to BID; whether listing BROWSING is
    accessible without a session must be verified. Expected status:
    VERIFIED_HTML_INDEX (best case) or VERIFIED_BROWSER_SESSION /
    VERIFIED_MANUAL_ONLY. Do not create accounts programmatically.
"""

from core.registry import effective_status

from .base import BaseAdapter


class USMSForfeitedPropertyAdapter(BaseAdapter):
    source_id = "usms_forfeited_rp"

    def looks_valid(self, result) -> bool:
        text = result.text.lower()
        return "forfeit" in text and len(result.body) > 500

    def fetch_live(self) -> list[dict]:
        raise NotImplementedError(
            "usms_forfeited_rp is PHASE 2 and unverified. "
            f"Current effective status: {effective_status(self.source_id)}")
