"""
Seed the dev database with realistic workout history.

Generates ~12 weeks of progressive overload data across 10 exercises,
including Apple Watch sensor values (HRV, resting HR, per-set heart rate)
so the ML model has enough to train and the analytics look populated.

Usage:
    cd backend && DATABASE_URL=sqlite:///./dev.db uv run python -m app.cli.seed
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from sqlalchemy import text

from app.database import Base, SessionLocal, engine
from app.models import Exercise, WorkoutSession, WorkoutSet

random.seed(42)

# ── programme ─────────────────────────────────────────────────────────────────
# (name, muscle_group, start_kg, increment_per_session_kg, typical_reps, sets)
EXERCISES = [
    ("Squat",                  "Legs",      80.0,  2.5,  5, 3),
    ("Romanian Deadlift",      "Legs",      70.0,  2.5,  8, 3),
    ("Bench Press",            "Chest",     60.0,  1.25, 5, 3),
    ("Incline Dumbbell Press", "Chest",     28.0,  1.25, 10, 3),
    ("Deadlift",               "Back",     100.0,  2.5,  5, 3),
    ("Barbell Row",            "Back",      60.0,  1.25, 8, 3),
    ("Overhead Press",         "Shoulders", 40.0,  1.25, 5, 3),
    ("Lateral Raise",          "Shoulders", 12.0,  0.0,  12, 3),
    ("Barbell Curl",           "Arms",      30.0,  1.25, 10, 3),
    ("Tricep Pushdown",        "Arms",      25.0,  1.25, 12, 3),
]

# 3-day PPL split
SPLITS = [
    ("Push",  ["Bench Press", "Incline Dumbbell Press", "Overhead Press", "Lateral Raise", "Tricep Pushdown"]),
    ("Pull",  ["Deadlift", "Barbell Row", "Barbell Curl"]),
    ("Legs",  ["Squat", "Romanian Deadlift"]),
]

WEEKS = 12


def _round_plate(w: float) -> float:
    return max(0.0, round(w / 2.5) * 2.5)


def _hrv(base: float, fatigue: float) -> float:
    return round(max(20.0, base * (1 - fatigue * 0.3) + random.uniform(-5, 5)), 1)


def _resting_hr(hrv: float) -> float:
    return round(max(45.0, 118.0 - hrv + random.uniform(-3, 3)), 1)


def _set_hr(rpe: float) -> tuple[int, int]:
    avg = int(115 + rpe * 6 + random.uniform(-8, 8))
    return avg, avg + random.randint(8, 20)


def main() -> None:
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        # ── upsert exercises ──────────────────────────────────────────────────
        ex_map: dict[str, Exercise] = {}
        for name, muscle, *_ in EXERCISES:
            row = db.execute(
                text("SELECT id FROM exercises WHERE name = :n"), {"n": name}
            ).mappings().first()
            if row:
                obj = db.get(Exercise, row["id"])
            else:
                obj = Exercise(name=name, muscle_group=muscle)
                db.add(obj)
                db.flush()
            ex_map[name] = obj  # type: ignore[assignment]
        db.commit()

        # ── weight tracker — one entry per exercise, progresses independently ─
        # Store raw (unrounded) accumulated weight so 1.25 kg increments
        # accumulate correctly. Only round when writing to the DB.
        ex_state: dict[str, dict] = {
            name: {"weight": float(start), "inc": inc, "reps": reps, "n_sets": n_sets}
            for name, _, start, inc, reps, n_sets in EXERCISES
        }

        # ── build session schedule: Mon / Wed / Fri each week ─────────────────
        today = date.today()
        start_monday = today - timedelta(weeks=WEEKS)
        # align to Monday
        start_monday -= timedelta(days=start_monday.weekday())

        sessions_created = 0
        split_idx = 0

        for week in range(WEEKS):
            week_monday = start_monday + timedelta(weeks=week)
            for day_offset in (0, 2, 4):   # Mon, Wed, Fri
                sess_date = week_monday + timedelta(days=day_offset)
                if sess_date > today:
                    continue

                split_name, ex_names = SPLITS[split_idx % len(SPLITS)]
                split_idx += 1

                # simulate good/bad recovery days
                fatigue = random.uniform(0.0, 0.35)
                hrv_base = 65.0 - week * 0.4   # slight downward trend under load
                hrv_val = _hrv(hrv_base, fatigue)
                resting = _resting_hr(hrv_val)

                session = WorkoutSession(
                    workout_name=split_name,
                    date=sess_date,
                    hrv_rmssd_ms=hrv_val,
                    resting_hr_bpm=resting,
                )
                db.add(session)
                db.flush()

                set_order = 1
                for ex_name in ex_names:
                    if ex_name not in ex_state:
                        continue
                    st = ex_state[ex_name]
                    base_w = st["weight"]
                    n_sets = st["n_sets"]
                    target_reps = st["reps"]

                    for s_idx in range(n_sets):
                        # slight weight drop on fatigued days, harder last sets
                        w = _round_plate(base_w * (1 - fatigue * 0.04))
                        rpe = round(6.0 + s_idx * 0.5 + fatigue * 2.0 + random.uniform(-0.3, 0.3), 1)
                        rpe = min(10.0, max(5.0, rpe))
                        reps = max(1, target_reps + random.randint(-1, 1))
                        avg_hr, peak_hr = _set_hr(rpe)

                        db.add(WorkoutSet(
                            session_id=session.id,
                            exercise_id=ex_map[ex_name].id,
                            set_order=set_order,
                            weight=w,
                            reps=reps,
                            rpe=rpe,
                            avg_hr_bpm=avg_hr,
                            peak_hr_bpm=peak_hr,
                            source="manual",
                        ))
                        set_order += 1

                    # Accumulate raw weight — rounding only happens at set creation
                    st["weight"] += st["inc"]

                sessions_created += 1

        db.commit()

        n_sets = db.execute(text("SELECT COUNT(*) FROM workout_sets")).scalar()
        print(f"Seeded {sessions_created} sessions, {n_sets} sets across {WEEKS} weeks.")

        # Print progression summary
        print("\nWeight progression (first → last):")
        for name, _, start, inc, *_ in EXERCISES:
            appearances = (WEEKS * 3) // len(SPLITS)  # rough appearances per exercise
            end = _round_plate(start + inc * appearances)
            print(f"  {name:28s} {start:.1f} kg → ~{end:.1f} kg")

        print("\nRun 'just train' to retrain the ML model on this data.")


if __name__ == "__main__":
    main()
