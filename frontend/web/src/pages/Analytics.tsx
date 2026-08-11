import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { getWorkouts, getExercises } from '../api/client';
import type { WorkoutSession, Exercise } from '../types/api';
import './Analytics.css';

// ── helpers ──────────────────────────────────────────────────────────────────

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtWeek(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function volume(weight: number | null, reps: number | null): number {
  return (weight ?? 0) * (reps ?? 0);
}

// ── custom tooltip ────────────────────────────────────────────────────────────

const VolumeTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      <div className="chart-tooltip__row">
        <span style={{ color: 'var(--accent)' }}>Volume</span>
        <strong>{Number(payload[0].value).toLocaleString()} kg</strong>
      </div>
      {payload[1] && (
        <div className="chart-tooltip__row">
          <span style={{ color: 'var(--success)' }}>Sessions</span>
          <strong>{payload[1].value}</strong>
        </div>
      )}
    </div>
  );
};

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

  // ── weekly volume ──────────────────────────────────────────────────────────

  const weeklyData = useMemo(() => {
    const map = new Map<string, { vol: number; sessions: number; key: Date }>();
    sessions.forEach((s) => {
      const d = startOfWeek(new Date(s.date + 'T00:00:00'));
      const k = d.toISOString();
      const prev = map.get(k) ?? { vol: 0, sessions: 0, key: d };
      prev.vol += s.sets.reduce((a, st) => a + volume(st.weight, st.reps), 0);
      prev.sessions += 1;
      map.set(k, prev);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([, v]) => ({
        week: fmtWeek(v.key),
        volume: Math.round(v.vol),
        sessions: v.sessions,
      }));
  }, [sessions]);

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
      .map(([date, weight]) => ({ date: fmtDate(date), weight }));
  }, [sessions, exercises, selectedExercise]);

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

          {/* weekly volume chart */}
          <div className="card analytics__chart-card">
            <h2 className="analytics__chart-title">Weekly Volume</h2>
            <p className="analytics__chart-sub">Total training load (weight × reps) per week</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="week" tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} width={55}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} />
                <Tooltip content={<VolumeTooltip />} cursor={{ fill: 'rgba(168,85,247,0.08)' }} />
                <Bar dataKey="volume" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
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
                <LineChart data={progressionData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} width={45}
                    domain={['auto', 'auto']} />
                  <Tooltip content={<ProgressionTooltip />} />
                  <Line
                    type="monotone" dataKey="weight" name="Weight"
                    stroke="var(--accent)" strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
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
