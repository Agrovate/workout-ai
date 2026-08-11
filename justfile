default:
    @just --list

# Start the FastAPI backend (hot-reload)
backend:
    cd backend && DATABASE_URL=sqlite:///./dev.db uv run uvicorn app.main:app --reload --host 0.0.0.0

# Start the Vite web dev server
web:
    cd frontend/web && pnpm dev

# Start the Expo mobile dev server (tunnel mode for physical devices)
mobile:
    cd frontend/mobile && pnpm exec expo start --tunnel

# Build the web frontend for production
build:
    cd frontend/web && pnpm run build

# Run backend tests
test:
    cd backend && uv run pytest

# Retrain the ML model from DB data and save artifact to backend/model.joblib
train:
    cd backend && DATABASE_URL=sqlite:///./dev.db uv run python -m app.cli.train

# Seed the DB with a basic exercise set (backend must be running)
seed:
    #!/usr/bin/env sh
    for entry in \
        '{"name":"Squat","muscle_group":"Legs"}' \
        '{"name":"Romanian Deadlift","muscle_group":"Legs"}' \
        '{"name":"Leg Press","muscle_group":"Legs"}' \
        '{"name":"Bench Press","muscle_group":"Chest"}' \
        '{"name":"Incline Dumbbell Press","muscle_group":"Chest"}' \
        '{"name":"Cable Fly","muscle_group":"Chest"}' \
        '{"name":"Deadlift","muscle_group":"Back"}' \
        '{"name":"Pull-Up","muscle_group":"Back"}' \
        '{"name":"Barbell Row","muscle_group":"Back"}' \
        '{"name":"Overhead Press","muscle_group":"Shoulders"}' \
        '{"name":"Lateral Raise","muscle_group":"Shoulders"}' \
        '{"name":"Barbell Curl","muscle_group":"Arms"}' \
        '{"name":"Tricep Pushdown","muscle_group":"Arms"}'; do
        curl -sf -X POST http://localhost:8000/exercises \
            -H "Content-Type: application/json" \
            -d "$entry" > /dev/null && echo "Added: $entry" || echo "Skipped (exists?): $entry"
    done

# Seed the DB with 12 weeks of realistic workout history (includes sensor data)
seed-data:
    cd backend && DATABASE_URL=sqlite:///./dev.db uv run python -m app.cli.seed

# Delete the SQLite dev database (wipes all data)
reset-db:
    rm -f backend/dev.db
    @echo "dev.db removed — tables will be recreated on next backend start"

# Build and flash ESP32 firmware (run from nix develop .#firmware shell)
flash:
    cd firmware && pio run --target upload --target monitor

# Build firmware without flashing
firmware-build:
    cd firmware && pio run

# Open serial monitor only (firmware already flashed)
firmware-monitor:
    cd firmware && pio device monitor

# Clean firmware build artifacts
firmware-clean:
    cd firmware && pio run --target clean
