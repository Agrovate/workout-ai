import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { getWorkouts, getExercises, getPrediction } from '../api/client';
import type { WorkoutSession, Exercise, PredictionResponse } from '../types/api';
import './Analytics.css';

// ── helpers ──────────────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function volume(weight: number | null, reps: number | null): number {
  return (weight ?? 0) * (reps ?? 0);
}

// ── activity heatmap ──────────────────────────────────────────────────────────

function ActivityHeatmap({ sessions }: { sessions: WorkoutSession[] }) {
  const { weeks } = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => {
      map.set(s.date, (map.get(s.date) ?? 0) + 1);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = localDateStr(today);

    // Start from the Sunday 52 weeks ago
    const start = new Date(today);
    start.setDate(today.getDate() - 52 * 7);
    start.setDate(start.getDate() - start.getDay());

    const weeks: { date: string; count: number; isToday: boolean; isFuture: boolean }[][] = [];
    const current = new Date(start);

    for (let w = 0; w < 53; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = localDateStr(current);
        week.push({
          date: dateStr,
          count: map.get(dateStr) ?? 0,
          isToday: dateStr === todayStr,
          isFuture: current > today,
        });
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
    }

    return { weeks };
  }, [sessions]);

  // Fixed thresholds so a single-session day always shows as the lightest shade
  const LEVEL_COLORS = ['var(--heatmap-empty)', '#c084fc', '#a855f7', '#7c3aed', '#581c87'];

  function cellColor(count: number, isFuture: boolean): string {
    if (isFuture || count === 0) return LEVEL_COLORS[0];
    return LEVEL_COLORS[Math.min(4, count)];
  }

  return (
    <div className="heatmap">
      <div className="heatmap__months">
        {weeks.map((week, wi) => {
          const d = new Date(week[0].date + 'T00:00:00');
          const prev = wi > 0 ? new Date(weeks[wi - 1][0].date + 'T00:00:00') : null;
          const label = (!prev || d.getMonth() !== prev.getMonth())
            ? d.toLocaleDateString('en-US', { month: 'short' })
            : '';
          return <span key={wi} className="heatmap__month-label">{label}</span>;
        })}
      </div>
      <div className="heatmap__grid">
        {weeks.map((week, wi) => (
          <div key={wi} className="heatmap__week">
            {week.map((day) => (
              <div
                key={day.date}
                className={`heatmap__cell${day.isToday ? ' heatmap__cell--today' : ''}`}
                style={{ background: cellColor(day.count, day.isFuture) }}
                title={day.isFuture ? '' : `${day.date}: ${day.count} workout${day.count !== 1 ? 's' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap__legend">
        <span>Less</span>
        {LEVEL_COLORS.map((color, i) => (
          <div key={i} className="heatmap__cell" style={{ background: color }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ── custom tooltip ────────────────────────────────────────────────────────────

const ProgressionTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="chart-tooltip__row">
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{p.value} kg</strong>
        </div>
      ))}
    </div>
  );
};

// ── main component ────────────────────────────────────────────────────────────

export function Analytics() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedExercise, setSelectedExercise] = useState('');
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [predicting, setPredicting] = useState(false);

  useEffect(() => {
    Promise.all([getWorkouts(), getExercises()])
      .then(([s, e]) => {
        setSessions(s);
        setExercises(e);
        if (e.length > 0) setSelectedExercise(e[0].name);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedExercise) return;
    setPrediction(null);
    setPredicting(true);
    getPrediction({ exercise_name: selectedExercise })
      .then(setPrediction)
      .catch(() => setPrediction(null))
      .finally(() => setPredicting(false));
  }, [selectedExercise]);

  // exercise id → name map
  const exMap = useMemo(() => {
    const m: Record<number, Exercise> = {};
    exercises.forEach((e) => (m[e.id] = e));
    return m;
  }, [exercises]);

  // ── summary stats ──────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalSets = sessions.reduce((a, s) => a + s.sets.length, 0);
    const totalVol = sessions.reduce(
      (a, s) => a + s.sets.reduce((b, st) => b + volume(st.weight, st.reps), 0),
      0,
    );
    const weeks = sessions.length > 0
      ? Math.max(
          1,
          Math.ceil(
            (new Date().getTime() -
              new Date(sessions[sessions.length - 1].date).getTime()) /
              (7 * 86400_000),
          ),
        )
      : 1;
    const prCount = exercises.filter((ex) => {
      return sessions.some((s) => s.sets.some((st) => st.exercise_id === ex.id && st.weight));
    }).length;

    return {
      totalWorkouts: sessions.length,
      totalSets,
      totalVol: Math.round(totalVol),
      avgPerWeek: (sessions.length / weeks).toFixed(1),
      prCount,
    };
  }, [sessions, exercises]);

  // ── exercise progression ───────────────────────────────────────────────────

  const exercisesWithData = useMemo(() => {
    return exercises.filter((ex) =>
      sessions.some((s) =>
        s.sets.some((st) => st.exercise_id === ex.id && st.weight != null),
      ),
    );
  }, [sessions, exercises]);

  const progressionData = useMemo(() => {
    if (!selectedExercise) return [];
    const ex = exercises.find((e) => e.name === selectedExercise);
    if (!ex) return [];
    const byDate = new Map<string, number>();
    sessions.forEach((s) => {
      const max = Math.max(
        0,
        ...s.sets
          .filter((st) => st.exercise_id === ex.id && st.weight != null)
          .map((st) => st.weight!),
      );
      if (max > 0) byDate.set(s.date, Math.max(byDate.get(s.date) ?? 0, max));
    });
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, weight]) => ({ date: fmtDate(date), weight, predicted: undefined as number | undefined }));
  }, [sessions, exercises, selectedExercise]);

  // Merge historical + predicted into one chart dataset
  const progressionChartData = useMemo(() => {
    if (!prediction || progressionData.length === 0) return progressionData;
    const lastWeight = progressionData[progressionData.length - 1].weight;
    return [
      ...progressionData,
      { date: 'Next', weight: lastWeight, predicted: prediction.recommended_weight },
    ];
  }, [progressionData, prediction]);

  // ── muscle group volume ────────────────────────────────────────────────────

  const muscleData = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) =>
      s.sets.forEach((st) => {
        const ex = exMap[st.exercise_id];
        const group = ex?.muscle_group ?? 'Other';
        map.set(group, (map.get(group) ?? 0) + 1);
      }),
    );
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([group, sets]) => ({ group, sets }));
  }, [sessions, exMap]);

  const MUSCLE_COLORS = [
    '#a855f7', '#22c55e', '#3b82f6', '#f59e0b',
    '#ec4899', '#14b8a6', '#f97316', '#8b5cf6',
  ];

  // ── personal records ───────────────────────────────────────────────────────

  const records = useMemo(() => {
    const map = new Map<number, { weight: number; date: string; reps: number }>();
    sessions.forEach((s) =>
      s.sets.forEach((st) => {
        if (st.weight == null) return;
        const prev = map.get(st.exercise_id);
        if (!prev || st.weight > prev.weight) {
          map.set(st.exercise_id, { weight: st.weight, date: s.date, reps: st.reps ?? 0 });
        }
      }),
    );
    return Array.from(map.entries())
      .map(([id, v]) => ({ exercise: exMap[id]?.name ?? `#${id}`, ...v }))
      .sort((a, b) => b.weight - a.weight);
  }, [sessions, exMap]);

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) return <div className="spinner-page"><div className="spinner" /></div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  const empty = sessions.length === 0;

  return (
    <div className="page analytics">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
      </div>

      {empty ? (
        <div className="empty-state">
          <h3>No workout data yet</h3>
          <p>Log some workouts to see your analytics.</p>
        </div>
      ) : (
        <>
          {/* summary stats */}
          <div className="analytics__stats">
            <div className="stat-card">
              <div className="stat-card__value">{stats.totalWorkouts}</div>
              <div className="stat-card__label">Total Workouts</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__value">{stats.avgPerWeek}</div>
              <div className="stat-card__label">Avg / Week</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__value">{stats.totalSets.toLocaleString()}</div>
              <div className="stat-card__label">Total Sets</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__value">{stats.totalVol.toLocaleString()}</div>
              <div className="stat-card__label">Total Volume (kg)</div>
            </div>
          </div>

          {/* activity heatmap */}
          <div className="card analytics__chart-card">
            <h2 className="analytics__chart-title">Activity</h2>
            <p className="analytics__chart-sub">Workout frequency over the past year</p>
            <ActivityHeatmap sessions={sessions} />
          </div>

          <div className="analytics__row">
            {/* exercise progression */}
            <div className="card analytics__chart-card analytics__chart-card--half">
              <div className="analytics__chart-header">
                <div>
                  <h2 className="analytics__chart-title">Weight Progression</h2>
                  <p className="analytics__chart-sub">Max weight per session</p>
                </div>
                <select
                  className="analytics__select"
                  value={selectedExercise}
                  onChange={(e) => setSelectedExercise(e.target.value)}
                >
                  {exercisesWithData.map((ex) => (
                    <option key={ex.id} value={ex.name}>{ex.name}</option>
                  ))}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={progressionChartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} width={45}
                    domain={['auto', 'auto']} />
                  <Tooltip content={<ProgressionTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Line
                    type="monotone" dataKey="weight" name="Historical"
                    stroke="var(--accent)" strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone" dataKey="predicted" name="Predicted"
                    stroke="#22c55e" strokeWidth={2} strokeDasharray="6 3"
                    dot={{ r: 4, fill: '#22c55e', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>

              {/* Prediction card */}
              {predicting && (
                <div className="pred-card pred-card--loading">
                  <span className="spinner spinner-sm" /> Calculating prediction…
                </div>
              )}
              {!predicting && prediction && (
                <div className="pred-card">
                  <div className="pred-card__header">
                    <span className="pred-card__dot" />
                    Next session prediction
                  </div>
                  <div className="pred-card__stats">
                    <div className="pred-card__stat">
                      <span className="pred-card__value">{prediction.recommended_weight}</span>
                      <span className="pred-card__unit">kg</span>
                    </div>
                    <div className="pred-card__divider" />
                    <div className="pred-card__stat">
                      <span className="pred-card__value">{prediction.recommended_reps}</span>
                      <span className="pred-card__unit">reps</span>
                    </div>
                    {prediction.confidence != null && (
                      <>
                        <div className="pred-card__divider" />
                        <div className="pred-card__stat">
                          <span className="pred-card__value">{Math.round(prediction.confidence * 100)}%</span>
                          <span className="pred-card__unit">confidence</span>
                        </div>
                      </>
                    )}
                  </div>
                  {prediction.confidence != null && (
                    <div className="pred-card__conf-track">
                      <div className="pred-card__conf-fill" style={{ width: `${Math.round(prediction.confidence * 100)}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* muscle group distribution */}
            <div className="card analytics__chart-card analytics__chart-card--half">
              <h2 className="analytics__chart-title">Sets by Muscle Group</h2>
              <p className="analytics__chart-sub">Total sets logged per muscle group</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={muscleData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="group" tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip cursor={{ fill: 'rgba(168,85,247,0.08)' }} contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-h)' }} />
                  <Bar dataKey="sets" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {muscleData.map((_, i) => (
                      <Cell key={i} fill={MUSCLE_COLORS[i % MUSCLE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* personal records */}
          <div className="card">
            <h2 className="analytics__chart-title" style={{ marginBottom: 16 }}>Personal Records</h2>
            <div className="analytics__pr-grid">
              {records.map((r) => (
                <div key={r.exercise} className="pr-card">
                  <div className="pr-card__name">{r.exercise}</div>
                  <div className="pr-card__weight">{r.weight} <span>kg</span></div>
                  <div className="pr-card__meta">
                    {r.reps > 0 && <span>{r.reps} reps · </span>}
                    <span>{fmtDate(r.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
