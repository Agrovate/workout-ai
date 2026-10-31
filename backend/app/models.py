"""
ORM models.

Schema mirrors the Strong App CSV structure (Date, Workout Name, Exercise Name,
Set Order, Weight, Reps, RPE, etc.) so imported training data and live-logged
sets share the same shape. Single-user for now — no user_id / FK to a users
table yet; add that when auth comes in.
"""
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    muscle_group: Mapped[str | None] = mapped_column(String(100), nullable=True)

    sets: Mapped[list["WorkoutSet"]] = relationship(back_populates="exercise")


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workout_name: Mapped[str] = mapped_column(String(255))
    date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Session timing — used to window HealthKit HR queries after the session ends
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Daily readiness biometrics from Apple Watch (measured overnight, queried once per session)
    hrv_rmssd_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    resting_hr_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)

    sets: Mapped[list["WorkoutSet"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class WorkoutSet(Base):
    __tablename__ = "workout_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("workout_sessions.id"))
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"))

    set_order: Mapped[int] = mapped_column(Integer)
    weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    reps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance: Mapped[float | None] = mapped_column(Float, nullable=True)
    seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Velocity telemetry from the WorkoutBand wrist sensor (null for manually logged sets)
    avg_velocity_mm_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    peak_velocity_mm_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    velocity_loss_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "manual" | "hardware"

    # Heart rate telemetry from Apple Watch (null when no watch is paired)
    avg_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    peak_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)

    session: Mapped["WorkoutSession"] = relationship(back_populates="sets")
    exercise: Mapped["Exercise"] = relationship(back_populates="sets")


class ChatSession(Base):
    """A saved chatbot conversation — lets the user resume it later or start
    a fresh one instead of losing history on page reload."""
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.id"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"))
    role: Mapped[str] = mapped_column(String(10))  # "user" | "bot"
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["ChatSession"] = relationship(back_populates="messages")
