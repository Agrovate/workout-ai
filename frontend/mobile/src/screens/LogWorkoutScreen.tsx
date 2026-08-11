import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createWorkout, getExercises, getPrediction } from '../api/client';
import { ExercisePicker } from '../components/ExercisePicker';
import type { Exercise } from '../types/api';
import type { RootStackParamList } from '../navigation/types';
import { colors, shared } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

export function LogWorkoutScreen() {
  const navigation = useNavigation<Nav>();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(true);

  const [sessionName, setSessionName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [sets, setSets] = useState<DraftSet[]>([makeSet()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
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
    setSets((prev) => [...prev, makeSet(last?.exercise_id ?? '')]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
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

  async function handleSubmit() {
    if (!sessionName.trim()) {
      setError('Workout name is required.');
      return;
    }
    const invalidSet = sets.find((s) => !s.exercise_id);
    if (invalidSet) {
      setError('All sets must have an exercise selected.');
      return;
    }
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
      navigation.navigate('Tabs');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workout.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={shared.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={shared.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Session header */}
        <View style={s.card}>
          <Text style={shared.label}>Workout Name *</Text>
          <TextInput
            style={[shared.input, { marginBottom: 12 }]}
            placeholder="e.g. Push Day A"
            placeholderTextColor={colors.textSec}
            value={sessionName}
            onChangeText={setSessionName}
          />
          <Text style={shared.label}>Date (YYYY-MM-DD)</Text>
          <TextInput
            style={[shared.input, { marginBottom: 12 }]}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSec}
          />
          <Text style={shared.label}>Notes</Text>
          <TextInput
            style={shared.input}
            placeholder="Optional notes…"
            placeholderTextColor={colors.textSec}
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        {/* Sets */}
        <View style={s.setsHeader}>
          <Text style={shared.sectionTitle}>Sets</Text>
          <View style={s.setBadge}><Text style={s.setBadgeText}>{sets.length}</Text></View>
        </View>

        {sets.map((set, idx) => (
          <View key={set.key} style={s.setCard}>
            <View style={s.setNum}>
              <Text style={s.setNumText}>{idx + 1}</Text>
            </View>

            <View style={s.setBody}>
              {/* Exercise picker */}
              <Text style={shared.label}>Exercise</Text>
              {loadingExercises ? (
                <ActivityIndicator color={colors.accent} size="small" style={{ marginBottom: 12 }} />
              ) : (
                <View style={{ marginBottom: 12 }}>
                  <ExercisePicker
                    exercises={exercises}
                    selectedId={set.exercise_id}
                    onChange={(id) => updateSet(set.key, { exercise_id: id })}
                  />
                </View>
              )}

              {/* Weight + Reps row */}
              <View style={s.row}>
                <View style={s.halfField}>
                  <Text style={shared.label}>Weight (kg)</Text>
                  <TextInput
                    style={shared.input}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.textSec}
                    value={set.weight}
                    onChangeText={(v) => updateSet(set.key, { weight: v })}
                  />
                </View>
                <View style={s.halfField}>
                  <Text style={shared.label}>Reps</Text>
                  <TextInput
                    style={shared.input}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.textSec}
                    value={set.reps}
                    onChangeText={(v) => updateSet(set.key, { reps: v })}
                  />
                </View>
              </View>

              {/* Action buttons */}
              <View style={s.setActions}>
                {set.exercise_id ? (
                  <TouchableOpacity
                    style={s.ghostBtn}
                    onPress={() => getSuggestion(set.key, set.exercise_id)}
                    disabled={set.predicting}
                  >
                    {set.predicting ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Text style={s.ghostBtnText}>✦ AI suggest</Text>
                    )}
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={s.ghostBtn}
                  onPress={() => updateSet(set.key, { expanded: !set.expanded })}
                >
                  <Text style={s.ghostBtnText}>{set.expanded ? 'Less' : 'More'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.ghostBtn, sets.length === 1 && s.btnDisabled]}
                  onPress={() => removeSet(set.key)}
                  disabled={sets.length === 1}
                >
                  <Text style={[s.ghostBtnText, { color: colors.danger }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Expanded fields */}
              {set.expanded && (
                <View style={s.row}>
                  <View style={s.halfField}>
                    <Text style={shared.label}>RPE (1–10)</Text>
                    <TextInput
                      style={shared.input}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.textSec}
                      value={set.rpe}
                      onChangeText={(v) => updateSet(set.key, { rpe: v })}
                    />
                  </View>
                  <View style={[s.halfField, { flex: 2 }]}>
                    <Text style={shared.label}>Notes</Text>
                    <TextInput
                      style={shared.input}
                      placeholder="Optional…"
                      placeholderTextColor={colors.textSec}
                      value={set.notes}
                      onChangeText={(v) => updateSet(set.key, { notes: v })}
                    />
                  </View>
                </View>
              )}
            </View>
          </View>
        ))}

        <TouchableOpacity style={[shared.secondaryBtn, { marginBottom: 16 }]} onPress={addSet}>
          <Text style={shared.secondaryBtnText}>+ Add Set</Text>
        </TouchableOpacity>

        {error && <Text style={shared.error}>{error}</Text>}

        <View style={s.submitRow}>
          <TouchableOpacity
            style={[shared.secondaryBtn, { flex: 1 }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={shared.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[shared.primaryBtn, { flex: 2 }, submitting && s.btnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={shared.primaryBtnText}>Save Workout</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  setsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  setBadge: {
    backgroundColor: colors.accentDim,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  setBadgeText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  setCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  setNum: {
    width: 36,
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  setNumText: {
    color: colors.textSec,
    fontWeight: '700',
    fontSize: 13,
  },
  setBody: {
    flex: 1,
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  halfField: {
    flex: 1,
  },
  setActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  ghostBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghostBtnText: {
    color: colors.textSec,
    fontSize: 12,
    fontWeight: '500',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  submitRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
});
