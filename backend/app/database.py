"""
SQLAlchemy engine/session setup.

No Alembic yet: tables are created on startup via Base.metadata.create_all
(see app/main.py). Switch to Alembic migrations once the schema stabilizes
or before this ever becomes multi-user.
"""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# SQLite's default driver only allows the thread that created a connection to
# use it; FastAPI can dispatch requests across threads, so this relaxes that
# for our single-user local setup. Not needed for other DB backends.
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(
    settings.database_url, echo=settings.debug, future=True, connect_args=connect_args
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
