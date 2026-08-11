import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator,
  StyleSheet, Dimensions, TouchableOpacity,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { getExercises, getPrediction, getWorkouts } from '../api/client';
import type { Exercise, PredictionResponse, WorkoutSession } from '../types/api';
import { colors, shared, chartConfig } from '../theme';

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 32; // 16px padding each side

const MUSCLE_COLORS = [
  '#a855f7', '#22c55e', '#3b82f6', '#f59e0b',
  '#ec4899', '#14b8a6', '#f97316', '#8b5cf6',
];

// empty, 1 session, 2, 3, 4+
const HEAT_COLORS = ['#1e1e2e', '#c084fc', '#a855f7', '#7c3aed', '#581c87'];

// ── helpers ─────────────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function vol(weight: number | null, reps: number | null): number {
  return (weight ?? 0) * (reps ?? 0);
}

// ── component ────────────────────────────────────────────────────────────────

export function AnalyticsScreen() {
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
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetch prediction whenever the selected exercise changes
  useEffect(() => {
    if (!selectedExercise) return;
    setPrediction(null);
    setPredicting(true);
    getPrediction({ exercise_name: selectedExercise })
      .then(setPrediction)
      .catch(() => setPrediction(null))
      .finally(() => setPredicting(false));
  }, [selectedExercise]);

  const exMap = useMemo(() => {
    const m: Record<number, Exercise> = {};
    exercises.forEach((e) => (m[e.id] = e));
    return m;
  }, [exercises]);

  // Summary stats
  const stats = useMemo(() => {
    const totalSets = sessions.reduce((a, s) => a + s.sets.length, 0);
    const totalVol = sessions.reduce(
      (a, s) => a + s.sets.reduce((b, st) => b + vol(st.weight, st.reps), 0),
      0,
    );
    const weeks = sessions.length > 0
      ? Math.max(1, Math.ceil(
          (Date.now() - new Date(sessions[sessions.length - 1].date + 'T00:00:00').getTime()) /
          (7 * 86_400_000),
        ))
      : 1;
    return {
      totalWorkouts: sessions.length,
      totalSets,
      totalVol: Math.round(totalVol),
      avgPerWeek: (sessions.length / weeks).toFixed(1),
    };
  }, [sessions]);

  // Activity heatmap data — last 16 weeks
  const activityWeeks = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => {
      map.set(s.date, (map.get(s.date) ?? 0) + 1);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = localDateStr(today);

    const start = new Date(today);
    start.setDate(today.getDate() - 15 * 7);
    start.setDate(start.getDate() - start.getDay()); // align to Sunday

    const weeks: { date: string; count: number; isToday: boolean; isFuture: boolean }[][] = [];
    const current = new Date(start);

    for (let w = 0; w < 16; w++) {
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
    return weeks;
  }, [sessions]);

  // Weight progression data
  const exercisesWithData = useMemo(
    () =>
      exercises.filter((ex) =>
        sessions.some((s) =>
          s.sets.some((st) => st.exercise_id === ex.id && st.weight != null),
        ),
      ),
    [sessions, exercises],
  );

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

  // Muscle group distribution
  const muscleData = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) =>
      s.sets.forEach((st) => {
        const group = exMap[st.exercise_id]?.muscle_group ?? 'Other';
        map.set(group, (map.get(group) ?? 0) + 1);
      }),
    );
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([group, sets]) => ({ group, sets }));
  }, [sessions, exMap]);

  // Personal records
  const records = useMemo(() => {
    const map = new Map<number, { weight: number; date: string; reps: number }>();
    sessions.forEach((s) =>
      s.sets.forEach((st) => {
        if (st.weight == null) return;
        const prev = map.get(st.exercise_id);
        if (!prev || st.weight > prev.weight)
          map.set(st.exercise_id, { weight: st.weight, date: s.date, reps: st.reps ?? 0 });
      }),
    );
    return Array.from(map.entries())
      .map(([id, v]) => ({ exercise: exMap[id]?.name ?? `#${id}`, ...v }))
      .sort((a, b) => b.weight - a.weight);
  }, [sessions, exMap]);

  if (loading) {
    return (
      <View style={[shared.screen, s.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[shared.screen, { padding: 16 }]}>
        <Text style={shared.error}>{error}</Text>
      </View>
    );
  }

  if (sessions.length === 0) {
    return (
      <View style={[shared.screen, s.center, { padding: 32 }]}>
        <Text style={shared.emptyTitle}>No workout data yet</Text>
        <Text style={shared.emptyText}>Log some workouts to see your analytics.</Text>
      </View>
    );
  }

  const maxMuscle = muscleData.length > 0 ? Math.max(...muscleData.map((d) => d.sets)) : 1;

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      {/* Summary stats */}
      <View style={s.statsRow}>
        <StatCard value={stats.totalWorkouts} label="Workouts" />
        <StatCard value={stats.avgPerWeek} label="Avg/Week" />
        <StatCard value={stats.totalSets} label="Total Sets" />
        <StatCard value={`${(stats.totalVol / 1000).toFixed(1)}k`} label="Vol (kg)" />
      </View>

      {/* Activity heatmap */}
      <View style={s.chartCard}>
        <Text style={s.chartTitle}>Activity</Text>
        <Text style={s.chartSub}>Workout frequency — past 16 weeks</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
          <View>
            {/* Month labels */}
            <View style={s.heatMonthRow}>
              {activityWeeks.map((week, wi) => {
                const d = new Date(week[0].date + 'T00:00:00');
                const prev = wi > 0 ? new Date(activityWeeks[wi - 1][0].date + 'T00:00:00') : null;
                const label = (!prev || d.getMonth() !== prev.getMonth())
                  ? d.toLocaleDateString('en-US', { month: 'short' })
                  : '';
                return <Text key={wi} style={s.heatMonthLabel}>{label}</Text>;
              })}
            </View>
            {/* Grid */}
            <View style={s.heatGrid}>
              {activityWeeks.map((week, wi) => (
                <View key={wi} style={s.heatWeek}>
                  {week.map((day) => {
                    const bg = HEAT_COLORS[
                      day.isFuture || day.count === 0 ? 0 : Math.min(4, day.count)
                    ];
                    return (
                      <View
                        key={day.date}
                        style={[
                          s.heatCell,
                          { backgroundColor: bg },
                          day.isToday && s.heatCellToday,
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
            {/* Legend */}
            <View style={s.heatLegend}>
              <Text style={s.heatLegendText}>Less</Text>
              {HEAT_COLORS.map((color, i) => (
                <View key={i} style={[s.heatCell, { backgroundColor: color }]} />
              ))}
              <Text style={s.heatLegendText}>More</Text>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Weight progression line chart */}
      {exercisesWithData.length > 0 && (
        <View style={s.chartCard}>
          <Text style={s.chartTitle}>Weight Progression</Text>
          <Text style={s.chartSub}>Max weight per session</Text>

          {/* Exercise selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.exSelector}>
            {exercisesWithData.map((ex) => (
              <TouchableOpacity
                key={ex.id}
                style={[s.exChip, selectedExercise === ex.name && s.exChipActive]}
                onPress={() => setSelectedExercise(ex.name)}
              >
                <Text style={[s.exChipText, selectedExercise === ex.name && s.exChipTextActive]}>
                  {ex.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {progressionData.length > 1 ? (
            <>
              <LineChart
                data={{
                  labels: [
                    ...progressionData.map((d) => d.date),
                    ...(prediction ? ['Next'] : []),
                  ],
                  datasets: [
                    {
                      // Historical line — purple
                      data: [
                        ...progressionData.map((d) => d.weight),
                        ...(prediction ? [progressionData[progressionData.length - 1].weight] : []),
                      ],
                      color: (opacity = 1) => `rgba(168,85,247,${opacity})`,
                    },
                    ...(prediction
                      ? [{
                          // Predicted segment — green, starts from last historical point
                          data: [
                            ...progressionData.map(() => progressionData[progressionData.length - 1].weight),
                            prediction.recommended_weight,
                          ],
                          color: (opacity = 1) => `rgba(34,197,94,${opacity})`,
                        }]
                      : []),
                  ],
                  legend: prediction ? ['Historical', 'Predicted'] : ['Historical'],
                }}
                width={CHART_W - 32}
                height={200}
                chartConfig={chartConfig}
                bezier
                style={{ borderRadius: 8, marginTop: 8 }}
                yAxisLabel=""
                yAxisSuffix=" kg"
              />

              {/* Prediction card */}
              {predicting ? (
                <View style={s.predCard}>
                  <ActivityIndicator size="small" color={colors.success} />
                  <Text style={s.predLoading}>Calculating prediction…</Text>
                </View>
              ) : prediction ? (
                <View style={s.predCard}>
                  <View style={s.predHeader}>
                    <View style={s.predDot} />
                    <Text style={s.predTitle}>Next Session Prediction</Text>
                  </View>
                  <View style={s.predRow}>
                    <View style={s.predStat}>
                      <Text style={s.predValue}>{prediction.recommended_weight}</Text>
                      <Text style={s.predLabel}>kg</Text>
                    </View>
                    <View style={s.predDivider} />
                    <View style={s.predStat}>
                      <Text style={s.predValue}>{prediction.recommended_reps}</Text>
                      <Text style={s.predLabel}>reps</Text>
                    </View>
                    {prediction.confidence != null && (
                      <>
                        <View style={s.predDivider} />
                        <View style={s.predStat}>
                          <Text style={s.predValue}>
                            {Math.round(prediction.confidence * 100)}%
                          </Text>
                          <Text style={s.predLabel}>confidence</Text>
                        </View>
                      </>
                    )}
                  </View>
                  {prediction.confidence != null && (
                    <View style={s.confTrack}>
                      <View
                        style={[
                          s.confFill,
                          { width: `${Math.round(prediction.confidence * 100)}%` },
                        ]}
                      />
                    </View>
                  )}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={s.notEnough}>Not enough data points yet.</Text>
          )}
        </View>
      )}

      {/* Muscle group distribution */}
      {muscleData.length > 0 && (
        <View style={s.chartCard}>
          <Text style={s.chartTitle}>Sets by Muscle Group</Text>
          <Text style={s.chartSub}>Total sets logged per muscle group</Text>
          <View style={{ marginTop: 12, gap: 10 }}>
            {muscleData.map(({ group, sets: count }, i) => (
              <View key={group}>
                <View style={s.hbarLabelRow}>
                  <Text style={s.hbarLabel}>{group}</Text>
                  <Text style={s.hbarValue}>{count}</Text>
                </View>
                <View style={s.hbarTrack}>
                  <View
                    style={[
                      s.hbarFill,
                      {
                        width: `${(count / maxMuscle) * 100}%`,
                        backgroundColor: MUSCLE_COLORS[i % MUSCLE_COLORS.length],
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Personal records */}
      {records.length > 0 && (
        <View style={s.chartCard}>
          <Text style={s.chartTitle}>Personal Records</Text>
          <View style={s.prGrid}>
            {records.map((r) => (
              <View key={r.exercise} style={s.prCard}>
                <Text style={s.prName} numberOfLines={2}>{r.exercise}</Text>
                <Text style={s.prWeight}>
                  {r.weight} <Text style={s.prWeightUnit}>kg</Text>
                </Text>
                <Text style={s.prMeta}>
                  {r.reps > 0 ? `${r.reps} reps · ` : ''}{fmtDate(r.date)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.accent,
  },
  statLabel: {
    fontSize: 9,
    color: colors.textSec,
    marginTop: 2,
    textAlign: 'center',
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  chartSub: {
    fontSize: 12,
    color: colors.textSec,
    marginTop: 2,
  },
  exSelector: {
    marginTop: 10,
    marginBottom: 4,
  },
  exChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  exChipActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  exChipText: {
    fontSize: 12,
    color: colors.textSec,
  },
  exChipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  notEnough: {
    color: colors.textSec,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  predCard: {
    marginTop: 12,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    padding: 12,
    flexDirection: 'column',
    gap: 8,
  },
  predHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  predDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  predTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  predLoading: {
    fontSize: 12,
    color: colors.success,
    marginLeft: 8,
  },
  predRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  predStat: {
    flex: 1,
    alignItems: 'center',
  },
  predValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.success,
  },
  predLabel: {
    fontSize: 11,
    color: colors.textSec,
    marginTop: 2,
  },
  predDivider: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(34,197,94,0.3)',
  },
  confTrack: {
    height: 4,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  heatMonthRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  heatMonthLabel: {
    width: 14,
    fontSize: 9,
    color: colors.textSec,
    marginRight: 2,
  },
  heatGrid: {
    flexDirection: 'row',
    gap: 2,
  },
  heatWeek: {
    flexDirection: 'column',
    gap: 2,
  },
  heatCell: {
    width: 14,
    height: 14,
    borderRadius: 2,
  },
  heatCellToday: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  heatLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 8,
    justifyContent: 'flex-end',
  },
  heatLegendText: {
    fontSize: 10,
    color: colors.textSec,
    marginHorizontal: 2,
  },
  hbarLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  hbarLabel: {
    fontSize: 13,
    color: colors.text,
  },
  hbarValue: {
    fontSize: 13,
    color: colors.textSec,
  },
  hbarTrack: {
    height: 8,
    backgroundColor: colors.surface2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  hbarFill: {
    height: '100%',
    borderRadius: 4,
  },
  prGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  prCard: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    padding: 12,
    minWidth: '45%',
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  prName: {
    fontSize: 12,
    color: colors.textSec,
    marginBottom: 6,
  },
  prWeight: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.accent,
  },
  prWeightUnit: {
    fontSize: 14,
    color: colors.textSec,
    fontWeight: '400',
  },
  prMeta: {
    fontSize: 11,
    color: colors.textSec,
    marginTop: 4,
  },
});
