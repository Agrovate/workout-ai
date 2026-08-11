import React, { useState, useMemo } from 'react';
import {
  Modal, View, Text, TextInput, FlatList,
  TouchableOpacity, StyleSheet, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Exercise } from '../types/api';
import { colors } from '../theme';

interface Props {
  exercises: Exercise[];
  selectedId: string;
  onChange: (id: string) => void;
}

export function ExercisePicker({ exercises, selectedId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = exercises.find((e) => String(e.id) === selectedId);

  const filtered = useMemo(() => {
    if (!search.trim()) return exercises;
    const q = search.toLowerCase();
    return exercises.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.muscle_group?.toLowerCase().includes(q) ?? false),
    );
  }, [exercises, search]);

  function pick(id: string) {
    onChange(id);
    setSearch('');
    setOpen(false);
  }

  return (
    <>
      <TouchableOpacity style={s.trigger} onPress={() => setOpen(true)}>
        <Text style={selected ? s.triggerText : s.triggerPlaceholder} numberOfLines={1}>
          {selected ? selected.name : 'Select exercise…'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textSec} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Select Exercise</Text>

            <TextInput
              style={s.search}
              placeholder="Search…"
              placeholderTextColor={colors.textSec}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />

            <FlatList
              data={filtered}
              keyExtractor={(e) => String(e.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.option, String(item.id) === selectedId && s.optionSelected]}
                  onPress={() => pick(String(item.id))}
                >
                  <View style={s.optionInner}>
                    <Text style={s.optionName}>{item.name}</Text>
                    {item.muscle_group ? (
                      <Text style={s.optionGroup}>{item.muscle_group}</Text>
                    ) : null}
                  </View>
                  {String(item.id) === selectedId && (
                    <Ionicons name="checkmark" size={18} color={colors.accent} />
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={s.sep} />}
              style={s.list}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flex: 1,
  },
  triggerText: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  triggerPlaceholder: {
    color: colors.textSec,
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  search: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  list: {
    flexGrow: 0,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  optionSelected: {
    backgroundColor: colors.accentDim,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  optionInner: {
    flex: 1,
  },
  optionName: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  optionGroup: {
    fontSize: 12,
    color: colors.textSec,
    marginTop: 2,
  },
  sep: {
    height: 1,
    backgroundColor: colors.border,
  },
});
