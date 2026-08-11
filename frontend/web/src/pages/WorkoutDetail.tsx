import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteWorkout, getExercises, getWorkout } from '../api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import type { Exercise, WorkoutSession } from '../types/api';
import './WorkoutDetail.css';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function WorkoutDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exMap = useMemo(
    () => new Map(exercises.map((e) => [e.id, e.name])),
    [exercises]
  );

  useEffect(() => {
    if (!id) return;
    Promise.all([getWorkout(Number(id)), getExercises()])
      .then(([sess, exs]) => {
        setSession(sess);
        setExercises(exs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDelete() {
    if (!session) return;
    setDeleting(true);
    try {
      await deleteWorkout(session.id);
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  if (loading) return (
    <div className="page"><div className="spinner-page"><div className="spinner" /></div></div>
  );

  if (error) return (
    <div className="page"><div className="error-msg">{error}</div></div>
  );

  if (!session) return null;

  // Group sets by exercise
  const byExercise = new Map<number, typeof session.sets>();
  for (const set of session.sets) {
    if (!byExercise.has(set.exercise_id)) byExercise.set(set.exercise_id, []);
    byExercise.get(set.exercise_id)!.push(set);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn btn-ghost back-btn" onClick={() => navigate('/')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15,18 9,12 15,6" />
            </svg>
            Back
          </button>
          <h1 className="page-title" style={{ marginTop: 8 }}>{session.workout_name}</h1>
          <p className="workout-date">{formatDate(session.date)}</p>
        </div>
        <button
          className="btn btn-danger"
          onClick={() => setShowConfirm(true)}
          disabled={deleting}
        >
          {deleting ? <><div className="spinner spinner-sm" /> Deleting…</> : 'Delete'}
        </button>
      </div>

      {session.notes && (
        <div className="workout-notes card">{session.notes}</div>
      )}

      <div className="detail-summary">
        <span><strong>{session.sets.length}</strong> sets</span>
        <span><strong>{byExercise.size}</strong> exercises</span>
      </div>

      <div className="exercise-blocks">
        {Array.from(byExercise.entries()).map(([exId, sets]) => (
          <div key={exId} className="exercise-block card">
            <h3 className="exercise-block__name">
              {exMap.get(exId) ?? `Exercise #${exId}`}
            </h3>
            <table className="sets-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Weight</th>
                  <th>Reps</th>
                  <th>RPE</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sets.map((set) => (
                  <tr key={set.id}>
                    <td className="set-num">{set.set_order}</td>
                    <td>{set.weight != null ? `${set.weight} kg` : '—'}</td>
                    <td>{set.reps ?? '—'}</td>
                    <td>{set.rpe ?? '—'}</td>
                    <td className="set-notes">{set.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {showConfirm && (
        <ConfirmModal
          title="Delete workout?"
          message={`"${session.workout_name}" on ${formatDate(session.date)} and all its sets will be permanently deleted.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
