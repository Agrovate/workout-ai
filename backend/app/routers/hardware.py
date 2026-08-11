"""
Hardware router — receives completed set data from the mobile app after BLE sync.

The barbell clip sends rep count and velocity telemetry over BLE; the mobile app
collects it, lets the user confirm weight and RPE, then POSTs the combined payload
here.  The rep count from hardware is authoritative (not user-entered).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WorkoutSession, WorkoutSet

router = APIRouter(prefix="/hardware", tags=["hardware"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class HardwareSetIn(BaseModel):
    session_id: int
    exercise_id: int
    set_order: int
    weight: float | None = None         # user fills this in on the phone
    reps: int                            # authoritative from hardware rep counter
    rpe: float | None = None             # user fills this in on the phone
    avg_velocity_mm_s: int = Field(ge=0)
    peak_velocity_mm_s: int = Field(ge=0)
    velocity_loss_pct: int = Field(ge=0, le=100)
    set_duration_s: int = Field(ge=0)
    notes: str | None = None


class HardwareSetOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    session_id: int
    exercise_id: int
    set_order: int
    weight: float | None
    reps: int | None
    rpe: float | None
    avg_velocity_mm_s: int | None
    peak_velocity_mm_s: int | None
    velocity_loss_pct: int | None
    source: str | None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/sets", response_model=HardwareSetOut, status_code=201)
def ingest_hardware_set(payload: HardwareSetIn, db: Session = Depends(get_db)):
    """
    Receive a completed set from the mobile app after BLE sync with the barbell clip.
    """
    session = db.get(WorkoutSession, payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Workout session not found")

    workout_set = WorkoutSet(
        session_id=payload.session_id,
        exercise_id=payload.exercise_id,
        set_order=payload.set_order,
        weight=payload.weight,
        reps=payload.reps,
        rpe=payload.rpe,
        avg_velocity_mm_s=payload.avg_velocity_mm_s,
        peak_velocity_mm_s=payload.peak_velocity_mm_s,
        velocity_loss_pct=payload.velocity_loss_pct,
        notes=payload.notes,
        source="hardware",
    )
    db.add(workout_set)
    db.commit()
    db.refresh(workout_set)
    return workout_set


@router.get("/sets/{session_id}", response_model=list[HardwareSetOut])
def get_hardware_sets(session_id: int, db: Session = Depends(get_db)):
    """
    Return all hardware-sourced sets for a session (for the review screen).
    """
    stmt = select(WorkoutSet).where(
        WorkoutSet.session_id == session_id,
        WorkoutSet.source == "hardware",
    ).order_by(WorkoutSet.set_order)
    return db.scalars(stmt).all()
