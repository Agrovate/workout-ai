"""
Central app configuration.

Local single-user dev setup: no auth, no migrations.
DB URL and model path are read from environment / .env.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # extra="ignore": .env also carries provider SDK credentials
    # (ANTHROPIC_API_KEY, GOOGLE_API_KEY, ...) that those SDKs read directly
    # from the environment — they aren't Settings fields, so don't fail
    # startup just because they're present.
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # SQLite for local single-user dev. File lives alongside the backend code.
    database_url: str = "sqlite:///./dev.db"

    # Path to a trained/serialized model artifact (joblib/pickle).
    # If not set, the ProgressionPredictor is trained fresh from training_data_path on startup.
    model_artifact_path: str | None = None

    # Path to Strong App CSV export used for training when no artifact is provided.
    training_data_path: str = "data/strong_export.csv"

    app_name: str = "Workout Progression API"
    debug: bool = True

    # Which chat backend /chat/sessions/{id}/messages uses — "rule_based"
    # (keyword matching, no network calls), "claude" (Anthropic API), or
    # "gemini" (Google's Gemini API), both tool-calling against the same
    # services the rule-based engine uses. Each SDK reads its own
    # credentials (ANTHROPIC_API_KEY / GOOGLE_API_KEY) straight from the
    # environment — no key fields needed here.
    chatbot_provider: str = "rule_based"


settings = Settings()
