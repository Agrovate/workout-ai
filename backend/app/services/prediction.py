"""
Prediction service — wraps ProgressionPredictor for in-process inference.

The predictor is trained once on startup (from the DB or a CSV artifact) and
cached. At prediction time the service fetches the *live* recent history for
the requested exercise from the DB so the features are always up-to-date even
though the model weights are stable between restarts.

To retrain without restarting the server call `invalidate_predictor()` then
call `get_predictor()` again — the lru_cache will rebuild.
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.ml.model import ProgressionPredictor, _heuristic

logger = logging.getLogger(__name__)

# Module-level singleton — rebuilt on invalidation
_predictor: ProgressionPredictor | None = None


def _build_predictor() -> ProgressionPredictor:
    predictor = ProgressionPredictor()

    if settings.model_artifact_path and os.path.exists(settings.model_artifact_path):
        predictor.load(settings.model_artifact_path)
        return predictor

    if os.path.exists(settings.training_data_path):
        logger.info("Training from CSV: %s", settings.training_data_path)
        predictor.fit_from_csv(settings.training_data_path)
        return predictor

    # No external data — mark as fitted (heuristic mode) so the API
    # remains usable. The router will call fit_from_db() with a real
    # DB session on first use.
    predictor._fitted = True
    return predictor


def get_predictor() -> ProgressionPredictor:
    global _predictor
    if _predictor is None:
        _predictor = _build_predictor()
    return _predictor


def invalidate_predictor() -> None:
    """Force a rebuild on next get_predictor() call."""
    global _predictor
    _predictor = None


def fit_predictor_from_db(db: Session) -> None:
    """
    Retrain the predictor from all sets currently in the database.
    Call this at startup (after DB is ready) or after bulk data imports.
    """
    rows = db.execute(
        text(
            """
            SELECT
                e.name              AS exercise_name,
                ws.session_id,
                wss.date            AS date,
                ws.set_order,
                ws.weight,
                ws.reps,
                ws.rpe,
                ws.avg_hr_bpm,
                wss.hrv_rmssd_ms,
                wss.resting_hr_bpm
            FROM workout_sets ws
            JOIN exercises        e   ON e.id   = ws.exercise_id
            JOIN workout_sessions wss ON wss.id = ws.session_id
            ORDER BY wss.date, ws.session_id, ws.set_order
            """
        )
    ).mappings().all()

    records = [dict(r) for r in rows]
    if not records:
        logger.info("DB is empty — predictor stays in heuristic mode.")
        return

    predictor = ProgressionPredictor()
    predictor.fit_from_records(records)
    global _predictor
    _predictor = predictor
    logger.info("Predictor retrained from %d DB rows.", len(records))


def _fetch_exercise_history(
    db: Session,
    exercise_name: str,
    limit: int = 60,  # last ~20 sessions × 3 sets
) -> list[dict]:
    """
    Fetch the most-recent logged sets for a given exercise, newest-last.
    """
    rows = db.execute(
        text(
            """
            SELECT
                e.name              AS exercise_name,
                ws.session_id,
                wss.date            AS date,
                ws.set_order,
                ws.weight,
                ws.reps,
                ws.rpe,
                ws.avg_hr_bpm,
                wss.hrv_rmssd_ms,
                wss.resting_hr_bpm
            FROM workout_sets ws
            JOIN exercises        e   ON e.id   = ws.exercise_id
            JOIN workout_sessions wss ON wss.id = ws.session_id
            WHERE e.name = :exercise_name
            ORDER BY wss.date DESC, ws.set_order DESC
            LIMIT :limit
            """
        ),
        {"exercise_name": exercise_name, "limit": limit},
    ).mappings().all()

    # reverse so newest is last (expected by feature engineering)
    return [dict(r) for r in reversed(rows)]


def predict_next_session(
    exercise_name: str,
    db: Session,
    target_reps: int | None = None,
    recent_rpe: float | None = None,
    hrv_rmssd_today: float | None = None,
    resting_hr_today: float | None = None,
) -> dict:
    predictor = get_predictor()
    history = _fetch_exercise_history(db, exercise_name)
    session_context = {
        "hrv_rmssd_today": hrv_rmssd_today,
        "resting_hr_today": resting_hr_today,
    } if (hrv_rmssd_today is not None or resting_hr_today is not None) else None
    result = predictor.predict_next(
        history=history,
        target_reps=target_reps,
        recent_rpe=recent_rpe,
        session_context=session_context,
    )
    # ensure exercise_name is always set (cold-start history is empty)
    result["exercise_name"] = exercise_name
    return result


_DEFAULT_SESSION_GAP_DAYS = 3.5  # ~2x/week, used when history is too sparse to measure
_DEFAULT_RPE = 7.0               # matches _heuristic's own fallback in ml/model.py
_TRAJECTORY_HORIZON_DAYS = 63    # ~9 weeks, i.e. "~2 months"


def _avg_session_gap_days(history: list[dict]) -> float:
    dates = sorted({date.fromisoformat(str(r["date"])[:10]) for r in history if r.get("date")})
    if len(dates) < 2:
        return _DEFAULT_SESSION_GAP_DAYS
    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    avg = sum(gaps) / len(gaps)
    return avg if avg > 0 else _DEFAULT_SESSION_GAP_DAYS


def _avg_rpe(history: list[dict]) -> float:
    rpes = [float(r["rpe"]) for r in history if r.get("rpe") is not None]
    return sum(rpes) / len(rpes) if rpes else _DEFAULT_RPE


_DATA_SUFFICIENCY_SESSIONS = 10  # sessions-with-RPE needed for full data confidence
_HORIZON_DECAY_PER_STEP = 0.95   # confidence multiplier per simulated step


def _data_sufficiency(history: list[dict]) -> float:
    """How many distinct sessions actually logged an RPE for this exercise —
    the real sample size backing `assumed_rpe`'s average."""
    sessions_with_rpe = {r["session_id"] for r in history if r.get("rpe") is not None}
    return min(1.0, len(sessions_with_rpe) / _DATA_SUFFICIENCY_SESSIONS)


def predict_trajectory(
    exercise_name: str,
    db: Session,
    target_reps: int | None = None,
) -> dict:
    """
    Project a ~2-month forward trajectory using the bounded RPE-tiered
    heuristic (ml/model.py's _heuristic), chained step over step — never the
    full ML ensemble, even if the single next-session prediction uses it.

    The ML model is trained on real logged sequences; chaining it against
    its own synthetic output (a prediction pretending to be a real set, then
    another built on that) feeds it data far outside its training
    distribution, which gradient-boosted trees can extrapolate on
    erratically. The heuristic's fixed-percentage tiers were explicitly
    designed to be applied repeatedly, so they stay physically plausible
    (bounded ±5%/±2.5%/0%/-5% per step) however far the chain runs. The
    heuristic itself has no calibrated ML confidence score (see
    predict_next()'s heuristic branch), so each point's `confidence` here is
    a different, honestly-computed proxy instead: real data sufficiency
    behind `assumed_rpe` (see _data_sufficiency) decayed per simulated step
    (see _HORIZON_DECAY_PER_STEP) — not a statistical calibration, but not
    fabricated either.

    Future session spacing and assumed RPE are both derived from the
    exercise's own logged history (not hardcoded), falling back to sane
    defaults when there's too little history to measure them.
    """
    history = _fetch_exercise_history(db, exercise_name)

    if not history:
        return {"exercise_name": exercise_name, "points": [], "assumed_rpe": _DEFAULT_RPE}

    gap_days = _avg_session_gap_days(history)
    assumed_rpe = _avg_rpe(history)
    data_confidence = _data_sufficiency(history)

    sim_history = list(history)
    last_date = date.fromisoformat(str(sim_history[-1]["date"])[:10])
    next_order = (sim_history[-1].get("set_order") or 0) + 1

    points: list[dict] = []
    elapsed_days = 0.0
    step = 0
    while elapsed_days < _TRAJECTORY_HORIZON_DAYS:
        elapsed_days += gap_days
        step += 1
        sim_date = last_date + timedelta(days=round(elapsed_days))

        weight, reps = _heuristic(sim_history, target_reps, assumed_rpe)
        if weight <= 0:
            break  # cold-start / nothing to project from

        # Real, computable confidence proxy (not a fabricated gradient):
        # how much actual history backs assumed_rpe, decayed by how many
        # simulated steps out this point is — not a calibrated ML statistic,
        # but an honest "how much should you trust this projection" signal.
        horizon_confidence = data_confidence * (_HORIZON_DECAY_PER_STEP ** step)

        points.append({
            "date": sim_date.isoformat(),
            "weight": weight,
            "reps": reps,
            "confidence": round(horizon_confidence, 3),
        })

        # Feed this simulated result back in so the next iteration builds on it
        sim_history.append({
            "exercise_name": exercise_name,
            "date": sim_date.isoformat(),
            "session_id": f"sim-{sim_date.isoformat()}",
            "set_order": next_order,
            "weight": weight,
            "reps": reps,
            "rpe": assumed_rpe,
            "avg_hr_bpm": None,
            "hrv_rmssd_ms": None,
        })
        next_order += 1

    return {"exercise_name": exercise_name, "points": points, "assumed_rpe": round(assumed_rpe, 1)}
