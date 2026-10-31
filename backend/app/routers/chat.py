"""
Chat sessions — persisted so a conversation survives a page reload and the
user can resume it later or start a fresh one, rather than the chat living
only in frontend component state.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import ChatMessage, ChatSession
from app.schemas import ChatMessageIn, ChatMessageOut, ChatSessionDetail, ChatSessionOut
from app.services.chatbot import handle_message

router = APIRouter(prefix="/chat", tags=["chat"])


def _title_from(message: str) -> str:
    text = message.strip()
    return text[:48] + "…" if len(text) > 48 else text


@router.post("/sessions", response_model=ChatSessionOut, status_code=201)
def create_session(db: Session = Depends(get_db)):
    session = ChatSession()
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions", response_model=list[ChatSessionOut])
def list_sessions(db: Session = Depends(get_db)):
    stmt = select(ChatSession).order_by(ChatSession.updated_at.desc())
    return db.scalars(stmt).all()


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(session_id: int, db: Session = Depends(get_db)):
    stmt = (
        select(ChatSession)
        .where(ChatSession.id == session_id)
        .options(selectinload(ChatSession.messages))
    )
    session = db.scalar(stmt)
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    db.delete(session)
    db.commit()


@router.post("/sessions/{session_id}/messages", response_model=ChatMessageOut)
def post_message(session_id: int, payload: ChatMessageIn, db: Session = Depends(get_db)):
    session = db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    db.add(ChatMessage(session_id=session_id, role="user", text=payload.message))
    if session.title is None:
        session.title = _title_from(payload.message)

    reply_text = handle_message(payload.message, db)
    bot_message = ChatMessage(session_id=session_id, role="bot", text=reply_text)
    db.add(bot_message)

    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(bot_message)
    return bot_message
