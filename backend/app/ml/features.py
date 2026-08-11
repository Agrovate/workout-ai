"""
Feature engineering for the ProgressionPredictor.

All feature construction lives here so model.py stays focused on the
sklearn pipeline, and the router/service can call build_prediction_features
independently of training.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any


# ── column names ──────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "last_weight",
    "last_reps",
    "last_rpe",
    "days_since_last",
    "sessions_total",
    "weight_3s_avg",   # avg weight over last 3 sessions
    "rpe_3s_avg",      # avg RPE over last 3 sessions
    "reps_3s_avg",
    "target_reps",
]


# ── helpers ───────────────────────────────────────────────────────────────────

def _safe_mean(vals: list[float]) -> float:
    clean = [v for v in vals if v is not None and not math.isnan(v)]
    return sum(clean) / len(clean) if clean else 0.0


def _session_key(record: dict) -> tuple:
    """Group records into sessions by (session_id or date)."""
    return record.get("session_id") or record.get("date") or ""


# ── public API ────────────────────────────────────────────────────────────────

def build_prediction_features(
    history: list[dict[str, Any]],
    target_reps: int | None,
) -> dict[str, float]:
    """
    Compute a single feature vector from an exercise's logged history.

    `history` is a list of dicts (newest-last) with keys:
        session_id, date, weight, reps, rpe, set_order

    Returns a dict keyed by FEATURE_COLS.
    """
    if not history:
        return {col: 0.0 for col in FEATURE_COLS}

    last = history[-1]

    # --- last-set features ---
    last_weight = float(last.get("weight") or 0.0)
    last_reps   = float(last.get("reps")   or 0.0)
    last_rpe    = float(last.get("rpe")    or 0.0)

    # --- days since last session ---
    last_date = last.get("date")
    if isinstance(last_date, str):
        try:
            last_date = date.fromisoformat(last_date)
        except ValueError:
            last_date = None
    days_since = 0.0
    if isinstance(last_date, date):
        days_since = float((date.today() - last_date).days)

    # --- session count ---
    sessions_total = float(len({_session_key(r) for r in history}))

    # --- 3-session rolling averages ---
    # group by session, take last 3
    sessions: dict[Any, list[dict]] = {}
    for r in history:
        k = _session_key(r)
        sessions.setdefault(k, []).append(r)

    last3 = list(sessions.values())[-3:]  # up to last 3 sessions

    weights_3s = [float(r["weight"]) for s in last3 for r in s if r.get("weight") is not None]
    rpe_3s     = [float(r["rpe"])    for s in last3 for r in s if r.get("rpe") is not None]
    reps_3s    = [float(r["reps"])   for s in last3 for r in s if r.get("reps") is not None]

    return {
        "last_weight":    last_weight,
        "last_reps":      last_reps,
        "last_rpe":       last_rpe,
        "days_since_last": days_since,
        "sessions_total": sessions_total,
        "weight_3s_avg":  _safe_mean(weights_3s),
        "rpe_3s_avg":     _safe_mean(rpe_3s),
        "reps_3s_avg":    _safe_mean(reps_3s),
        "target_reps":    float(target_reps or 0),
    }


def build_training_dataset(
    all_records: list[dict[str, Any]],
) -> tuple[list[dict[str, float]], list[float]]:
    """
    Build (X, y) from the full workout history.

    For each logged set we compute the feature vector from the history
    *preceding* that set (leave-one-out style), so the model learns to
    predict weight given past performance.

    Only sets with a recorded weight are kept as training targets.
    """
    # group by exercise
    by_exercise: dict[str, list[dict]] = {}
    for r in all_records:
        ex = str(r.get("exercise_name") or r.get("exercise_id") or "")
        if ex:
            by_exercise.setdefault(ex, []).append(r)

    X: list[dict[str, float]] = []
    y: list[float] = []

    for _ex, records in by_exercise.items():
        # sort by session date, then set_order within session
        records = sorted(
            records,
            key=lambda r: (
                str(r.get("date") or ""),
                int(r.get("set_order") or 0),
            ),
        )
        for i, rec in enumerate(records):
            if rec.get("weight") is None:
                continue
            history_so_far = records[:i]  # everything before this set
            if not history_so_far:
                continue  # skip cold-start rows (nothing to learn from)
            feats = build_prediction_features(history_so_far, target_reps=rec.get("reps"))
            X.append(feats)
            y.append(float(rec["weight"]))

    return X, y
