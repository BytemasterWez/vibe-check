# Adding a new source

Adding a source touches contracts, one migration, and one adapter package.
It never touches the engine.

## 1. Write the source contract

Create `contracts/sources/<source_id>.yaml` (copy `bls_laus.yaml`).
Confirm — as a human — that the licence permits programmatic access and
that an official API/download exists (no scraping). Set
`status: DOCS_CONFIRMED` once you have.

## 2. Register variables

Add the source's variables to a file under `contracts/variables/` and bind
them in the contract's `variables:` list. A variable that is not registered
cannot be normalised (the normaliser refuses).

## 3. Create the src table

Write a migration `db/migrations/00NN_src_<source_id>.sql` creating
`src.<source_id>` with source-native columns **plus the mandatory
provenance columns** and the uniqueness constraint:

```sql
UNIQUE (source_id, source_record_id, source_row_hash)
```

## 4. Write the adapter

Create `adapters/<provider>/<source>.py`:

```python
class MySourceAdapter(SourceAdapter):
    source_id = "my_source"

    def fetch(self, run_context) -> RawArtifact: ...
    def parse(self, raw_artifact) -> ParsedBatch: ...
    def src_row(self, record) -> dict: ...        # or src_rows() for long tables
```

Rules the base class + runner give you for free: retry with backoff,
raw-artifact hashing and immutable storage, idempotent src/norm loads,
schema-drift detection, join-quality auditing, quarantine routing, sample
mode (`tests/fixtures/<source_id>_sample.*`), dry-run mode, lifecycle
promotion. Your parse method must not join geography — return geography
*hints* (`county_fips`, `geoid`, `state` + `county_name`, …) and let the
join hierarchy do it.

Register the class in `adapters/registry.py` (one line).

## 5. Add a sample fixture and tests

Add a small fixture under `tests/fixtures/` (synthetic or a public sample),
plus a parse test in `tests/unit/test_adapters.py`.

## 6. Run it

```bash
python -m scripts.run_pipeline --source my_source --mode dry_run   # access check
python -m scripts.run_pipeline --source my_source --mode sample    # fixture end-to-end
python -m scripts.run_pipeline --source my_source --mode full      # real data
```

Watch `registry.source_health` and `audit.join_quality`. The source will
not reach `norm.*` until validation passes, and will not affect scores
until the county join rate clears 95%. Fuzzy join candidates appear in
`quarantine.join_candidates` for review; approving one means adding a row
to `ref.geography_aliases` (making it deterministic forever), not editing
data in place.

**Only add a source when it supports a defined event or recipe.** The
rebuild target is not "more data".
