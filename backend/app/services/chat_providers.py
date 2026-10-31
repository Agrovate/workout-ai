"""
Pluggable chat backends.

`CHATBOT_PROVIDER` (see app/config.py) selects which one `/chat/sessions/{id}/
messages` uses: "rule_based" (keyword matching, no network calls, see
app/services/chatbot.py), "claude" (Anthropic API), or "gemini" (Google's
Gemini API). The two LLM providers call the exact same prediction/workout/
exercise services the rule-based engine calls directly, as tools, so every
backend answers from identical data. All three implement the same
`reply(message, db, history)` signature so the router never needs to know
which one is active, and adding another provider later is just another
class registered in `_PROVIDERS` — no router changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ChatMessage, Exercise, WorkoutSession
from app.services.chatbot import handle_message as _rule_based_reply
from app.services.prediction import predict_next_session, predict_trajectory


class ChatProvider(ABC):
    @abstractmethod
    def reply(self, message: str, db: Session, history: list[ChatMessage]) -> str:
        """Generate a reply to `message`. `history` is this session's prior
        messages, oldest first, not including `message` itself."""


class RuleBasedProvider(ChatProvider):
    def reply(self, message: str, db: Session, history: list[ChatMessage]) -> str:
        return _rule_based_reply(message, db)


_SYSTEM_PROMPT = (
    "You are the in-app assistant for Workout AI, a single-user strength-training "
    "progression tracker. Use the provided tools to look up real data before "
    "answering questions about predictions, exercises, or workout history — "
    "never guess a number. Keep replies short (1-3 sentences) and conversational, "
    "the way a knowledgeable training partner would text back."
)

_CLAUDE_MODEL = "claude-opus-5"


class ClaudeProvider(ChatProvider):
    """Tool-calling chatbot backed by the Anthropic API. Tools wrap the exact
    same service functions / DB queries the rule-based provider uses, so both
    backends answer from the same underlying data."""

    def reply(self, message: str, db: Session, history: list[ChatMessage]) -> str:
        import anthropic
        from anthropic import beta_tool

        client = anthropic.Anthropic()

        @beta_tool
        def get_next_prediction(exercise_name: str) -> str:
            """Get the recommended weight and reps for the next session of an exercise.

            Args:
                exercise_name: Exact exercise name as logged in the app, e.g. "Squat" or "Bench Press".
            """
            result = predict_next_session(exercise_name=exercise_name, db=db)
            if result["recommended_weight"] <= 0:
                return f"Not enough logged history on '{exercise_name}' to make a recommendation."
            text = f"{result['recommended_weight']} lb x {result['recommended_reps']} reps"
            if result.get("confidence") is not None:
                text += f", confidence {result['confidence']:.0%}"
            return text

        @beta_tool
        def get_trajectory(exercise_name: str) -> str:
            """Get a roughly 2-month-ahead weight-progression projection for an exercise,
            as a list of (date, weight, reps) points.

            Args:
                exercise_name: Exact exercise name as logged in the app, e.g. "Deadlift".
            """
            result = predict_trajectory(exercise_name=exercise_name, db=db)
            if not result["points"]:
                return f"Not enough logged history on '{exercise_name}' to project a trajectory."
            lines = [f"{p['date']}: {p['weight']} lb x {p['reps']} reps" for p in result["points"]]
            return f"Assumed RPE {result['assumed_rpe']}.\n" + "\n".join(lines)

        @beta_tool
        def list_exercises() -> str:
            """List the names of every exercise the user has logged."""
            exercises = db.scalars(select(Exercise).order_by(Exercise.name)).all()
            return ", ".join(e.name for e in exercises) if exercises else "No exercises logged yet."

        @beta_tool
        def get_last_workout() -> str:
            """Get the name, date, and set count of the user's most recently logged workout."""
            session = db.scalar(select(WorkoutSession).order_by(WorkoutSession.date.desc()))
            if not session:
                return "No workouts logged yet."
            return f'"{session.workout_name}" on {session.date} ({len(session.sets)} sets)'

        claude_history = [
            {"role": "assistant" if m.role == "bot" else "user", "content": m.text}
            for m in history
        ]
        claude_messages = [*claude_history, {"role": "user", "content": message}]

        runner = client.beta.messages.tool_runner(
            model=_CLAUDE_MODEL,
            max_tokens=16000,
            system=_SYSTEM_PROMPT,
            output_config={"effort": "low"},  # simple chat Q&A — doesn't need deep reasoning
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            tools=[get_next_prediction, get_trajectory, list_exercises, get_last_workout],
            messages=claude_messages,
        )

        final = None
        for msg in runner:
            final = msg

        if final is None:
            return "Sorry, I couldn't reach Claude just now."

        text = "\n".join(b.text for b in final.content if b.type == "text")
        return text or "Sorry, I didn't get a readable response back."


# gemini-3.8-flash is the current flagship flash model but was returning
# persistent 503 "high demand" errors from Google at the time this was
# built; gemini-3.5-flash answered reliably with identical code. Swap this
# back to gemini-3.8-flash (or newer) once that clears up.
_GEMINI_MODEL = "gemini-3.5-flash"


class GeminiProvider(ChatProvider):
    """Tool-calling chatbot backed by Google's Gemini API, via google-genai's
    automatic function calling (plain Python functions as `tools`, matching
    Claude's `@beta_tool` decorator pattern) — the SDK's own recommended
    surface for this (`chats.create()` + `send_message()`; Google's docs
    warn against driving AFC through `models.generate_content()` directly).
    Same tools and underlying data as ClaudeProvider, so both backends
    answer from identical data."""

    def reply(self, message: str, db: Session, history: list[ChatMessage]) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client()

        def get_next_prediction(exercise_name: str) -> str:
            """Get the recommended weight and reps for the next session of an exercise.

            Args:
                exercise_name: Exact exercise name as logged in the app, e.g. "Squat" or "Bench Press".
            """
            result = predict_next_session(exercise_name=exercise_name, db=db)
            if result["recommended_weight"] <= 0:
                return f"Not enough logged history on '{exercise_name}' to make a recommendation."
            text = f"{result['recommended_weight']} lb x {result['recommended_reps']} reps"
            if result.get("confidence") is not None:
                text += f", confidence {result['confidence']:.0%}"
            return text

        def get_trajectory(exercise_name: str) -> str:
            """Get a roughly 2-month-ahead weight-progression projection for an exercise,
            as a list of (date, weight, reps) points.

            Args:
                exercise_name: Exact exercise name as logged in the app, e.g. "Deadlift".
            """
            result = predict_trajectory(exercise_name=exercise_name, db=db)
            if not result["points"]:
                return f"Not enough logged history on '{exercise_name}' to project a trajectory."
            lines = [f"{p['date']}: {p['weight']} lb x {p['reps']} reps" for p in result["points"]]
            return f"Assumed RPE {result['assumed_rpe']}.\n" + "\n".join(lines)

        def list_exercises() -> str:
            """List the names of every exercise the user has logged."""
            exercises = db.scalars(select(Exercise).order_by(Exercise.name)).all()
            return ", ".join(e.name for e in exercises) if exercises else "No exercises logged yet."

        def get_last_workout() -> str:
            """Get the name, date, and set count of the user's most recently logged workout."""
            session = db.scalar(select(WorkoutSession).order_by(WorkoutSession.date.desc()))
            if not session:
                return "No workouts logged yet."
            return f'"{session.workout_name}" on {session.date} ({len(session.sets)} sets)'

        gemini_history = [
            types.Content(
                role="model" if m.role == "bot" else "user",
                parts=[types.Part(text=m.text)],
            )
            for m in history
        ]

        chat = client.chats.create(
            model=_GEMINI_MODEL,
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                tools=[get_next_prediction, get_trajectory, list_exercises, get_last_workout],
            ),
            history=gemini_history,
        )
        response = chat.send_message(message)
        return response.text or "Sorry, I didn't get a readable response back."


_PROVIDERS: dict[str, type[ChatProvider]] = {
    "rule_based": RuleBasedProvider,
    "claude": ClaudeProvider,
    "gemini": GeminiProvider,
}


def get_chat_provider() -> ChatProvider:
    name = settings.chatbot_provider
    provider_cls = _PROVIDERS.get(name)
    if provider_cls is None:
        raise RuntimeError(
            f"Unknown CHATBOT_PROVIDER '{name}' — expected one of {list(_PROVIDERS)}"
        )
    return provider_cls()
