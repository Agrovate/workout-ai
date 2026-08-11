from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import PredictionRequest, PredictionResponse
from app.services.prediction import predict_next_session

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.post("", response_model=PredictionResponse)
def predict(payload: PredictionRequest, db: Session = Depends(get_db)):
    try:
        result = predict_next_session(
            exercise_name=payload.exercise_name,
            db=db,
            target_reps=payload.target_reps,
            recent_rpe=payload.recent_rpe,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return result
