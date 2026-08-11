"""Pydantic schemas — request/response shapes, separate from ORM models."""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ExerciseBase(BaseModel):
    name: str
    muscle_group: str | None = None


class ExerciseCreate(ExerciseBase):
    pass


class ExerciseOut(ExerciseBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class WorkoutSetBase(BaseModel):
    exercise_id: int
    set_order: int
    weight: float | None = None
    reps: int | None = None
    rpe: float | None = None
    distance: float | None = None
    seconds: int | None = None
    notes: str | None = None


class WorkoutSetCreate(WorkoutSetBase):
    pass


class WorkoutSetOut(WorkoutSetBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    session_id: int


class WorkoutSessionBase(BaseModel):
    workout_name: str
    date: date
    notes: str | None = None


class WorkoutSessionCreate(WorkoutSessionBase):
    sets: list[WorkoutSetCreate] = []


class WorkoutSessionOut(WorkoutSessionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    sets: list[WorkoutSetOut] = []


class PredictionRequest(BaseModel):
    exercise_name: str
    # Optional context the model can use if available (sensor enrichment, etc.)
    target_reps: int | None = None
    recent_rpe: float | None = None


class PredictionResponse(BaseModel):
    exercise_name: str
    recommended_weight: float
    recommended_reps: int
    confidence: float | None = None
