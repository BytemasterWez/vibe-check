from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..adapters.mock_adapter import MOCK_SCENARIOS
from ..config import settings
from ..worker import runtime

router = APIRouter(prefix="/mock", tags=["mock"])


class MockScenarioBody(BaseModel):
    scenario: str = "empty_bed"
    speed: str = "realtime"
    csv_file: str | None = None


@router.post("/start")
def start_mock():
    if not settings.enable_mock_sensor:
        raise HTTPException(403, "Mock sensor is disabled (ENABLE_MOCK_SENSOR=false)")
    return runtime.start_mock(scenario=runtime.scenario or "empty_bed", speed=runtime.speed)


@router.post("/stop")
def stop_mock():
    return runtime.stop_mock()


@router.post("/scenario")
def set_scenario(body: MockScenarioBody):
    if not settings.enable_mock_sensor:
        raise HTTPException(403, "Mock sensor is disabled (ENABLE_MOCK_SENSOR=false)")
    try:
        return runtime.start_mock(scenario=body.scenario, speed=body.speed, csv_file=body.csv_file)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc))


@router.get("/status")
def mock_status():
    return {**runtime.status(), "available_scenarios": MOCK_SCENARIOS + ["csv_replay"]}
