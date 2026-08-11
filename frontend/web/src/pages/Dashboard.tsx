import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getWorkouts } from '../api/client';
import type { WorkoutSession } from '../types/api';
import './Dashboard.css';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function thisWeekCount(sessions: WorkoutSession[]) {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  return sessions.filter((s) => new Date(s.date) >= weekAgo).length;
}

function mostUsedExerciseId(sessions: WorkoutSession[]) {
  const counts = new Map<number, number>();
  for (const s of sessions) {
    for (const set of s.sets) {
      counts.set(set.exercise_id, (counts.get(set.exercise_id) ?? 0) + 1);
    }
  }
  let max = 0;
  let best: number | null = null;
  for (const [id, count] of counts) {
    if (count > max) { max = count; best = id; }
  }
  return best;
}

export function Dashboard() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    getWorkouts()
      .then(setSessions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="page">
      <div className="spinner-page"><div className="spinner" /></div>
    </div>
  );

  const weekCount = thisWeekCount(sessions);
  const topExId = mostUsedExerciseId(sessions);
  const displayed = showAll ? sessions : sessions.slice(0, 8);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <Link to="/log" className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Log Workout
        </Link>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: 24 }}>{error}</div>}

      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-value">{sessions.length}</div>
          <div className="stat-label">Total Workouts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{weekCount}</div>
          <div className="stat-label">This Week</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {sessions.reduce((n, s) => n + s.sets.length, 0)}
          </div>
          <div className="stat-label">Total Sets</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {topExId !== null
              ? (() => {
                  const allSets = sessions.flatMap((s) => s.sets);
                  const byEx = allSets.filter((s) => s.exercise_id === topExId);
                  return byEx.length > 0 ? byEx.length : '—';
                })()
              : '—'}
          </div>
          <div className="stat-label">Most-trained sets</div>
        </div>
      </div>

      <h2 className="section-title">Recent Workouts</h2>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <h3>No workouts yet</h3>
          <p>Start by logging your first session.</p>
          <Link to="/log" className="btn btn-primary" style={{ marginTop: 16 }}>
            Log Workout
          </Link>
        </div>
      ) : (
        <>
          <div className="workout-list">
            {displayed.map((session) => (
              <Link key={session.id} to={`/workouts/${session.id}`} className="workout-card">
                <div className="workout-card__meta">
                  <span className="workout-card__date">{formatDate(session.date)}</span>
                  <span className="workout-card__sets">{session.sets.length} sets</span>
                </div>
                <div className="workout-card__name">{session.workout_name}</div>
                {session.notes && (
                  <div className="workout-card__notes">{session.notes}</div>
                )}
                <div className="workout-card__exercises">
                  {Array.from(new Set(session.sets.map((s) => s.exercise_id))).slice(0, 4).map((exId) => (
                    <span key={exId} className="exercise-chip">#{exId}</span>
                  ))}
                  {new Set(session.sets.map((s) => s.exercise_id)).size > 4 && (
                    <span className="exercise-chip">+more</span>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {sessions.length > 8 && !showAll && (
            <button
              className="btn btn-secondary"
              onClick={() => setShowAll(true)}
              style={{ marginTop: 16 }}
            >
              Show all {sessions.length} workouts
            </button>
          )}
        </>
      )}
    </div>
  );
}
