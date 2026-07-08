import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Sensor
from ..schemas.sensor_schema import SensorCreate, SensorOut, SensorUpdate

router = APIRouter(prefix="/sensors", tags=["sensors"])


@router.get("", response_model=list[SensorOut])
def list_sensors(db: Session = Depends(get_db)):
    return db.execute(select(Sensor).order_by(Sensor.created_at)).scalars().all()


@router.post("", response_model=SensorOut, status_code=201)
def create_sensor(payload: SensorCreate, db: Session = Depends(get_db)):
    sensor = Sensor(**payload.model_dump())
    db.add(sensor)
    db.commit()
    db.refresh(sensor)
    return sensor


@router.get("/{sensor_id}", response_model=SensorOut)
def get_sensor(sensor_id: uuid.UUID, db: Session = Depends(get_db)):
    sensor = db.get(Sensor, sensor_id)
    if not sensor:
        raise HTTPException(404, "Sensor not found")
    return sensor


@router.patch("/{sensor_id}", response_model=SensorOut)
def update_sensor(sensor_id: uuid.UUID, payload: SensorUpdate, db: Session = Depends(get_db)):
    sensor = db.get(Sensor, sensor_id)
    if not sensor:
        raise HTTPException(404, "Sensor not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(sensor, key, value)
    db.commit()
    db.refresh(sensor)
    return sensor
