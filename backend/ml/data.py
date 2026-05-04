"""
Data loading and preprocessing for the workout progression ML pipeline.

Dataset: Kaggle Strength Training Logs
https://www.kaggle.com/datasets/ulrikthygepedersen/gym-exercise-dataset
or
https://www.kaggle.com/datasets/aakashjoshi123/exercise-and-fitness-metrics-dataset
"""

import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

RAW_DATA_PATH = Path(__file__).parent / "data" / "raw" / "workouts.csv"


# ── Column name mapping ────────────────────────────────────────────────────────
# Adjust these to match whichever Kaggle dataset you downloaded.
# These defaults match the "Gym Exercise Dataset" column names.
COL_MAP = {
    "date":     "date",
    "exercise": "exercise",
    "weight":   "weight_kg",
    "reps":     "reps",
    "sets":     "sets",
    "user_id":  "user_id",   # may not exist in public datasets — will be added
}


def load_raw(path: Path = RAW_DATA_PATH) -> pd.DataFrame:
    """Load raw CSV and normalise column names."""
    df = pd.read_csv(path, parse_dates=["date"])
    df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_")

    # If dataset has no user_id, treat entire dataset as one user
    if "user_id" not in df.columns:
        df["user_id"] = 0

    # Ensure required columns exist
    required = {"date", "exercise", "weight_kg", "reps", "sets", "user_id"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Dataset missing columns: {missing}. Update COL_MAP.")

    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop bad rows, fix types, sort chronologically."""
    df = df.copy()
    df = df.dropna(subset=["weight_kg", "reps", "sets"])
    df = df[df["weight_kg"] > 0]
    df = df[df["reps"] > 0]
    df = df[df["sets"] > 0]
    df["weight_kg"] = df["weight_kg"].astype(float)
    df["reps"] = df["reps"].astype(int)
    df["sets"] = df["sets"].astype(int)
    df = df.sort_values(["user_id", "exercise", "date"]).reset_index(drop=True)
    return df


def epley_1rm(weight: float, reps: int) -> float:
    """Epley formula: estimated one-rep max."""
    if reps == 1:
        return weight
    return weight * (1 + reps / 30)


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Build the feature vector for each session.

    Features produced per row (one row = one exercise session):
        prev_weight       — weight used last session
        prev_reps         — reps performed last session
        prev_sets         — sets performed last session
        prev_1rm          — estimated 1RM from last session (Epley)
        session_number    — how many sessions the user has done this exercise
        rest_days         — days since last session for this exercise
        rolling_avg_weight_3  — 3-session rolling average weight
        rolling_avg_reps_3    — 3-session rolling average reps
        weight_trend      — slope of weight over last 3 sessions
        hrv_score         — HRV (0 if sensor not available, filled later)
        form_score        — form quality (0 if camera not available)
        rep_tempo         — rep tempo in seconds (0 if sensor not available)

    Target:
        next_weight       — weight used in the NEXT session (what we predict)
        next_reps         — reps performed in the NEXT session
    """
    rows = []

    for (user_id, exercise), group in df.groupby(["user_id", "exercise"]):
        group = group.reset_index(drop=True)

        for i in range(1, len(group)):
            prev = group.iloc[i - 1]
            curr = group.iloc[i]

            rest_days = (curr["date"] - prev["date"]).days

            # Rolling averages (up to 3 previous sessions)
            window = group.iloc[max(0, i - 3):i]
            rolling_avg_weight = window["weight_kg"].mean()
            rolling_avg_reps   = window["reps"].mean()

            # Weight trend (slope over last 3 sessions)
            if len(window) >= 2:
                weight_trend = float(np.polyfit(
                    range(len(window)), window["weight_kg"].values, 1
                )[0])
            else:
                weight_trend = 0.0

            rows.append({
                # identifiers (not used as model features)
                "user_id":        user_id,
                "exercise":       exercise,
                "date":           curr["date"],

                # features
                "prev_weight":          float(prev["weight_kg"]),
                "prev_reps":            int(prev["reps"]),
                "prev_sets":            int(prev["sets"]),
                "prev_1rm":             epley_1rm(prev["weight_kg"], prev["reps"]),
                "session_number":       i,
                "rest_days":            max(rest_days, 0),
                "rolling_avg_weight_3": rolling_avg_weight,
                "rolling_avg_reps_3":   rolling_avg_reps,
                "weight_trend":         weight_trend,

                # sensor features — default 0 (imputed when sensors available)
                "hrv_score":   0.0,
                "form_score":  0.0,
                "rep_tempo":   0.0,

                # targets
                "next_weight": float(curr["weight_kg"]),
                "next_reps":   int(curr["reps"]),
            })

    return pd.DataFrame(rows)


FEATURE_COLS = [
    "prev_weight",
    "prev_reps",
    "prev_sets",
    "prev_1rm",
    "session_number",
    "rest_days",
    "rolling_avg_weight_3",
    "rolling_avg_reps_3",
    "weight_trend",
    "hrv_score",
    "form_score",
    "rep_tempo",
]

TARGET_WEIGHT = "next_weight"
TARGET_REPS   = "next_reps"


def get_splits(
    df: pd.DataFrame,
    test_size: float = 0.2,
    random_state: int = 42,
) -> tuple:
    """
    Return (X_train, X_test, y_weight_train, y_weight_test,
             y_reps_train, y_reps_test, scaler)
    """
    feat_df = engineer_features(df)

    X = feat_df[FEATURE_COLS].values
    y_weight = feat_df[TARGET_WEIGHT].values
    y_reps   = feat_df[TARGET_REPS].values

    X_train, X_test, yw_train, yw_test, yr_train, yr_test = train_test_split(
        X, y_weight, y_reps,
        test_size=test_size,
        random_state=random_state,
    )

    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test  = scaler.transform(X_test)

    return X_train, X_test, yw_train, yw_test, yr_train, yr_test, scaler


if __name__ == "__main__":
    df_raw = load_raw()
    df_clean = clean(df_raw)
    print(f"Loaded {len(df_raw)} rows → {len(df_clean)} after cleaning")
    features = engineer_features(df_clean)
    print(f"Feature rows: {len(features)}")
    print(features.head())
