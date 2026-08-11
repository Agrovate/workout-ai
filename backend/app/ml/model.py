"""
ProgressionPredictor — Ridge + GradientBoosting VotingRegressor ensemble.

Two operational modes
─────────────────────
ML mode   (≥ MIN_TRAIN_SAMPLES training rows)
    A scikit-learn VotingRegressor combining Ridge (fast, linear baseline)
    and GradientBoostingRegressor (captures non-linear plateaus / deload
    cycles). Trained on all available workout history, predicts the weight
    to use for the next set of a given exercise.

Heuristic mode  (< MIN_TRAIN_SAMPLES or unfitted)
    RPE-aware linear progression:
      RPE < 6.5  → +5 % weight
      RPE 6.5-7.5 → +2.5 %
      RPE 7.5-8.5 → maintain
      RPE > 8.5  → −5 %
    Rounds to nearest 2.5 lb/kg plate increment.

Usage
─────
    predictor = ProgressionPredictor()
    predictor.fit_from_records(records)   # list[dict] from DB
    result = predictor.predict_next(history, target_reps=8, recent_rpe=7.0)
    predictor.save("model.joblib")

    predictor2 = ProgressionPredictor()
    predictor2.load("model.joblib")
"""
from __future__ import annotations

import csv
import logging
import math
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, VotingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.ml.features import (
    FEATURE_COLS,
    build_prediction_features,
    build_training_dataset,
)

logger = logging.getLogger(__name__)

MIN_TRAIN_SAMPLES = 10  # below this, use heuristic
PLATE_INCREMENT = 2.5   # round predictions to nearest 2.5

# ── Strong App CSV column names ───────────────────────────────────────────────
_CSV_DATE     = "Date"
_CSV_SESSION  = "Workout Name"
_CSV_EXERCISE = "Exercise Name"
_CSV_ORDER    = "Set Order"
_CSV_WEIGHT   = "Weight"
_CSV_REPS     = "Reps"
_CSV_RPE      = "RPE"


def _round_plate(weight: float) -> float:
    """Round to nearest PLATE_INCREMENT, minimum 0."""
    if weight <= 0:
        return 0.0
    return round(weight / PLATE_INCREMENT) * PLATE_INCREMENT


def _heuristic(
    history: list[dict[str, Any]],
    target_reps: int | None,
    recent_rpe: float | None,
    session_context: dict[str, Any] | None = None,
) -> tuple[float, int]:
    """
    RPE-based linear progression with optional HRV fatigue dampening.

    When HRV is more than 20% below the user's recent median (estimated from
    history), the progression tier is dropped by one step to avoid pushing
    on under-recovered days.

    Returns (weight, reps).
    """
    if not history:
        return 0.0, target_reps or 8

    last = history[-1]
    weight  = float(last.get("weight") or 0.0)
    rpe     = recent_rpe or float(last.get("rpe") or 7.0)
    reps    = target_reps or int(last.get("reps") or 8)

    if weight <= 0:
        return 0.0, reps

    # HRV fatigue dampening: if today's HRV is >20% below recent median, drop one tier
    hrv_today = (session_context or {}).get("hrv_rmssd_today")
    if hrv_today is not None:
        hrv_vals = [
            float(r["hrv_rmssd_ms"])
            for r in history
            if r.get("hrv_rmssd_ms") is not None
        ]
        if len(hrv_vals) >= 3:
            median_hrv = sorted(hrv_vals)[len(hrv_vals) // 2]
            if median_hrv > 0 and hrv_today < median_hrv * 0.80:
                rpe = min(10.0, rpe + 1.0)  # treat as one tier harder → less progression

    if rpe < 6.5:
        weight *= 1.05
    elif rpe < 7.5:
        weight *= 1.025
    elif rpe <= 8.5:
        pass   # maintain
    else:
        weight *= 0.95

    return _round_plate(weight), reps


def _build_sklearn_pipeline() -> Pipeline:
    ensemble = VotingRegressor(
        estimators=[
            ("ridge", Ridge(alpha=10.0)),
            (
                "gbr",
                GradientBoostingRegressor(
                    n_estimators=200,
                    max_depth=3,
                    learning_rate=0.05,
                    subsample=0.8,
                    min_samples_leaf=2,
                    random_state=42,
                ),
            ),
        ]
    )
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("model", ensemble),
        ]
    )


class ProgressionPredictor:
    def __init__(self) -> None:
        self._pipeline: Pipeline | None = None
        self._fitted = False
        self._n_samples = 0
        self._cv_rmse: float = 0.0   # calibration baseline for confidence

    # ── training ──────────────────────────────────────────────────────────────

    def fit_from_records(self, records: list[dict[str, Any]]) -> None:
        """
        Train from a list of dicts as returned by the DB query.
        Expected keys: exercise_name, session_id, date, weight, reps, rpe, set_order.
        """
        X_dicts, y = build_training_dataset(records)
        self._fit(X_dicts, y)

    def fit_from_csv(self, csv_path: str) -> None:
        """Train from a Strong App CSV export."""
        records = _load_strong_csv(csv_path)
        self.fit_from_records(records)

    def _fit(self, X_dicts: list[dict[str, float]], y: list[float]) -> None:
        self._n_samples = len(y)
        if self._n_samples < MIN_TRAIN_SAMPLES:
            logger.info(
                "Only %d training samples — predictor will use heuristic mode "
                "(need ≥ %d to enable ML mode).",
                self._n_samples,
                MIN_TRAIN_SAMPLES,
            )
            self._fitted = True
            return

        X = [[row[col] for col in FEATURE_COLS] for row in X_dicts]
        self._pipeline = _build_sklearn_pipeline()
        self._pipeline.fit(X, y)
        self._fitted = True

        # Cross-validated RMSE — used to calibrate confidence scores.
        # Uses k=3 minimum; scales up with dataset size.
        cv_k = min(5, max(3, self._n_samples // 20))
        cv_scores = cross_val_score(
            _build_sklearn_pipeline(), X, y,
            scoring="neg_root_mean_squared_error",
            cv=cv_k,
        )
        self._cv_rmse = float(-cv_scores.mean())
        logger.info(
            "ProgressionPredictor fitted on %d samples (ML mode active). "
            "CV-%d RMSE: %.2f kg",
            self._n_samples, cv_k, self._cv_rmse,
        )

    # ── inference ─────────────────────────────────────────────────────────────

    def predict_next(
        self,
        history: list[dict[str, Any]],
        target_reps: int | None = None,
        recent_rpe: float | None = None,
        session_context: dict[str, Any] | None = None,
    ) -> dict:
        """
        Predict the next set for an exercise.

        `history`: all previously logged sets for this exercise (newest-last),
                   each a dict with keys: session_id, date, weight, reps, rpe,
                   set_order, avg_hr_bpm (optional), hrv_rmssd_ms (optional).
        `session_context`: optional dict with today's biometrics before any set:
                   hrv_rmssd_today, resting_hr_today
        Returns a dict compatible with PredictionResponse.
        """
        if not self._fitted:
            raise RuntimeError(
                "Predictor not fitted. Call fit_from_records() or load() first."
            )

        exercise_name = (history[-1].get("exercise_name") or "") if history else ""

        # not enough global training data → heuristic
        if self._pipeline is None or self._n_samples < MIN_TRAIN_SAMPLES:
            weight, reps = _heuristic(history, target_reps, recent_rpe, session_context)
            return {
                "exercise_name": exercise_name,
                "recommended_weight": weight,
                "recommended_reps": reps,
                "confidence": None,
            }

        # not enough local history for features → heuristic
        if not history:
            return {
                "exercise_name": exercise_name,
                "recommended_weight": 0.0,
                "recommended_reps": target_reps or 8,
                "confidence": None,
            }

        feats = build_prediction_features(history, target_reps, session_context)
        x = [[feats[col] for col in FEATURE_COLS]]
        raw_weight = float(self._pipeline.predict(x)[0])
        weight = _round_plate(max(0.0, raw_weight))

        # reps: prefer target, else use last logged, else default 8
        reps = target_reps or int(history[-1].get("reps") or 8)

        confidence = self._ensemble_confidence(x)

        return {
            "exercise_name": exercise_name,
            "recommended_weight": weight,
            "recommended_reps": reps,
            "confidence": confidence,
        }

    def _ensemble_confidence(self, x: list[list[float]]) -> float | None:
        """
        True ML confidence via ensemble disagreement calibrated by CV RMSE.

        Each sub-estimator in the VotingRegressor (Ridge + GBR) makes its own
        prediction. Their standard deviation measures how much the two models
        disagree. We normalise by the cross-validated RMSE so the score is
        relative to the model's typical error on unseen data:

            normalised_uncertainty = std(individual_preds) / cv_rmse
            confidence = exp(-normalised_uncertainty)

        This maps to [0, 1]:
            std == 0          → confidence 1.00  (perfect agreement)
            std == cv_rmse    → confidence 0.37  (one σ of disagreement)
            std == 2×cv_rmse  → confidence 0.14  (high disagreement)
        """
        if self._pipeline is None or self._cv_rmse <= 0:
            return None

        imputer  = self._pipeline.named_steps["impute"]
        scaler   = self._pipeline.named_steps["scale"]
        ensemble = self._pipeline.named_steps["model"]

        X_imp = imputer.transform(x)
        X_sc  = scaler.transform(X_imp)

        individual_preds = np.array([
            est.predict(X_sc)[0] for est in ensemble.estimators_
        ])
        disagreement = float(np.std(individual_preds))
        normalised   = disagreement / self._cv_rmse
        confidence   = float(np.exp(-normalised))
        return round(min(1.0, max(0.0, confidence)), 3)

    # ── kept for backward compat with the old API ──────────────────────────────
    def predict(
        self,
        exercise_name: str,
        target_reps: int | None = None,
        recent_rpe: float | None = None,
    ) -> dict:
        """Legacy interface — works without history (cold-start heuristic)."""
        if not self._fitted:
            raise RuntimeError("Predictor not fitted.")
        return {
            "exercise_name": exercise_name,
            "recommended_weight": 0.0,
            "recommended_reps": target_reps or 8,
            "confidence": None,
        }

    # ── persistence ───────────────────────────────────────────────────────────

    def save(self, artifact_path: str) -> None:
        joblib.dump(self, artifact_path)
        logger.info("Model saved to %s", artifact_path)

    def load(self, artifact_path: str) -> None:
        obj = joblib.load(artifact_path)
        self.__dict__.update(obj.__dict__)
        logger.info(
            "Model loaded from %s (%d training samples, ML=%s)",
            artifact_path,
            self._n_samples,
            self._pipeline is not None,
        )


# ── Strong App CSV parser ──────────────────────────────────────────────────────

def _load_strong_csv(path: str) -> list[dict[str, Any]]:
    """
    Parse a Strong App CSV export into the standard record format.
    Strong App CSV columns (v4 format):
        Date, Workout Name, Duration, Exercise Name, Set Order,
        Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE
    """
    records: list[dict[str, Any]] = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            def _float(key: str) -> float | None:
                val = row.get(key, "").strip()
                try:
                    return float(val) if val else None
                except ValueError:
                    return None

            def _int(key: str) -> int | None:
                val = _float(key)
                return int(val) if val is not None else None

            records.append(
                {
                    "exercise_name": (row.get(_CSV_EXERCISE) or "").strip(),
                    "session_id": f"{row.get(_CSV_DATE,'')}_{row.get(_CSV_SESSION,'')}",
                    "date": (row.get(_CSV_DATE) or "")[:10],  # "YYYY-MM-DD"
                    "set_order": _int(_CSV_ORDER) or i,
                    "weight": _float(_CSV_WEIGHT),
                    "reps":   _int(_CSV_REPS),
                    "rpe":    _float(_CSV_RPE),
                }
            )
    logger.info("Loaded %d rows from %s", len(records), path)
    return records
