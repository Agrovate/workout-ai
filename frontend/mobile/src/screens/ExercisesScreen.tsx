import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, SectionList,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { createExercise, getExercises } from '../api/client';
import type { Exercise } from '../types/api';
import { colors, shared } from '../theme';

export function ExercisesScreen() {
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
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return exercises;
    const q = search.toLowerCase();
    return exercises.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.muscle_group?.toLowerCase().includes(q) ?? false),
    );
  }, [exercises, search]);

  const sections = useMemo(() => {
    const map = new Map<string, Exercise[]>();
    for (const ex of filtered) {
      const key = ex.muscle_group ?? 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ex);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, data]) => ({ title, data }));
  }, [filtered]);

  async function handleAdd() {
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
      setAddError(
        msg.includes('409') || msg.toLowerCase().includes('conflict')
          ? 'An exercise with that name already exists.'
          : msg,
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={shared.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.searchRow}>
        <TextInput
          style={[shared.input, { flex: 1 }]}
          placeholder="Search exercises…"
          placeholderTextColor={colors.textSec}
          value={search}
          onChangeText={setSearch}
        />
        <Text style={s.count}>{exercises.length}</Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <Text style={[shared.error, { margin: 16 }]}>{error}</Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.listContent}
          renderSectionHeader={({ section }) => (
            <Text style={s.groupLabel}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <View style={s.exerciseRow}>
              <Text style={s.exerciseName}>{item.name}</Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListEmptyComponent={
            <View style={shared.emptyState}>
              <Text style={shared.emptyTitle}>{search ? 'No matches' : 'No exercises'}</Text>
              <Text style={shared.emptyText}>
                {search ? 'Try a different search.' : 'Add your first exercise below.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            <View style={s.addPanel}>
              <Text style={s.addTitle}>Add Exercise</Text>
              <Text style={shared.label}>Name *</Text>
              <TextInput
                style={[shared.input, { marginBottom: 12 }]}
                placeholder="e.g. Squat"
                placeholderTextColor={colors.textSec}
                value={name}
                onChangeText={setName}
              />
              <Text style={shared.label}>Muscle Group</Text>
              <TextInput
                style={[shared.input, { marginBottom: 12 }]}
                placeholder="e.g. Legs, Chest, Back…"
                placeholderTextColor={colors.textSec}
                value={muscleGroup}
                onChangeText={setMuscleGroup}
              />
              {addError && <Text style={shared.error}>{addError}</Text>}
              <TouchableOpacity
                style={[shared.primaryBtn, (!name.trim() || adding) && s.btnDisabled]}
                onPress={handleAdd}
                disabled={!name.trim() || adding}
              >
                <Text style={shared.primaryBtnText}>{adding ? 'Adding…' : 'Add Exercise'}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  count: {
    color: colors.textSec,
    fontSize: 13,
  },
  listContent: {
    paddingBottom: 32,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSec,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
    backgroundColor: colors.bg,
  },
  exerciseRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  exerciseName: {
    fontSize: 15,
    color: colors.text,
  },
  sep: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  addPanel: {
    margin: 16,
    marginTop: 24,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
