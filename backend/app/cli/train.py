"""
CLI entry point for retraining the model and saving a joblib artifact.

Usage:
    cd backend
    DATABASE_URL=sqlite:///./dev.db uv run python -m app.cli.train
    # or via justfile:
    just train
"""
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ARTIFACT_PATH = "model.joblib"


def main() -> None:
    # Import here so DATABASE_URL env var is already set before config loads
    from app.database import Base, SessionLocal, engine
    from app.ml.model import ProgressionPredictor
    from sqlalchemy import text

    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
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
        logger.error("No workout data in DB. Log some workouts first, then retrain.")
        sys.exit(1)

    logger.info("Training on %d sets...", len(records))
    predictor = ProgressionPredictor()
    predictor.fit_from_records(records)
    predictor.save(ARTIFACT_PATH)
    logger.info("Saved to %s — set MODEL_ARTIFACT_PATH=%s to use it.", ARTIFACT_PATH, ARTIFACT_PATH)


if __name__ == "__main__":
    main()
