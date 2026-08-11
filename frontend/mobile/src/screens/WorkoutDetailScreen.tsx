import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { deleteWorkout, getExercises, getWorkout } from '../api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import type { Exercise, WorkoutSession } from '../types/api';
import type { RootStackParamList } from '../navigation/types';
import { colors, shared } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'WorkoutDetail'>;

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function WorkoutDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { id } = route.params;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exMap = useMemo(
    () => new Map(exercises.map((e) => [e.id, e.name])),
    [exercises],
  );

  useEffect(() => {
    Promise.all([getWorkout(id), getExercises()])
      .then(([sess, exs]) => {
        setSession(sess);
        setExercises(exs);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDelete() {
    if (!session) return;
    setDeleting(true);
    try {
      await deleteWorkout(session.id);
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  if (loading) {
    return (
      <View style={[shared.screen, s.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (error || !session) {
    return (
      <View style={[shared.screen, { padding: 16 }]}>
        <Text style={shared.error}>{error ?? 'Workout not found.'}</Text>
      </View>
    );
  }

  const byExercise = new Map<number, typeof session.sets>();
  for (const set of session.sets) {
    if (!byExercise.has(set.exercise_id)) byExercise.set(set.exercise_id, []);
    byExercise.get(set.exercise_id)!.push(set);
  }

  return (
    <>
      <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.workoutName}>{session.workout_name}</Text>
            <Text style={s.workoutDate}>{formatDate(session.date)}</Text>
          </View>
          <TouchableOpacity
            style={shared.dangerBtn}
            onPress={() => setShowConfirm(true)}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Text style={shared.dangerBtnText}>Delete</Text>
            )}
          </TouchableOpacity>
        </View>

        {session.notes ? (
          <View style={s.notesCard}>
            <Text style={s.notesText}>{session.notes}</Text>
          </View>
        ) : null}

        <View style={s.summaryRow}>
          <View style={s.summaryChip}>
            <Text style={s.summaryValue}>{session.sets.length}</Text>
            <Text style={s.summaryLabel}>sets</Text>
          </View>
          <View style={s.summaryChip}>
            <Text style={s.summaryValue}>{byExercise.size}</Text>
            <Text style={s.summaryLabel}>exercises</Text>
          </View>
        </View>

        {Array.from(byExercise.entries()).map(([exId, sets]) => (
          <View key={exId} style={[shared.card, { marginBottom: 12 }]}>
            <Text style={s.exName}>{exMap.get(exId) ?? `Exercise #${exId}`}</Text>

            {/* Table header */}
            <View style={s.tableHeader}>
              <Text style={[s.th, s.colNum]}>#</Text>
              <Text style={[s.th, s.colWeight]}>Weight</Text>
              <Text style={[s.th, s.colReps]}>Reps</Text>
              <Text style={[s.th, s.colRpe]}>RPE</Text>
            </View>

            {sets.map((set, i) => (
              <View key={set.id} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                <Text style={[s.td, s.colNum]}>{set.set_order}</Text>
                <Text style={[s.td, s.colWeight]}>
                  {set.weight != null ? `${set.weight} kg` : '—'}
                </Text>
                <Text style={[s.td, s.colReps]}>{set.reps ?? '—'}</Text>
                <Text style={[s.td, s.colRpe]}>{set.rpe ?? '—'}</Text>
              </View>
            ))}

            {sets.some((ws) => ws.notes) && (
              <View style={s.setNotes}>
                {sets
                  .filter((ws) => ws.notes)
                  .map((ws) => (
                    <Text key={ws.id} style={s.setNotesText}>
                      Set {ws.set_order}: {ws.notes}
                    </Text>
                  ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

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
    </>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  workoutName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  workoutDate: {
    fontSize: 13,
    color: colors.textSec,
  },
  notesCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  notesText: {
    color: colors.textSec,
    fontSize: 14,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  summaryChip: {
    backgroundColor: colors.accentDim,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.accent,
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.textSec,
  },
  exName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  tableRowAlt: {
    backgroundColor: colors.surface2,
    borderRadius: 6,
  },
  th: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSec,
    textTransform: 'uppercase',
  },
  td: {
    fontSize: 14,
    color: colors.text,
  },
  colNum: { width: 28 },
  colWeight: { flex: 2 },
  colReps: { flex: 1 },
  colRpe: { flex: 1 },
  setNotes: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  setNotesText: {
    fontSize: 12,
    color: colors.textSec,
    marginBottom: 2,
  },
});
