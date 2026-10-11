import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getExercises, getWorkouts } from '../api/client';
import type { Exercise, WorkoutSession } from '../types/api';
import './Dashboard.css';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function thisWeekCount(sessions: WorkoutSession[]) {
  // Start of the current calendar week (Monday, local midnight)
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return sessions.filter((s) => new Date(s.date + 'T00:00:00') >= start).length;
}

const DumbbellIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 6.5h11M6.5 17.5h11M9 3v18M15 3v18" />
    <rect x="2" y="9" width="4" height="6" rx="1" /><rect x="18" y="9" width="4" height="6" rx="1" />
  </svg>
);
const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const LayersIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
  </svg>
);
const TargetIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
  </svg>
);

export function Dashboard() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([getWorkouts(), getExercises().catch(() => [] as Exercise[])])
      .then(([w, e]) => { setSessions(w); setExercises(e); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="page">
      <div className="spinner-page"><div className="spinner" /></div>
    </div>
  );

  const exName = new Map(exercises.map((e) => [e.id, e.name]));
  const weekCount = thisWeekCount(sessions);
  const totalSets = sessions.reduce((n, s) => n + s.sets.length, 0);
  const distinctExercises = new Set(
    sessions.flatMap((s) => s.sets.map((set) => set.exercise_id))
  ).size;
  const RECENT_LIMIT = 3;
  const displayed = showAll ? sessions : sessions.slice(0, RECENT_LIMIT);

  const stats = [
    { icon: <DumbbellIcon />, value: sessions.length, label: 'Total workouts' },
    { icon: <CalendarIcon />, value: weekCount, label: 'This week' },
    { icon: <LayersIcon />, value: totalSets, label: 'Total sets' },
    { icon: <TargetIcon />, value: distinctExercises || '—', label: 'Exercises trained' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting()} <span className="wave">👋</span></h1>
          <p className="page-subtitle">Here's your training at a glance.</p>
        </div>
        <Link to="/log" className="btn btn-primary">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Log workout
        </Link>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: 24 }}>{error}</div>}

      <div className="stats-strip">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <span className="stat-card__icon">{s.icon}</span>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Recent workouts</h2>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <h3>No workouts yet</h3>
          <p>Log your first session to get AI weight suggestions.</p>
          <Link to="/log" className="btn btn-primary" style={{ marginTop: 18 }}>
            Log workout
          </Link>
        </div>
      ) : (
        <>
          <div className="workout-list">
            {displayed.map((session, i) => {
              const exIds = Array.from(new Set(session.sets.map((s) => s.exercise_id)));
              return (
                <Link
                  key={session.id}
                  to={`/workouts/${session.id}`}
                  className="workout-card"
                  style={i < 12 ? { animationDelay: `${i * 40}ms` } : undefined}
                >
                  <div className="workout-card__rail" />
                  <div className="workout-card__body">
                    <div className="workout-card__meta">
                      <span className="workout-card__date">{formatDate(session.date)}</span>
                      <span className="workout-card__sets">{session.sets.length} sets</span>
                    </div>
                    <div className="workout-card__name">{session.workout_name}</div>
                    {session.notes && (
                      <div className="workout-card__notes">{session.notes}</div>
                    )}
                    <div className="workout-card__exercises">
                      {exIds.slice(0, 4).map((exId) => (
                        <span key={exId} className="exercise-chip">
                          {exName.get(exId) ?? `Exercise #${exId}`}
                        </span>
                      ))}
                      {exIds.length > 4 && (
                        <span className="exercise-chip exercise-chip--more">+{exIds.length - 4}</span>
                      )}
                    </div>
                  </div>
                  <svg className="workout-card__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              );
            })}
          </div>

          {sessions.length > RECENT_LIMIT && !showAll && (
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
