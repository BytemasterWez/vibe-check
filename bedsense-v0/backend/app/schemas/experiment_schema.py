import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from ..models.experiment import PASS_FAIL, SCENARIOS
from ..models.risk import RISK_CATEGORIES, RISK_STATUSES


class ExperimentStart(BaseModel):
    name: str
    scenario: str = "manual_test"
    operator_name: str | None = None
    notes: str | None = None
    expected_events: list[str] | None = None

    @field_validator("scenario")
    @classmethod
    def validate_scenario(cls, v: str) -> str:
        if v not in SCENARIOS:
            raise ValueError(f"scenario must be one of {SCENARIOS}")
        return v


class ExperimentAssess(BaseModel):
    pass_fail: str
    notes: str | None = None
    actual_results: dict[str, Any] | None = None

    @field_validator("pass_fail")
    @classmethod
    def validate_pass_fail(cls, v: str) -> str:
        if v not in PASS_FAIL:
            raise ValueError(f"pass_fail must be one of {PASS_FAIL}")
        return v


class ExperimentMark(BaseModel):
    title: str = "Manual marker"
    description: str | None = None


class ExperimentOut(BaseModel):
    id: uuid.UUID
    name: str
    scenario: str
    operator_name: str | None
    started_at: datetime
    ended_at: datetime | None
    notes: str | None
    expected_events: list[Any] | None
    actual_results: dict[str, Any] | None
    pass_fail: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RiskCreate(BaseModel):
    risk_title: str
    risk_category: str = "technical"
    description: str | None = None
    possible_cause: str | None = None
    impact: str | None = None
    mitigation: str | None = None
    status: str = "open"

    @field_validator("risk_category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        if v not in RISK_CATEGORIES:
            raise ValueError(f"risk_category must be one of {RISK_CATEGORIES}")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in RISK_STATUSES:
            raise ValueError(f"status must be one of {RISK_STATUSES}")
        return v


class RiskUpdate(BaseModel):
    risk_title: str | None = None
    risk_category: str | None = None
    description: str | None = None
    possible_cause: str | None = None
    impact: str | None = None
    mitigation: str | None = None
    status: str | None = None

    @field_validator("risk_category")
    @classmethod
    def validate_category(cls, v: str | None) -> str | None:
        if v is not None and v not in RISK_CATEGORIES:
            raise ValueError(f"risk_category must be one of {RISK_CATEGORIES}")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in RISK_STATUSES:
            raise ValueError(f"status must be one of {RISK_STATUSES}")
        return v


class RiskOut(BaseModel):
    id: uuid.UUID
    risk_title: str
    risk_category: str
    description: str | None
    possible_cause: str | None
    impact: str | None
    mitigation: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReportOut(BaseModel):
    id: uuid.UUID
    name: str
    session_id: uuid.UUID | None
    markdown_path: str | None
    csv_paths: dict[str, Any] | None
    json_path: str | None
    summary: dict[str, Any] | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MockScenarioRequest(BaseModel):
    scenario: str
    speed: str = "realtime"

    @field_validator("speed")
    @classmethod
    def validate_speed(cls, v: str) -> str:
        if v not in ("realtime", "fast"):
            raise ValueError("speed must be 'realtime' or 'fast'")
        return v
