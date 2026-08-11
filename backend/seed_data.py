"""
Seed the database with realistic dummy workout data (8 weeks of progressive overload).
Run with:  cd backend && uv run python seed_data.py
The backend does NOT need to be running — this writes directly to the SQLite DB.
"""

import os, sys
from datetime import date, timedelta
from pathlib import Path

# Force SQLite before any app modules are imported (nix devshell sets DATABASE_URL to postgres)
sys.path.insert(0, str(Path(__file__).parent))
os.environ["DATABASE_URL"] = "sqlite:///./dev.db"

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models import Base, Exercise, WorkoutSession, WorkoutSet

# ── exercises ─────────────────────────────────────────────────────────────────

EXERCISES = [
    ("Squat",                 "Legs"),
    ("Romanian Deadlift",     "Legs"),
    ("Leg Press",             "Legs"),
    ("Bench Press",           "Chest"),
    ("Incline Dumbbell Press","Chest"),
    ("Cable Fly",             "Chest"),
    ("Deadlift",              "Back"),
    ("Pull-Up",               "Back"),
    ("Barbell Row",           "Back"),
    ("Overhead Press",        "Shoulders"),
    ("Lateral Raise",         "Shoulders"),
    ("Barbell Curl",          "Arms"),
    ("Tricep Pushdown",       "Arms"),
]

# ── workout templates ─────────────────────────────────────────────────────────
# Each entry: (exercise_name, base_weight, sets, reps, base_rpe)
# Weight increases ~2.5 kg every 2 weeks

PUSH_A = [
    ("Bench Press",           80,  4, 6, 7.5),
    ("Overhead Press",        50,  4, 8, 7.0),
    ("Incline Dumbbell Press",32,  3, 10, 7.0),
    ("Cable Fly",             15,  3, 12, 6.5),
    ("Tricep Pushdown",       25,  3, 12, 7.0),
]

PULL_A = [
    ("Deadlift",              120, 4, 5, 8.0),
    ("Pull-Up",               0,   4, 8, 7.5),
    ("Barbell Row",           70,  4, 8, 7.0),
    ("Barbell Curl",          30,  3, 10, 7.0),
]

LEGS_A = [
    ("Squat",                 100, 4, 6, 8.0),
    ("Romanian Deadlift",     80,  3, 10, 7.5),
    ("Leg Press",             140, 3, 12, 7.0),
]

PUSH_B = [
    ("Bench Press",           82.5,4, 4, 8.0),
    ("Overhead Press",        52.5,3, 6, 7.5),
    ("Incline Dumbbell Press",34,  3, 8, 7.5),
    ("Tricep Pushdown",       27.5,3, 10, 7.0),
]

PULL_B = [
    ("Barbell Row",           72.5,4, 6, 7.5),
    ("Pull-Up",               0,   3, 10, 8.0),
    ("Barbell Curl",          32.5,3, 8, 7.5),
    ("Romanian Deadlift",     82.5,3, 8, 7.0),
]

LEGS_B = [
    ("Squat",                 102.5,4, 4, 8.5),
    ("Leg Press",             145, 3, 10, 7.5),
    ("Romanian Deadlift",     82.5,3, 8, 7.5),
]

# Week schedule: Mon=Push A, Wed=Pull A, Fri=Legs A, Sat=Push B (alternating Pull/Legs B)
WEEKLY_SCHEDULE = [
    (0, "Push Day A",  PUSH_A),   # Monday
    (2, "Pull Day A",  PULL_A),   # Wednesday
    (4, "Legs Day A",  LEGS_A),   # Friday
    (5, "Push Day B",  PUSH_B),   # Saturday
]
WEEKLY_SCHEDULE_B = [
    (0, "Push Day A",  PUSH_A),
    (2, "Pull Day B",  PULL_B),
    (4, "Legs Day B",  LEGS_B),
    (5, "Push Day B",  PUSH_B),
]

def make_sets(template, ex_map, week: int) -> list[dict]:
    """Build sets for a workout, applying progressive overload per week."""
    sets = []
    for order, (name, base_weight, n_sets, reps, rpe) in enumerate(template, 1):
        ex = ex_map.get(name)
        if not ex:
            continue
        # +2.5 kg every 2 weeks (for barbell); bodyweight stays 0
        increment = (week // 2) * 2.5
        weight = (base_weight + increment) if base_weight > 0 else None
        # fatigue within session: later sets slightly heavier rpe
        for s in range(n_sets):
            sets.append(WorkoutSet(
                exercise_id=ex.id,
                set_order=order * 10 + s,
                weight=weight,
                reps=reps,
                rpe=min(10.0, round(rpe + s * 0.5, 1)),
            ))
    return sets


def main():
    engine = create_engine("sqlite:///./dev.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        # ── upsert exercises ──────────────────────────────────────────────────
        ex_map: dict[str, Exercise] = {}
        for name, group in EXERCISES:
            ex = db.query(Exercise).filter_by(name=name).first()
            if not ex:
                ex = Exercise(name=name, muscle_group=group)
                db.add(ex)
                db.flush()
                print(f"  + exercise: {name}")
            ex_map[name] = ex
        db.commit()

        # ── generate 8 weeks of workouts ─────────────────────────────────────
        today = date.today()
        # start 8 weeks ago on Monday
        start = today - timedelta(weeks=8)
        start -= timedelta(days=start.weekday())  # roll back to Monday

        existing_dates = {
            s.date for s in db.query(WorkoutSession.date).all()
        }

        sessions_added = 0
        for week_offset in range(8):
            week_start = start + timedelta(weeks=week_offset)
            schedule = WEEKLY_SCHEDULE if week_offset % 2 == 0 else WEEKLY_SCHEDULE_B

            for day_offset, name, template in schedule:
                session_date = week_start + timedelta(days=day_offset)
                if session_date > today:
                    continue
                if session_date in existing_dates:
                    continue

                sets = make_sets(template, ex_map, week_offset)
                if not sets:
                    continue

                session = WorkoutSession(
                    workout_name=name,
                    date=session_date,
                    notes=None,
                )
                db.add(session)
                db.flush()
                for st in sets:
                    st.session_id = session.id
                    db.add(st)

                existing_dates.add(session_date)
                sessions_added += 1

        db.commit()
        print(f"\nDone — inserted {sessions_added} workout sessions.")


if __name__ == "__main__":
    main()
