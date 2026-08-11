"""
STUB — replace this file with your actual model.py from the ML pipeline
(Ridge + Gradient Boosting VotingRegressor ensemble).

This stub exists only so the backend is runnable end-to-end before the real
pipeline is wired in. It mimics the expected ProgressionPredictor interface:
    - fit_from_csv(path): train from a Strong App CSV export
    - load(path) / save(path): persist/restore a trained model artifact
    - predict(exercise_name, target_reps=None, recent_rpe=None) -> dict

Swap this out and update the import in app/services/prediction.py if your
real class's method names differ.
"""
import joblib


class ProgressionPredictor:
    def __init__(self) -> None:
        self._fitted = False
        self._exercise_history: dict[str, dict] = {}

    def fit_from_csv(self, csv_path: str) -> None:
        """
        Replace with your real data.py loading/feature-engineering + the
        Ridge + GradientBoosting VotingRegressor training from model.py.
        """
        # Stub: no-op fit so the API boots even without real training data.
        self._fitted = True

    def load(self, artifact_path: str) -> None:
        obj = joblib.load(artifact_path)
        self.__dict__.update(obj.__dict__)
        self._fitted = True

    def save(self, artifact_path: str) -> None:
        joblib.dump(self, artifact_path)

    def predict(
        self,
        exercise_name: str,
        target_reps: int | None = None,
        recent_rpe: float | None = None,
    ) -> dict:
        if not self._fitted:
            raise RuntimeError("Predictor not fitted. Call fit_from_csv() or load() first.")

        # Stub heuristic — replace with real ensemble inference.
        return {
            "exercise_name": exercise_name,
            "recommended_weight": 0.0,
            "recommended_reps": target_reps or 8,
            "confidence": None,
        }
