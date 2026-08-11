# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Environment

This project uses Nix flakes for reproducible dev environments. Enter with `nix develop` (or automatically via direnv: `direnv allow`). Two shells are available:
- `nix develop` — full stack (Python + Node)
- `nix develop .#firmware` — ESP32 firmware (C/C++ via PlatformIO)

## Commands

### Backend (FastAPI, Python)
```bash
just backend                          # Start dev server (uvicorn --reload)
cd backend && uv run uvicorn app.main:app --reload  # Manual start
uv run pytest                         # Run tests
```

### Frontend Web (React + Vite)
```bash
just web                  # Start Vite dev server
cd frontend/web && pnpm dev
pnpm run build            # tsc -b && vite build
pnpm run lint             # ESLint
```

### Frontend Mobile (Expo + React Native)
```bash
just mobile               # Start Expo dev server
cd frontend/mobile && pnpm start
pnpm android / pnpm ios   # Platform-specific builds
```

### Firmware (C/C++, ESP32)
```bash
just flash                   # Build and flash to device (pio run --target upload --target monitor)
just firmware-build          # Build only
just firmware-monitor        # Open serial monitor only
just firmware-clean          # Clean build artifacts
```

### Database
```bash
just db                   # Start PostgreSQL via Docker
```

## Architecture

**Workout AI** is a fitness progression tracker that uses ML to recommend weights/reps based on training history.

### Backend (`backend/app/`)
FastAPI app with SQLAlchemy 2.0 ORM. Tables are created directly from ORM metadata on startup (no Alembic yet). Three routers:
- `routers/exercises.py` — CRUD for exercise catalog
- `routers/workouts.py` — Workout sessions and sets
- `routers/predictions.py` — ML-based progression recommendations

Core models (`models.py`): `Exercise` → `WorkoutSession` → `WorkoutSet` (weight, reps, RPE, distance, duration).

The `services/prediction_service.py` and `ml/` directory contain a stub `ProgressionPredictor` — the intended implementation is a Ridge + Gradient Boosting ensemble trained on Strong App CSV exports.

DB: SQLite (`dev.db`) by default; PostgreSQL-ready via `DATABASE_URL` env var. Config is in `config.py` via Pydantic Settings (reads `.env`, has dev defaults).

CORS is open for local dev (Vite web port + Expo mobile port).

### Frontend Web (`frontend/web/`)
React 19 + TypeScript + Vite. Currently scaffold-stage with placeholder components. Package manager: pnpm.

### Frontend Mobile (`frontend/mobile/`)
React Native 0.81 + Expo 54. Minimal implementation. Package manager: pnpm.

### Firmware (`firmware/`)
C/C++ targeting ESP32 via PlatformIO + ESP-IDF. Implements rep/set detection from IMU data (ICM-42688-P) and streams metrics over BLE to the mobile app.

### Integrations (`integrations/`)
Stub connectors for Garmin, HealthKit, and Fitbit — designed for importing workout data from external sources.

## Key Implementation Notes

- **No auth yet** — single-user local dev setup
- **ML pipeline** — stub only; expects Strong App CSV export format for training data
- **Package managers** — `uv` for Python, `pnpm` for Node
- **Environment variables** — set in `flake.nix` shellHook for dev (`DATABASE_URL`, `JWT_SECRET`, `PYTHONPATH`); override via `.env` file
