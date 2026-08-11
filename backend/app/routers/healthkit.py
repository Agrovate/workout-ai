"""
HealthKit ingest router.

Called by the mobile app after a workout is saved to attach Apple Watch
biometrics (HRV, resting HR, per-set heart rate) to the existing session
and set records. All fields are optional — partial data is stored as-is.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WorkoutSession, WorkoutSet
from app.schemas import SessionHealthUpdate, SetHRData

router = APIRouter(prefix="/healthkit", tags=["healthkit"])


@router.patch("/session/{session_id}", status_code=200)
def attach_session_health(
    session_id: int,
    payload: SessionHealthUpdate,
    db: Session = Depends(get_db),
):
    """
    Attach session-level biometrics to an existing workout session.

    Called once after the workout is saved. Stores HRV (measured overnight
    by Apple Watch), resting HR, and the session's start/end timestamps
    (used to window HealthKit HR queries).
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


@router.post("/sets", status_code=200)
def attach_set_hr(
    payload: list[SetHRData],
    db: Session = Depends(get_db),
):
    """
    Bulk-attach per-set heart rate data queried from HealthKit.

    Called once after a workout is saved, with one entry per set whose
    time window could be matched to HealthKit HR samples. Unknown set IDs
    are silently skipped so a partial failure doesn't block the whole batch.
    """
    for item in payload:
        workout_set = db.get(WorkoutSet, item.set_id)
        if workout_set is None:
            continue
        if item.avg_hr_bpm is not None:
            workout_set.avg_hr_bpm = item.avg_hr_bpm
        if item.peak_hr_bpm is not None:
            workout_set.peak_hr_bpm = item.peak_hr_bpm

    db.commit()
    return {"ok": True, "updated": len(payload)}
