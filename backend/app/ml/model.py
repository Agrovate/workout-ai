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
from sklearn.model_selection import GroupKFold, cross_val_predict
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
        self._cv_rmse: float = 0.0        # out-of-fold RMSE (grouped by session)
        self._abs_resid_q80: float = 0.0  # 80th-pct out-of-fold |error| — conformal band

    # ── training ──────────────────────────────────────────────────────────────

    def fit_from_records(self, records: list[dict[str, Any]]) -> None:
        """
        Train from a list of dicts as returned by the DB query.
        Expected keys: exercise_name, session_id, date, weight, reps, rpe, set_order.
        """
        X_dicts, y, meta = build_training_dataset(records)
        self._fit(X_dicts, y, meta)

    def fit_from_csv(self, csv_path: str) -> None:
        """Train from a Strong App CSV export."""
        records = _load_strong_csv(csv_path)
        self.fit_from_records(records)

    def _fit(
        self,
        X_dicts: list[dict[str, float]],
        y: list[float],
        meta: list[dict[str, str]] | None = None,
    ) -> None:
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
        y_arr = np.asarray(y, dtype=float)
        self._pipeline = _build_sklearn_pipeline()
        self._pipeline.fit(X, y_arr)
        self._fitted = True

        # Honest out-of-fold error, grouped by session so near-duplicate sets
        # from one workout never straddle the train/test split (which would
        # inflate the scores). Feeds both the RMSE baseline and the conformal
        # residual band used for confidence.
        groups = (
            [m["session_id"] for m in meta]
            if meta and len(meta) == self._n_samples
            else [str(i) for i in range(self._n_samples)]
        )
        n_groups = len(set(groups))
        cv_k = min(5, max(3, self._n_samples // 20), n_groups)

        if cv_k >= 2:
            oof = cross_val_predict(
                _build_sklearn_pipeline(), X, y_arr,
                cv=GroupKFold(n_splits=cv_k), groups=groups,
            )
            abs_err = np.abs(oof - y_arr)
            self._cv_rmse = float(np.sqrt(np.mean((oof - y_arr) ** 2)))
            self._abs_resid_q80 = float(np.quantile(abs_err, 0.80))
        else:
            self._cv_rmse = 0.0
            self._abs_resid_q80 = 0.0

        logger.info(
            "ProgressionPredictor fitted on %d samples / %d sessions (ML mode). "
            "grouped CV-%d RMSE: %.2f, 80%% |error| band: ±%.2f",
            self._n_samples, n_groups, cv_k, self._cv_rmse, self._abs_resid_q80,
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

        confidence = self._prediction_confidence(x, weight)

        return {
            "exercise_name": exercise_name,
            "recommended_weight": weight,
            "recommended_reps": reps,
            "confidence": confidence,
        }

    def _prediction_confidence(
        self, x: list[list[float]], predicted_weight: float
    ) -> float | None:
        """
        Confidence anchored to real held-out error, not sub-model agreement.

        Start from the conformal band ``_abs_resid_q80`` — the 80th percentile
        of out-of-fold absolute error — and widen it a little when Ridge and
        the GBR disagree sharply on *this* point:

            effective_band = q80 + 0.5 * std(sub_model_preds)
            confidence     = 1 - effective_band / max(predicted_weight, effective_band)

        A ±6 kg band on a 100 kg call → ~0.94; the same band on a 15 kg call
        → ~0.6 (the model really is proportionally vaguer on light lifts).
        Local disagreement can only *widen* the band, never zero the score,
        so a well-calibrated prediction stays confident even if the sub-models
        differ. Returns None until the grouped CV has produced a band.
        """
        q80 = getattr(self, "_abs_resid_q80", 0.0)
        if self._pipeline is None or self._cv_rmse <= 0 or q80 <= 0:
            return None

        imputer  = self._pipeline.named_steps["impute"]
        scaler   = self._pipeline.named_steps["scale"]
        ensemble = self._pipeline.named_steps["model"]
        X_sc = scaler.transform(imputer.transform(x))
        sub_preds = np.array([est.predict(X_sc)[0] for est in ensemble.estimators_])

        effective_band = q80 + 0.5 * float(np.std(sub_preds))
        denom = max(abs(predicted_weight), effective_band)
        confidence = 1.0 - effective_band / denom
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
        # Backfill attributes added after older artifacts were saved.
        self._abs_resid_q80 = getattr(self, "_abs_resid_q80", 0.0)
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
