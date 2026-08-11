import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWorkout, getExercises, getPrediction } from '../api/client';
import type { Exercise } from '../types/api';
import './LogWorkout.css';

interface DraftSet {
  key: string;
  exercise_id: string;
  weight: string;
  reps: string;
  rpe: string;
  notes: string;
  predicting: boolean;
  expanded: boolean;
}

let keyCounter = 0;
const makeSet = (exercise_id = ''): DraftSet => ({
  key: String(++keyCounter),
  exercise_id,
  weight: '',
  reps: '',
  rpe: '',
  notes: '',
  predicting: false,
  expanded: false,
});

function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function parseInt2(s: string): number | null {
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

export function LogWorkout() {
  const navigate = useNavigate();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(true);

  const [sessionName, setSessionName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [sets, setSets] = useState<DraftSet[]>([makeSet()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const exMap = new Map(exercises.map((e) => [e.id, e]));

  useEffect(() => {
    getExercises()
      .then(setExercises)
      .catch(() => {})
      .finally(() => setLoadingExercises(false));
  }, []);

  function updateSet(key: string, patch: Partial<DraftSet>) {
    setSets((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function addSet() {
    const last = sets[sets.length - 1];
    const newSet = makeSet(last?.exercise_id ?? '');
    setSets((prev) => [...prev, newSet]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  function removeSet(key: string) {
    setSets((prev) => prev.filter((s) => s.key !== key));
  }

  async function getSuggestion(key: string, exerciseId: string) {
    const ex = exMap.get(Number(exerciseId));
    if (!ex) return;
    updateSet(key, { predicting: true });
    try {
      const pred = await getPrediction({ exercise_name: ex.name });
      updateSet(key, {
        predicting: false,
        weight: pred.recommended_weight > 0 ? String(pred.recommended_weight) : '',
        reps: String(pred.recommended_reps),
      });
    } catch {
      updateSet(key, { predicting: false });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionName.trim()) { setError('Workout name is required.'); return; }
    const invalidSet = sets.find((s) => !s.exercise_id);
    if (invalidSet) { setError('All sets must have an exercise selected.'); return; }

    setError(null);
    setSubmitting(true);
    try {
      await createWorkout({
        workout_name: sessionName.trim(),
        date,
        notes: notes.trim() || null,
        sets: sets.map((s, i) => ({
          exercise_id: Number(s.exercise_id),
          set_order: i + 1,
          weight: parseNum(s.weight),
          reps: parseInt2(s.reps),
          rpe: parseNum(s.rpe),
          notes: s.notes.trim() || null,
        })),
      });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workout.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Log Workout</h1>
      </div>

      <form onSubmit={handleSubmit} className="log-form">
        <div className="log-session-header card">
          <div className="field-row">
            <div className="field" style={{ flex: 2 }}>
              <label>Workout Name *</label>
              <input
                type="text"
                placeholder="e.g. Push Day A"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Notes</label>
            <input
              type="text"
              placeholder="Optional notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="sets-section">
          <div className="sets-header">
            <h2 className="sets-title">Sets <span className="sets-count">{sets.length}</span></h2>
          </div>

          {sets.map((set, idx) => (
            <div key={set.key} className="set-row card">
              <div className="set-row__num">{idx + 1}</div>
              <div className="set-row__body">
                <div className="field-row set-row__main">
                  <div className="field set-row__exercise">
                    <label>Exercise</label>
                    {loadingExercises ? (
                      <div style={{ padding: '8px 0' }}><div className="spinner spinner-sm" /></div>
                    ) : (
                      <select
                        value={set.exercise_id}
                        onChange={(e) => updateSet(set.key, { exercise_id: e.target.value })}
                      >
                        <option value="">— Select exercise —</option>
                        {exercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>{ex.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="field set-row__weight">
                    <label>Weight (kg)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="0"
                      value={set.weight}
                      onChange={(e) => updateSet(set.key, { weight: e.target.value })}
                    />
                  </div>
                  <div className="field set-row__reps">
                    <label>Reps</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="0"
                      value={set.reps}
                      onChange={(e) => updateSet(set.key, { reps: e.target.value })}
                    />
                  </div>
                </div>

                <div className="set-row__actions">
                  {set.exercise_id && (
                    <button
                      type="button"
                      className="btn btn-ghost ai-btn"
                      onClick={() => getSuggestion(set.key, set.exercise_id)}
                      disabled={set.predicting}
                      title="Get AI suggestion"
                    >
                      {set.predicting
                        ? <><div className="spinner spinner-sm" /> Thinking…</>
                        : <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 8v4l3 3" />
                            </svg>
                            AI suggest
                          </>
                      }
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => updateSet(set.key, { expanded: !set.expanded })}
                  >
                    {set.expanded ? 'Less' : 'More'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost set-row__remove"
                    onClick={() => removeSet(set.key)}
                    disabled={sets.length === 1}
                    title="Remove set"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {set.expanded && (
                  <div className="field-row set-row__extra">
                    <div className="field">
                      <label>RPE (1–10)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="1"
                        max="10"
                        placeholder="—"
                        value={set.rpe}
                        onChange={(e) => updateSet(set.key, { rpe: e.target.value })}
                      />
                    </div>
                    <div className="field" style={{ flex: 2 }}>
                      <label>Notes</label>
                      <input
                        type="text"
                        placeholder="Optional…"
                        value={set.notes}
                        onChange={(e) => updateSet(set.key, { notes: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />

          <button type="button" className="btn btn-secondary add-set-btn" onClick={addSet}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Set
          </button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="log-form__submit">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/')}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? <><div className="spinner spinner-sm" /> Saving…</> : 'Save Workout'}
          </button>
        </div>
      </form>
    </div>
  );
}
