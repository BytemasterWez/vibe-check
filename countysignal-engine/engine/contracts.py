"""Machine-readable contracts: sources, variables, events, recipes, features.

Contracts are the only way anything enters the system. A source without a
contract cannot ingest; a variable not in the dictionary cannot normalise;
an event or recipe not declared in config cannot run.
"""

from __future__ import annotations

import hashlib
from enum import IntEnum
from pathlib import Path
from typing import Any, Literal, Optional

import yaml
from pydantic import BaseModel, Field, model_validator

from engine.config import CONTRACTS_DIR


class SourceStatus(IntEnum):
    """Gated source lifecycle. Order matters: gates compare on it."""

    UNVERIFIED = 0
    DOCS_CONFIRMED = 1
    ACCESS_CONFIRMED = 2
    SAMPLE_CAPTURED = 3
    SCHEMA_MAPPED = 4
    VALIDATION_PASSING = 5
    COUNTY_JOIN_PASSING = 6
    PRODUCTION_ALLOWED = 7
    DISABLED = -1


def can_write_norm(status: SourceStatus) -> bool:
    """A source may not write to norm.* before VALIDATION_PASSING."""
    return status >= SourceStatus.VALIDATION_PASSING


def can_affect_scores(status: SourceStatus) -> bool:
    """A source may not affect scores before COUNTY_JOIN_PASSING."""
    return status >= SourceStatus.COUNTY_JOIN_PASSING


class VariableBinding(BaseModel):
    variable_id: str
    source_field: str


class SourceValidation(BaseModel):
    county_coverage_minimum: int = 0
    allow_missing_counties: bool = True
    required_time_parse: bool = True
    numeric_fields: list[str] = Field(default_factory=list)
    bounds: dict[str, list[Optional[float]]] = Field(default_factory=dict)


class SourceContract(BaseModel):
    source_id: str
    name: str
    owner: str
    category: str
    access_method: str
    access_url: Optional[str] = None
    download_url: Optional[str] = None
    # Optional second official access path for full-history backfills
    # (e.g. BLS LAUS time-series flat files). Selected per run via
    # --param dataset=historical; same licence and validation rules apply.
    historical_url: Optional[str] = None
    licence_status: str
    attribution: Optional[str] = None
    scraping_allowed: bool = False
    api_key_required: bool = False
    update_frequency: Optional[str] = None
    geography_level: str
    time_grain: Literal["month", "quarter", "year", "static"]
    canonical_join_key: str = "county_fips"
    raw_format: Optional[str] = None
    src_table: Optional[str] = None
    normalised_tables: list[str] = Field(default_factory=list)
    required_fields: list[str] = Field(default_factory=list)
    field_map: dict[str, str] = Field(default_factory=dict)
    api_params: dict[str, Any] = Field(default_factory=dict)
    variables: list[VariableBinding] = Field(default_factory=list)
    validation: SourceValidation = Field(default_factory=SourceValidation)
    provenance_required: bool = True
    production_allowed: bool = False
    status: str = "UNVERIFIED"

    raw_yaml: str = Field(default="", exclude=True)

    @model_validator(mode="after")
    def no_scraping_access_method(self) -> "SourceContract":
        # Design rule 1: no scraping unless the source terms explicitly permit
        # it. Scraping access methods are rejected outright unless the
        # contract also carries scraping_allowed: true.
        if self.access_method in {"scrape", "scraping", "html_scrape"} and not self.scraping_allowed:
            raise ValueError(
                f"access_method '{self.access_method}' requires "
                "scraping_allowed: true in the contract"
            )
        return self

    @property
    def status_enum(self) -> SourceStatus:
        return SourceStatus[self.status]

    @property
    def contract_hash(self) -> str:
        return hashlib.sha256(self.raw_yaml.encode()).hexdigest()

    @property
    def source_version(self) -> str:
        return self.contract_hash[:12]


class EventCondition(BaseModel):
    transform: str
    operator: Literal[">=", "<=", ">", "<", "=="]
    threshold: float


class CaseControlConfig(BaseModel):
    control_strategy: str = "same_period_non_event"
    exclusions: list[dict] = Field(default_factory=list)
    max_controls_per_case: int = 10


class EventContract(BaseModel):
    event_id: str
    description: str = ""
    base_variable: str
    condition: EventCondition
    time_grain: Literal["month", "quarter", "year"]
    minimum_history_months: int = 0
    case_control: CaseControlConfig = Field(default_factory=CaseControlConfig)

    raw_yaml: str = Field(default="", exclude=True)

    @property
    def config_hash(self) -> str:
        return hashlib.sha256(self.raw_yaml.encode()).hexdigest()


class RecipeFeatures(BaseModel):
    include_categories: list[str] = Field(default_factory=list)
    include_features: list[str] = Field(default_factory=list)
    exclude_features: list[str] = Field(default_factory=list)


class RecipeModel(BaseModel):
    type: str = "logistic_regression"
    compare_against: list[str] = Field(default_factory=list)


class RecipeContract(BaseModel):
    recipe_id: str
    name: str
    description: str = ""
    event_id: str
    features: RecipeFeatures = Field(default_factory=RecipeFeatures)
    model: RecipeModel = Field(default_factory=RecipeModel)
    outputs: list[str] = Field(default_factory=list)
    api_exposed: bool = False

    raw_yaml: str = Field(default="", exclude=True)


class VariableContract(BaseModel):
    variable_id: str
    source_id: str
    name: str
    description: Optional[str] = None
    unit: str
    time_grain: Literal["month", "quarter", "year", "static"]
    geography_grain: str = "county"
    directionality: Optional[str] = None
    higher_is_good: Optional[bool] = None
    transform_allowed: bool = True
    source_field: Optional[str] = None
    normalisation_method: Optional[str] = None
    missing_value_policy: str = "null"
    first_available_period: Optional[str] = None
    latest_available_period: Optional[str] = None


class FeatureSet(BaseModel):
    variables: list[str]
    transforms: list[str]


class FeatureConfig(BaseModel):
    feature_sets: list[FeatureSet]
    defaults: dict[str, Any] = Field(default_factory=dict)

    def expand(self) -> list[dict]:
        """Expand to concrete feature definitions: one per (variable, transform)."""
        out = []
        for fs in self.feature_sets:
            for var in fs.variables:
                for transform in fs.transforms:
                    out.append(
                        {
                            "feature_id": f"{var}__{transform}",
                            "variable_id": var,
                            "transform": transform,
                            "params": dict(self.defaults),
                        }
                    )
        return out


# ---------------------------------------------------------------------------
# Loaders

def _load_yaml(path: Path) -> tuple[dict, str]:
    raw = path.read_text()
    return yaml.safe_load(raw), raw


def load_source_contract(path: Path) -> SourceContract:
    data, raw = _load_yaml(path)
    contract = SourceContract(**data)
    contract.raw_yaml = raw
    return contract


def load_source_contracts(directory: Path | None = None) -> dict[str, SourceContract]:
    directory = directory or CONTRACTS_DIR / "sources"
    out: dict[str, SourceContract] = {}
    for path in sorted(directory.glob("*.yaml")):
        c = load_source_contract(path)
        if c.source_id in out:
            raise ValueError(f"duplicate source_id {c.source_id} in {path}")
        out[c.source_id] = c
    return out


def load_event_contract(path: Path) -> EventContract:
    data, raw = _load_yaml(path)
    contract = EventContract(**data)
    contract.raw_yaml = raw
    return contract


def load_event_contracts(directory: Path | None = None) -> dict[str, EventContract]:
    directory = directory or CONTRACTS_DIR / "events"
    out: dict[str, EventContract] = {}
    for path in sorted(directory.glob("*.yaml")):
        c = load_event_contract(path)
        out[c.event_id] = c
    return out


def load_recipe_contract(path: Path) -> RecipeContract:
    data, raw = _load_yaml(path)
    contract = RecipeContract(**data)
    contract.raw_yaml = raw
    return contract


def load_recipe_contracts(directory: Path | None = None) -> dict[str, RecipeContract]:
    directory = directory or CONTRACTS_DIR / "recipes"
    out: dict[str, RecipeContract] = {}
    for path in sorted(directory.glob("*.yaml")):
        c = load_recipe_contract(path)
        out[c.recipe_id] = c
    return out


def load_variable_contracts(directory: Path | None = None) -> dict[str, VariableContract]:
    directory = directory or CONTRACTS_DIR / "variables"
    out: dict[str, VariableContract] = {}
    for path in sorted(directory.glob("*.yaml")):
        data, _ = _load_yaml(path)
        for entry in data.get("variables", []):
            v = VariableContract(**entry)
            if v.variable_id in out:
                raise ValueError(f"duplicate variable_id {v.variable_id} in {path}")
            out[v.variable_id] = v
    return out


def load_feature_config(path: Path | None = None) -> FeatureConfig:
    path = path or CONTRACTS_DIR / "features" / "default_features.yaml"
    data, _ = _load_yaml(path)
    return FeatureConfig(**data)
