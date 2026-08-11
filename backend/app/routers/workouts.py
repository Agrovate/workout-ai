from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import WorkoutSession, WorkoutSet
from app.schemas import WorkoutSessionCreate, WorkoutSessionOut

router = APIRouter(prefix="/workouts", tags=["workouts"])


@router.get("", response_model=list[WorkoutSessionOut])
def list_sessions(db: Session = Depends(get_db)):
    stmt = (
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.sets))
        .order_by(WorkoutSession.date.desc())
    )
    return db.scalars(stmt).all()


@router.post("", response_model=WorkoutSessionOut, status_code=201)
def create_session(payload: WorkoutSessionCreate, db: Session = Depends(get_db)):
    session = WorkoutSession(
        workout_name=payload.workout_name,
        date=payload.date,
        notes=payload.notes,
    )
    session.sets = [WorkoutSet(**s.model_dump()) for s in payload.sets]

    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_id}", response_model=WorkoutSessionOut)
def get_session(session_id: int, db: Session = Depends(get_db)):
    stmt = (
        select(WorkoutSession)
        .where(WorkoutSession.id == session_id)
        .options(selectinload(WorkoutSession.sets))
    )
    session = db.scalar(stmt)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(WorkoutSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
