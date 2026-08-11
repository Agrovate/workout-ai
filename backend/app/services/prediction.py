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

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.ml.model import ProgressionPredictor

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
                e.name            AS exercise_name,
                ws.session_id,
                wss.date          AS date,
                ws.set_order,
                ws.weight,
                ws.reps,
                ws.rpe
            FROM workout_sets ws
            JOIN exercises     e   ON e.id   = ws.exercise_id
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
                e.name            AS exercise_name,
                ws.session_id,
                wss.date          AS date,
                ws.set_order,
                ws.weight,
                ws.reps,
                ws.rpe
            FROM workout_sets ws
            JOIN exercises     e   ON e.id   = ws.exercise_id
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
) -> dict:
    predictor = get_predictor()
    history = _fetch_exercise_history(db, exercise_name)
    result = predictor.predict_next(
        history=history,
        target_reps=target_reps,
        recent_rpe=recent_rpe,
    )
    # ensure exercise_name is always set (cold-start history is empty)
    result["exercise_name"] = exercise_name
    return result
