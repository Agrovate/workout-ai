from datetime import date, timedelta

from app.ml.model import ProgressionPredictor
from app.ml.features import typical_session_interval_days


def _synthetic_history(n_sessions: int = 20, interval_days: int = 3) -> list[dict]:
    """Slowly-progressing bench-press-like history, one working set per session."""
    start = date(2025, 1, 1)
    history = []
    weight = 60.0
    for i in range(n_sessions):
        d = start + timedelta(days=interval_days * i)
        history.append({
            "exercise_name": "Bench Press",
            "session_id": f"s{i}",
            "date": d.isoformat(),
            "set_order": 1,
            "weight": weight,
            "reps": 5,
            "rpe": 7.0,
        })
        weight += 1.25
    return history


def test_typical_session_interval_days_infers_median_gap():
    history = _synthetic_history(n_sessions=10, interval_days=4)
    assert typical_session_interval_days(history) == 4.0


def test_typical_session_interval_days_falls_back_when_sparse():
    from app.ml.features import DEFAULT_SESSION_INTERVAL_DAYS
    assert typical_session_interval_days([]) == DEFAULT_SESSION_INTERVAL_DAYS
    assert typical_session_interval_days(_synthetic_history(1)) == DEFAULT_SESSION_INTERVAL_DAYS


def test_forecast_heuristic_mode_produces_spaced_points_within_horizon():
    predictor = ProgressionPredictor()
    history = _synthetic_history(n_sessions=5, interval_days=3)  # below MIN_TRAIN_SAMPLES
    predictor.fit_from_records(history)

    points = predictor.forecast(history, days=30)

    assert len(points) > 0
    last_date = date.fromisoformat(history[-1]["date"])
    for p in points:
        assert 0 < (p["date"] - last_date).days <= 30
        assert p["recommended_weight"] >= 0
        assert p["recommended_reps"] > 0
    # session_number increases monotonically alongside date
    assert [p["session_number"] for p in points] == list(range(1, len(points) + 1))
    dates = [p["date"] for p in points]
    assert dates == sorted(dates)


def test_forecast_ml_mode_confidence_decays_with_horizon():
    predictor = ProgressionPredictor()
    history = _synthetic_history(n_sessions=40, interval_days=3)  # >= MIN_TRAIN_SAMPLES
    predictor.fit_from_records(history)

    points = predictor.forecast(history, days=60)
    assert len(points) >= 2

    confidences = [p["confidence"] for p in points if p["confidence"] is not None]
    if len(confidences) >= 2:
        # each later step should be no more confident than the one before it
        assert all(a >= b for a, b in zip(confidences, confidences[1:]))


def test_forecast_empty_history_returns_no_points():
    predictor = ProgressionPredictor()
    predictor.fit_from_records(_synthetic_history(20))
    assert predictor.forecast([], days=30) == []
