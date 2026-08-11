"""
Central app configuration.

Local single-user dev setup: no auth, no migrations.
DB URL and model path are read from environment / .env.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # SQLite for local single-user dev. File lives alongside the backend code.
    database_url: str = "sqlite:///./dev.db"

    # Path to a trained/serialized model artifact (joblib/pickle).
    # If not set, the ProgressionPredictor is trained fresh from training_data_path on startup.
    model_artifact_path: str | None = None

    # Path to Strong App CSV export used for training when no artifact is provided.
    training_data_path: str = "data/strong_export.csv"

    app_name: str = "Workout Progression API"
    debug: bool = True


settings = Settings()
