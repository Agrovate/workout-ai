import { useEffect, useMemo, useState } from 'react';
import { createExercise, getExercises } from '../api/client';
import type { Exercise } from '../types/api';
import './Exercises.css';

export function Exercises() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    getExercises()
      .then(setExercises)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return exercises;
    const q = search.toLowerCase();
    return exercises.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.muscle_group?.toLowerCase().includes(q) ?? false)
    );
  }, [exercises, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Exercise[]>();
    for (const ex of filtered) {
      const key = ex.muscle_group ?? 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ex);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const ex = await createExercise({
        name: name.trim(),
        muscle_group: muscleGroup.trim() || null,
      });
      setExercises((prev) => [...prev, ex].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setMuscleGroup('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add exercise';
      setAddError(msg.includes('409') || msg.toLowerCase().includes('conflict')
        ? 'An exercise with that name already exists.'
        : msg);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Exercises</h1>
        <span className="exercises-count">{exercises.length} exercises</span>
      </div>

      <div className="exercises-layout">
        <div className="exercises-panel">
          <div className="field" style={{ marginBottom: 20 }}>
            <input
              type="search"
              placeholder="Search by name or muscle group…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="spinner-page"><div className="spinner" /></div>
          ) : error ? (
            <div className="error-msg">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <h3>{search ? 'No matches' : 'No exercises'}</h3>
              <p>{search ? 'Try a different search.' : 'Add your first exercise.'}</p>
            </div>
          ) : (
            <div className="exercise-groups">
              {grouped.map(([group, exs]) => (
                <div key={group} className="exercise-group">
                  <div className="exercise-group__label">{group}</div>
                  <ul className="exercise-group__list">
                    {exs.map((ex) => (
                      <li key={ex.id} className="exercise-item">
                        <span className="exercise-item__name">{ex.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="add-exercise-panel">
          <h2 className="panel-title">Add Exercise</h2>
          <form onSubmit={handleAdd} className="add-exercise-form">
            <div className="field">
              <label>Name *</label>
              <input
                type="text"
                placeholder="e.g. Squat"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Muscle Group</label>
              <input
                type="text"
                placeholder="e.g. Legs, Chest, Back…"
                value={muscleGroup}
                onChange={(e) => setMuscleGroup(e.target.value)}
              />
            </div>
            {addError && <div className="error-msg">{addError}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={adding || !name.trim()}
            >
              {adding ? <><div className="spinner spinner-sm" /> Adding…</> : 'Add Exercise'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
