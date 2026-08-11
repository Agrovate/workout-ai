import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getWorkouts } from '../api/client';
import type { WorkoutSession } from '../types/api';
import type { RootStackParamList } from '../navigation/types';
import { colors, shared } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function thisWeekCount(sessions: WorkoutSession[]) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  return sessions.filter((s) => new Date(s.date + 'T00:00:00') >= weekAgo).length;
}

function mostTrainedSets(sessions: WorkoutSession[]): number {
  const counts = new Map<number, number>();
  for (const s of sessions)
    for (const set of s.sets)
      counts.set(set.exercise_id, (counts.get(set.exercise_id) ?? 0) + 1);
  return counts.size > 0 ? Math.max(...counts.values()) : 0;
}

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback((isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    getWorkouts()
      .then(setSessions)
      .catch((e: Error) => setError(e.message))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  // Reload whenever the tab comes into focus (e.g. after logging a workout)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={[shared.screen, s.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const displayed = showAll ? sessions : sessions.slice(0, 8);

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={shared.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(true); }}
          tintColor={colors.accent}
        />
      }
    >
      <View style={s.header}>
        <Text style={shared.pageTitle}>Dashboard</Text>
        <TouchableOpacity style={shared.primaryBtn} onPress={() => navigation.navigate('LogWorkout')}>
          <Text style={shared.primaryBtnText}>+ Log Workout</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={shared.error}>{error}</Text>}

      <View style={s.statsStrip}>
        <StatCard value={sessions.length} label="Workouts" />
        <StatCard value={thisWeekCount(sessions)} label="This Week" />
        <StatCard value={sessions.reduce((n, s) => n + s.sets.length, 0)} label="Total Sets" />
        <StatCard value={mostTrainedSets(sessions) || '—'} label="Best Sets" />
      </View>

      <Text style={shared.sectionTitle}>Recent Workouts</Text>

      {sessions.length === 0 ? (
        <View style={shared.emptyState}>
          <Text style={shared.emptyTitle}>No workouts yet</Text>
          <Text style={shared.emptyText}>Start by logging your first session.</Text>
          <TouchableOpacity
            style={[shared.primaryBtn, { marginTop: 20 }]}
            onPress={() => navigation.navigate('LogWorkout')}
          >
            <Text style={shared.primaryBtnText}>Log Workout</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {displayed.map((session) => {
            const uniqueExIds = Array.from(new Set(session.sets.map((s) => s.exercise_id)));
            return (
              <TouchableOpacity
                key={session.id}
                style={s.workoutCard}
                onPress={() => navigation.navigate('WorkoutDetail', { id: session.id })}
                activeOpacity={0.7}
              >
                <View style={s.cardMeta}>
                  <Text style={s.cardDate}>{formatDate(session.date)}</Text>
                  <Text style={s.cardSets}>{session.sets.length} sets</Text>
                </View>
                <Text style={s.cardName}>{session.workout_name}</Text>
                {session.notes ? (
                  <Text style={s.cardNotes} numberOfLines={1}>{session.notes}</Text>
                ) : null}
                <View style={s.chips}>
                  {uniqueExIds.slice(0, 4).map((id) => (
                    <View key={id} style={s.chip}>
                      <Text style={s.chipText}>#{id}</Text>
                    </View>
                  ))}
                  {uniqueExIds.length > 4 && (
                    <View style={s.chip}>
                      <Text style={s.chipText}>+{uniqueExIds.length - 4}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          {sessions.length > 8 && !showAll && (
            <TouchableOpacity
              style={[shared.secondaryBtn, { marginTop: 8 }]}
              onPress={() => setShowAll(true)}
            >
              <Text style={shared.secondaryBtnText}>Show all {sessions.length} workouts</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  statsStrip: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.accent,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textSec,
    marginTop: 2,
    textAlign: 'center',
  },
  workoutCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 12,
    color: colors.textSec,
  },
  cardSets: {
    fontSize: 12,
    color: colors.textSec,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  cardNotes: {
    fontSize: 13,
    color: colors.textSec,
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  chip: {
    backgroundColor: colors.accentDim,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: '500',
  },
});
