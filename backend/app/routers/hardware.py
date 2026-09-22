"""
Hardware router — receives completed set data from the mobile app after BLE sync.

WorkoutBand, a wrist/forearm-worn IMU + PPG sensor, sends rep count and
velocity telemetry (plus, when its onboard heart-rate sensor has a confident
reading, per-set HR) over BLE; the mobile app collects it, lets the user
confirm weight and RPE, then POSTs the combined payload here.  The rep count
from hardware is authoritative (not user-entered).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WorkoutSession, WorkoutSet
from app.schemas import SessionHealthUpdate

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
    # From WorkoutBand's onboard PPG sensor during the set (omitted, not
    # zeroed, when signal quality was too low to trust — see hr.cpp).
    avg_hr_bpm: int | None = Field(default=None, ge=0)
    peak_hr_bpm: int | None = Field(default=None, ge=0)


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
    avg_hr_bpm: int | None
    peak_hr_bpm: int | None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/sets", response_model=HardwareSetOut, status_code=201)
def ingest_hardware_set(payload: HardwareSetIn, db: Session = Depends(get_db)):
    """
    Receive a completed set from the mobile app after BLE sync with WorkoutBand.
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
        avg_hr_bpm=payload.avg_hr_bpm,
        peak_hr_bpm=payload.peak_hr_bpm,
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


@router.patch("/session/{session_id}", status_code=200)
def attach_hardware_readiness(
    session_id: int,
    payload: SessionHealthUpdate,
    db: Session = Depends(get_db),
):
    """
    Attach HRV/resting-HR readiness data captured by WorkoutBand's onboard PPG
    sensor (worn continuously through the workout, unlike Apple Watch which
    is queried after the fact) to an existing session.

    Same fields as POST /healthkit/session/{id}, different source — there's
    no per-field provenance tracking, so whichever endpoint the mobile app
    calls last for a session wins. Fine for single-user local dev; revisit
    if HealthKit and WorkoutBand readings ever need to coexist per-session.
    """
    session = db.get(WorkoutSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if payload.started_at is not None:
        session.started_at = payload.started_at
    if payload.ended_at is not None:
        session.ended_at = payload.ended_at
    if payload.hrv_rmssd_ms is not None:
        session.hrv_rmssd_ms = payload.hrv_rmssd_ms
    if payload.resting_hr_bpm is not None:
        session.resting_hr_bpm = payload.resting_hr_bpm

    db.commit()
    return {"ok": True}
