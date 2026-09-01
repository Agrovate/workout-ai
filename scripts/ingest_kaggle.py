"""
Ingest the Kaggle weightlifting export into the record format consumed by
``app.ml.features.build_training_dataset`` / ``ProgressionPredictor``.

Source: https://www.kaggle.com/datasets/joep89/weightlifting
        (committed at data/kaggle/weightlifting_721_workouts.csv)

The CSV is a Strong-app export, so the existing ``_load_strong_csv`` parser
handles the column mapping. This module adds the cleaning the raw export needs
before it is fit for regression:

* drop warm-up / bodyweight rows with no external load (Weight <= 0) and
  non-working rows (Reps <= 0);
* drop per-exercise weight outliers (data-entry errors such as a 2956 lb squat)
  that sit outside [0.2x, 5x] the exercise's median working weight;
* keep only exercises with enough distinct sessions to support leave-one-out
  feature construction.

Weights are left in the source unit (pounds).
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path
from statistics import median
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))

from app.ml.model import _load_strong_csv  # noqa: E402

DEFAULT_CSV = _REPO_ROOT / "data" / "kaggle" / "weightlifting_721_workouts.csv"

MIN_SESSIONS_PER_EXERCISE = 15
OUTLIER_LOW_MULT = 0.2
OUTLIER_HIGH_MULT = 5.0


def load_workout_records(
    csv_path: str | Path = DEFAULT_CSV,
    min_sessions: int = MIN_SESSIONS_PER_EXERCISE,
) -> list[dict[str, Any]]:
    """Return cleaned Strong-export records ready for build_training_dataset()."""
    raw = _load_strong_csv(str(csv_path))

    working = [
        r for r in raw
        if (r.get("weight") or 0) > 0 and (r.get("reps") or 0) > 0
    ]

    # per-exercise median working weight, for outlier trimming
    weights_by_ex: dict[str, list[float]] = defaultdict(list)
    for r in working:
        weights_by_ex[r["exercise_name"]].append(float(r["weight"]))
    median_by_ex = {ex: median(ws) for ex, ws in weights_by_ex.items()}

    trimmed = [
        r for r in working
        if OUTLIER_LOW_MULT * median_by_ex[r["exercise_name"]]
        <= float(r["weight"])
        <= OUTLIER_HIGH_MULT * median_by_ex[r["exercise_name"]]
    ]

    # keep only exercises with enough distinct sessions
    sessions_by_ex: dict[str, set] = defaultdict(set)
    for r in trimmed:
        sessions_by_ex[r["exercise_name"]].add(r["date"])
    keep = {ex for ex, days in sessions_by_ex.items() if len(days) >= min_sessions}

    records = [r for r in trimmed if r["exercise_name"] in keep]
    records.sort(key=lambda r: (r["date"], r["exercise_name"], r["set_order"]))
    return records


if __name__ == "__main__":
    recs = load_workout_records()
    exs = sorted({r["exercise_name"] for r in recs})
    days = sorted({r["date"] for r in recs})
    print(f"{len(recs)} sets  |  {len(exs)} exercises  |  {len(days)} session-days")
    print(f"date range: {days[0]} -> {days[-1]}")
    for ex in exs:
        n = sum(1 for r in recs if r["exercise_name"] == ex)
        print(f"  {ex:<35} {n:>5} sets")
