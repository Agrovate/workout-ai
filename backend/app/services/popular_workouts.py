"""
Recommends a workout split by popularity in the bundled Kaggle dataset
(data/kaggle/weightlifting_721_workouts.csv — see CLAUDE.md) rather than
this user's own history: how often each distinct "Workout Name" template
(e.g. "Back", "Chest", "Squat 1") occurs across that dataset's ~583 logged
sessions, and which exercises are a consistent (not one-off) part of it.

Parsed once and cached in memory — the CSV is static, committed data, not
something that changes at runtime.
"""
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CSV = _REPO_ROOT / "data" / "kaggle" / "weightlifting_721_workouts.csv"

_CSV_DATE = "Date"
_CSV_WORKOUT_NAME = "Workout Name"
_CSV_EXERCISE = "Exercise Name"

# An exercise counts as "core" to a template only if it shows up in at
# least this fraction of that template's sessions — otherwise a one-off
# accessory someone added on a single day would get listed as if it were
# a defining part of the split.
_CORE_EXERCISE_THRESHOLD = 0.5
_MAX_CORE_EXERCISES = 5

_templates_cache: list[dict[str, Any]] | None = None


def _load_templates(csv_path: Path) -> list[dict[str, Any]]:
    sessions_by_name: dict[str, set[tuple[str, str]]] = defaultdict(set)
    exercise_sessions: dict[str, dict[str, set[tuple[str, str]]]] = defaultdict(
        lambda: defaultdict(set)
    )

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get(_CSV_WORKOUT_NAME) or "").strip()
            date = (row.get(_CSV_DATE) or "").strip()
            exercise = (row.get(_CSV_EXERCISE) or "").strip()
            if not name or not date or not exercise:
                continue
            session_key = (date, name)
            sessions_by_name[name].add(session_key)
            exercise_sessions[name][exercise].add(session_key)

    templates = []
    for name, session_keys in sessions_by_name.items():
        total = len(session_keys)
        core = sorted(
            (
                (exercise, len(keys))
                for exercise, keys in exercise_sessions[name].items()
                if len(keys) / total >= _CORE_EXERCISE_THRESHOLD
            ),
            key=lambda item: -item[1],
        )[:_MAX_CORE_EXERCISES]
        templates.append({
            "name": name,
            "session_count": total,
            "exercises": [exercise for exercise, _ in core],
        })

    templates.sort(key=lambda t: -t["session_count"])
    return templates


def get_popular_templates() -> list[dict[str, Any]]:
    global _templates_cache
    if _templates_cache is None:
        _templates_cache = _load_templates(DEFAULT_CSV) if DEFAULT_CSV.exists() else []
    return _templates_cache


def recommend_workouts(limit: int = 3) -> list[dict[str, Any]]:
    return get_popular_templates()[:limit]
