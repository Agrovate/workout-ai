"""
FastAPI entrypoint.

No auth, no Alembic — tables are created directly from the ORM metadata on
startup. Revisit both once this moves beyond single-user local dev.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import exercises, predictions, workouts


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# Wide open for local dev (web on Vite's port, mobile via Expo).
# Tighten this before this is ever exposed beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(exercises.router)
app.include_router(workouts.router)
app.include_router(predictions.router)


@app.get("/health")
def health():
    return {"status": "ok"}
