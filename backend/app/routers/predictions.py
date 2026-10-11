from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import PredictionRequest, PredictionResponse, PredictionTrajectoryResponse
from app.services.prediction import predict_next_session, predict_trajectory

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


@router.get("/trajectory", response_model=PredictionTrajectoryResponse)
def trajectory(
    exercise_name: str,
    target_reps: int | None = None,
    db: Session = Depends(get_db),
):
    """
    Project a ~2-month forward weight-progression trajectory for an
    exercise, by repeatedly chaining the single-step predictor.
    """
    try:
        result = predict_trajectory(
            exercise_name=exercise_name,
            db=db,
            target_reps=target_reps,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return result
