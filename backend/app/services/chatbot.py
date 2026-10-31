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
but it never needs updating when exercises are added. Muscle groups are
matched the same way against the DB's distinct muscle_group values.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Exercise, WorkoutSession, WorkoutSet
from app.services.prediction import predict_next_session, predict_trajectory

_GREETING_RE = re.compile(r"\b(hi|hello|hey|sup)\b", re.IGNORECASE)
_FAREWELL_RE = re.compile(r"\b(bye|goodbye|see ya|thanks|thank you|thx)\b", re.IGNORECASE)
_HELP_RE = re.compile(r"\b(help|what can you do|commands)\b", re.IGNORECASE)

_PR_RE = re.compile(
    r"\b(pr|personal record|max weight|heaviest|one.?rep max|1rm)\b", re.IGNORECASE
)
_MUSCLE_GROUP_HINT_RE = re.compile(r"\bexercis", re.IGNORECASE)
_LIST_EXERCISES_RE = re.compile(r"\b(list|show|what)\b.*\bexercises?\b", re.IGNORECASE)

_WORKOUT_HISTORY_RE = re.compile(
    r"\b(workout history|recent workouts|list workouts|past workouts|show (my )?workouts)\b",
    re.IGNORECASE,
)
_WORKOUT_COUNT_RE = re.compile(r"\bhow many workouts\b", re.IGNORECASE)
_LAST_WORKOUT_RE = re.compile(r"\b(last|recent|latest)\b.*\b(workout|session)\b", re.IGNORECASE)
_LAST_TIME_TRAINED_RE = re.compile(
    r"\b(when did i last|last time i (did|trained|hit))\b", re.IGNORECASE
)

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
    "- Progression forecasts (\"forecast deadlift\", \"squat after a week\")\n"
    "- Personal records (\"what's my PR for bench press\")\n"
    "- When you last trained something (\"when did I last do deadlift\")\n"
    "- Your exercises, overall or by muscle group (\"what exercises do I have\", \"leg exercises\")\n"
    "- Your workout history (\"show my last workout\", \"recent workouts\", \"how many workouts have I done\")"
)


def _find_exercise(message: str, db: Session) -> Exercise | None:
    exercises = db.scalars(select(Exercise)).all()
    message_lower = message.lower()
    for ex in sorted(exercises, key=lambda e: -len(e.name)):
        if ex.name.lower() in message_lower:
            return ex
    return None


def _find_muscle_group(message: str, db: Session) -> str | None:
    """Matches singular or plural phrasing against the DB's stored (usually
    plural) muscle_group values — "leg exercises" should match "Legs"."""
    groups = [g for g in db.scalars(select(Exercise.muscle_group).distinct()).all() if g]
    for group in sorted(groups, key=lambda g: -len(g)):
        stem = group[:-1] if group.lower().endswith("s") else group
        if re.search(rf"\b{re.escape(stem)}s?\b", message, re.IGNORECASE):
            return group
    return None


def _personal_record(exercise: Exercise, db: Session) -> WorkoutSet | None:
    stmt = (
        select(WorkoutSet)
        .where(WorkoutSet.exercise_id == exercise.id, WorkoutSet.weight.is_not(None))
        .order_by(WorkoutSet.weight.desc())
        .limit(1)
    )
    return db.scalar(stmt)


def _last_time_trained(exercise: Exercise, db: Session) -> date | None:
    stmt = (
        select(WorkoutSession.date)
        .join(WorkoutSet, WorkoutSet.session_id == WorkoutSession.id)
        .where(WorkoutSet.exercise_id == exercise.id)
        .order_by(WorkoutSession.date.desc())
        .limit(1)
    )
    return db.scalar(stmt)


def handle_message(message: str, db: Session) -> str:
    if _GREETING_RE.search(message):
        return "Hey! Ask me things like \"what should I lift for bench press\" or \"show my last workout\"."

    if _FAREWELL_RE.search(message):
        return "Anytime — good luck with the next session!"

    if _HELP_RE.search(message):
        return _HELP_TEXT

    exercise = _find_exercise(message, db)

    if _PR_RE.search(message):
        if not exercise:
            return "Which exercise? I couldn't match one in your message."
        pr_set = _personal_record(exercise, db)
        if not pr_set:
            return f"No weighted sets logged for {exercise.name} yet."
        return (
            f"Your PR on {exercise.name} is {pr_set.weight} lb x {pr_set.reps} reps "
            f"(set on {pr_set.session.date})."
        )

    if _LAST_TIME_TRAINED_RE.search(message):
        if not exercise:
            return "Which exercise? I couldn't match one in your message."
        last_date = _last_time_trained(exercise, db)
        if not last_date:
            return f"You haven't logged {exercise.name} yet."
        return f"You last trained {exercise.name} on {last_date}."

    muscle_group = _find_muscle_group(message, db)
    if muscle_group and _MUSCLE_GROUP_HINT_RE.search(message):
        exercises = db.scalars(
            select(Exercise).where(Exercise.muscle_group == muscle_group).order_by(Exercise.name)
        ).all()
        if not exercises:
            return f"No exercises logged under {muscle_group} yet."
        return f"Your {muscle_group} exercises: " + ", ".join(e.name for e in exercises)

    if _LIST_EXERCISES_RE.search(message):
        exercises = db.scalars(select(Exercise).order_by(Exercise.name)).all()
        if not exercises:
            return "You don't have any exercises logged yet."
        return "Your exercises: " + ", ".join(e.name for e in exercises)

    if _WORKOUT_COUNT_RE.search(message):
        count = db.scalar(select(func.count()).select_from(WorkoutSession))
        return f"You've logged {count} workout{'s' if count != 1 else ''} total."

    if _WORKOUT_HISTORY_RE.search(message):
        sessions = db.scalars(
            select(WorkoutSession).order_by(WorkoutSession.date.desc()).limit(5)
        ).all()
        if not sessions:
            return "No workouts logged yet."
        lines = [f"- {s.workout_name} on {s.date} ({len(s.sets)} sets)" for s in sessions]
        return "Your most recent workouts:\n" + "\n".join(lines)

    if _LAST_WORKOUT_RE.search(message):
        session = db.scalar(select(WorkoutSession).order_by(WorkoutSession.date.desc()))
        if not session:
            return "No workouts logged yet."
        return (
            f"Your last workout was \"{session.workout_name}\" on {session.date} "
            f"({len(session.sets)} sets)."
        )

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
