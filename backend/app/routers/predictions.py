from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ForecastResponse, PredictionRequest, PredictionResponse
from app.services.prediction import predict_forecast, predict_next_session

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.post("", response_model=PredictionResponse)
def predict(payload: PredictionRequest, db: Session = Depends(get_db)):
    try:
        result = predict_next_session(
            exercise_name=payload.exercise_name,
            db=db,
            target_reps=payload.target_reps,
            recent_rpe=payload.recent_rpe,
            hrv_rmssd_today=payload.hrv_rmssd_today,
            resting_hr_today=payload.resting_hr_today,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return result


@router.get("/forecast", response_model=ForecastResponse)
def forecast(
    exercise_name: str,
    days: int = Query(30, ge=1, le=90),
    target_reps: int | None = None,
    recent_rpe: float | None = None,
    hrv_rmssd_today: float | None = None,
    resting_hr_today: float | None = None,
    db: Session = Depends(get_db),
):
    try:
        result = predict_forecast(
            exercise_name=exercise_name,
            db=db,
            days=days,
            target_reps=target_reps,
            recent_rpe=recent_rpe,
            hrv_rmssd_today=hrv_rmssd_today,
            resting_hr_today=resting_hr_today,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return result
