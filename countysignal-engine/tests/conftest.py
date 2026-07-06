from __future__ import annotations

import csv

import pytest

from engine.config import SEEDS_DIR
from engine.contracts import (
    load_event_contracts,
    load_recipe_contracts,
    load_source_contracts,
    load_variable_contracts,
)
from engine.ingestion.sink import MemorySink
from engine.normalisation.geography import CountyIndex


def _read_csv(path):
    with path.open() as fh:
        return list(csv.DictReader(fh))


@pytest.fixture(scope="session")
def counties():
    return _read_csv(SEEDS_DIR / "counties_fixture.csv")


@pytest.fixture(scope="session")
def aliases():
    return _read_csv(SEEDS_DIR / "geography_aliases.csv")


@pytest.fixture(scope="session")
def crosswalks():
    return _read_csv(SEEDS_DIR / "fips_crosswalks.csv")


@pytest.fixture(scope="session")
def county_index(counties, aliases, crosswalks):
    return CountyIndex.build(counties, aliases, crosswalks)


@pytest.fixture(scope="session")
def source_contracts():
    return load_source_contracts()


@pytest.fixture(scope="session")
def variable_contracts():
    return load_variable_contracts()


@pytest.fixture(scope="session")
def event_contracts():
    return load_event_contracts()


@pytest.fixture(scope="session")
def recipe_contracts():
    return load_recipe_contracts()


@pytest.fixture
def memory_sink(counties, aliases, crosswalks):
    return MemorySink(counties=counties, aliases=aliases, crosswalks=crosswalks)
