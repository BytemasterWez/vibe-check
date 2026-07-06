from engine.normalisation.geography import (
    MATCH_ALIAS,
    MATCH_CANDIDATE_FUZZY,
    MATCH_CROSSWALK,
    MATCH_EXACT_FIPS,
    MATCH_EXACT_GEOID,
    MATCH_EXACT_NAME,
    NO_MATCH,
    join_county,
    join_quality_report,
    normalise_name,
    valid_county_fips,
)


def test_valid_county_fips():
    assert valid_county_fips("22103")
    assert not valid_county_fips("2210")
    assert not valid_county_fips("2210a")
    assert not valid_county_fips(None)


def test_normalise_name_variants():
    assert normalise_name("St. Tammany Parish") == "st tammany"
    assert normalise_name("Saint Tammany") == "st tammany"
    assert normalise_name("Doña Ana County") == "dona ana"
    assert normalise_name("Oglala Lakota County") == "oglala lakota"
    assert normalise_name("Alexandria city") == "alexandria"


def test_join_hierarchy_exact_fips(county_index):
    r = join_county(county_index, county_fips="22103")
    assert (r.county_fips, r.method) == ("22103", MATCH_EXACT_FIPS)
    assert r.authoritative


def test_join_hierarchy_state_plus_part(county_index):
    r = join_county(county_index, state_fips="22", county_fips_part="103")
    assert (r.county_fips, r.method) == ("22103", MATCH_EXACT_FIPS)


def test_join_hierarchy_geoid(county_index):
    r = join_county(county_index, geoid="0500000US22103")
    assert (r.county_fips, r.method) == ("22103", MATCH_EXACT_GEOID)


def test_join_hierarchy_crosswalk(county_index):
    # Shannon County SD (46113) was renamed Oglala Lakota (46102) in 2015.
    r = join_county(county_index, county_fips="46113")
    assert (r.county_fips, r.method) == ("46102", MATCH_CROSSWALK)
    assert r.authoritative


def test_join_hierarchy_exact_name(county_index):
    r = join_county(county_index, state="LA", county_name="St. Tammany Parish")
    assert (r.county_fips, r.method) == ("22103", MATCH_EXACT_NAME)
    # name matching requires a state — same name exists in many states
    r2 = join_county(county_index, state="AL", county_name="Jefferson County")
    assert r2.county_fips == "01073"
    r3 = join_county(county_index, state="22", county_name="Jefferson Parish")
    assert r3.county_fips == "22051"


def test_join_hierarchy_alias(county_index):
    r = join_county(county_index, state="NY", county_name="Brooklyn")
    assert (r.county_fips, r.method) == ("36047", MATCH_ALIAS)
    assert r.authoritative


def test_join_hierarchy_fuzzy_is_not_authoritative(county_index):
    r = join_county(county_index, state="LA", county_name="St. Tammny Prish")  # typos
    assert r.method == MATCH_CANDIDATE_FUZZY
    assert r.county_fips == "22103"
    assert not r.authoritative, "fuzzy joins must never be authoritative"
    assert r.candidate_score is not None


def test_join_no_match(county_index):
    r = join_county(county_index, state="LA", county_name="Completely Unknown Zone")
    assert r.method == NO_MATCH
    assert r.county_fips is None


def test_join_quality_report(county_index):
    results = [
        join_county(county_index, county_fips="22103"),
        join_county(county_index, county_fips="48201"),
        join_county(county_index, state="LA", county_name="Nowhere"),
    ]
    report = join_quality_report(results)
    assert report["total_records"] == 3
    assert report["matched"] == 2
    assert 0.66 < report["match_rate"] < 0.67
    assert report["by_confidence"][MATCH_EXACT_FIPS] == 2
    assert len(report["unmatched_sample"]) == 1
