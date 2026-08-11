"""
Wraps the ML ProgressionPredictor for in-process inference.

Kept as a thin service layer (not scattered through routers) so that if you
later need to extract this into a separate inference service, only this file
and its router dependency need to change — the rest of the API is untouched.

NOTE: This currently points at app/ml/model.py, which is a STUB matching the
interface described for your real ProgressionPredictor (Ridge + Gradient
Boosting VotingRegressor ensemble). Replace app/ml/ with your actual
data.py / model.py from the ml pipeline and adjust the import below if the
real method signatures differ.
"""
from functools import lru_cache

from app.config import settings
from app.ml.model import ProgressionPredictor


@lru_cache(maxsize=1)
def get_predictor() -> ProgressionPredictor:
    """
    Loaded once per process (lru_cache) rather than per-request, since
    training/loading the model is the expensive part.
    """
    predictor = ProgressionPredictor()

    if settings.model_artifact_path:
        predictor.load(settings.model_artifact_path)
    else:
        predictor.fit_from_csv(settings.training_data_path)

    return predictor


def predict_next_session(
    exercise_name: str,
    target_reps: int | None = None,
    recent_rpe: float | None = None,
) -> dict:
    predictor = get_predictor()
    result = predictor.predict(
        exercise_name=exercise_name,
        target_reps=target_reps,
        recent_rpe=recent_rpe,
    )
    return result
