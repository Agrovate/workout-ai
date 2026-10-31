"""
Rule-based chatbot — keyword/regex intent matching only, no LLM and no
external API calls. Each recognized intent calls straight into the same
service functions the regular REST endpoints use (predict_next_session,
predict_trajectory, direct ORM queries), so answers stay consistent with
the rest of the app.

Exercise names aren't parsed with NLP — the message is scanned for a
substring match against the exercise names actually in the DB, longest
name first (so "incline bench press" matches before "bench press"). This
means recognition is only as good as the exercise names already logged,
but it never needs updating when exercises are added.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Exercise, WorkoutSession
from app.services.prediction import predict_next_session, predict_trajectory

_GREETING_RE = re.compile(r"\b(hi|hello|hey|sup)\b", re.IGNORECASE)
_HELP_RE = re.compile(r"\b(help|what can you do|commands)\b", re.IGNORECASE)
_LIST_EXERCISES_RE = re.compile(r"\b(list|show|what)\b.*\bexercises?\b", re.IGNORECASE)
_LAST_WORKOUT_RE = re.compile(r"\b(last|recent|latest)\b.*\b(workout|session)\b", re.IGNORECASE)
_TRAJECTORY_RE = re.compile(r"\b(forecast|trajectory|projection|progression)\b", re.IGNORECASE)
_PREDICTION_RE = re.compile(
    r"\b(predict|next|how much|how many|what weight|recommend)\b", re.IGNORECASE
)

# Natural time-horizon phrasing ("after a week", "in 2 weeks", "next month")
# — these imply the same intent as the explicit trajectory keywords above,
# just phrased as a question about the future rather than naming the feature.
_WORD_NUM = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}
_UNIT_DAYS = {"day": 1, "week": 7, "month": 30}
_TIME_PHRASE_RE = re.compile(
    r"\b(?:after|in)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(day|week|month)s?\b",
    re.IGNORECASE,
)
_NEXT_PERIOD_RE = re.compile(r"\bnext\s+(week|month)\b", re.IGNORECASE)


def _parse_horizon_days(message: str) -> int | None:
    """Pull a requested number of days out of phrasing like "after a week"
    or "in 2 months" — returns None if the message names no time horizon."""
    m = _TIME_PHRASE_RE.search(message)
    if m:
        qty_raw, unit = m.group(1).lower(), m.group(2).lower()
        qty = _WORD_NUM.get(qty_raw, None)
        if qty is None:
            qty = int(qty_raw)
        return qty * _UNIT_DAYS[unit]
    m = _NEXT_PERIOD_RE.search(message)
    if m:
        return _UNIT_DAYS[m.group(1).lower()]
    return None

_HELP_TEXT = (
    "I can help with:\n"
    "- Next-session predictions (\"what should I lift for squat\")\n"
    "- Progression forecasts (\"forecast deadlift\")\n"
    "- Your exercise list (\"what exercises do I have\")\n"
    "- Your last workout (\"show my last workout\")"
)


def _find_exercise(message: str, db: Session) -> Exercise | None:
    exercises = db.scalars(select(Exercise)).all()
    message_lower = message.lower()
    for ex in sorted(exercises, key=lambda e: -len(e.name)):
        if ex.name.lower() in message_lower:
            return ex
    return None


def handle_message(message: str, db: Session) -> str:
    if _GREETING_RE.search(message):
        return "Hey! Ask me things like \"what should I lift for bench press\" or \"show my last workout\"."

    if _HELP_RE.search(message):
        return _HELP_TEXT

    if _LIST_EXERCISES_RE.search(message):
        exercises = db.scalars(select(Exercise).order_by(Exercise.name)).all()
        if not exercises:
            return "You don't have any exercises logged yet."
        return "Your exercises: " + ", ".join(e.name for e in exercises)

    if _LAST_WORKOUT_RE.search(message):
        session = db.scalar(select(WorkoutSession).order_by(WorkoutSession.date.desc()))
        if not session:
            return "No workouts logged yet."
        return (
            f"Your last workout was \"{session.workout_name}\" on {session.date} "
            f"({len(session.sets)} sets)."
        )

    exercise = _find_exercise(message, db)
    horizon_days = _parse_horizon_days(message)

    if _TRAJECTORY_RE.search(message) or horizon_days is not None:
        if not exercise:
            return "Which exercise? I couldn't match one in your message."
        result = predict_trajectory(exercise_name=exercise.name, db=db)
        if not result["points"]:
            return f"Not enough history on {exercise.name} yet to project a trajectory."

        if horizon_days is not None:
            target = date.today() + timedelta(days=horizon_days)
            point = min(
                result["points"],
                key=lambda p: abs((date.fromisoformat(p["date"]) - target).days),
            )
            off_by_days = abs((date.fromisoformat(point["date"]) - target).days)
            reply = (
                f"Around {point['weight']} lb x {point['reps']} reps on {exercise.name} "
                f"by {point['date']} (assuming ~RPE {result['assumed_rpe']})."
            )
            if off_by_days > 7:
                reply += " (closest point in the ~2-month projection window — your date falls outside it.)"
            return reply

        first, last = result["points"][0], result["points"][-1]
        return (
            f"{exercise.name} trajectory: starting around {first['weight']} lb, "
            f"projected to about {last['weight']} lb by {last['date']} "
            f"(assuming ~RPE {result['assumed_rpe']})."
        )

    if exercise:
        # Mentioning a known exercise name is itself enough intent to treat
        # this as a prediction request, whether or not a prediction keyword
        # is also present ("bench press?" works same as "predict bench press").
        result = predict_next_session(exercise_name=exercise.name, db=db)
        if result["recommended_weight"] <= 0:
            return f"Not enough history on {exercise.name} yet to make a recommendation."
        reply = f"For {exercise.name}, try {result['recommended_weight']} lb x {result['recommended_reps']} reps next time."
        if result.get("confidence") is not None:
            reply += f" (confidence {result['confidence']:.0%})"
        return reply

    if _PREDICTION_RE.search(message):
        return "Which exercise? I couldn't match one in your message."

    return "I didn't understand that. Try \"help\" to see what I can do."
