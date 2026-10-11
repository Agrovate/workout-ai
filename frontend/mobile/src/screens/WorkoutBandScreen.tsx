import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Device } from 'react-native-ble-plx';

import {
  scanForWorkoutBand, connectToDevice, disconnectDevice, readDeviceStatus,
  subscribeRepEvents, subscribeSetSummaries, subscribeHrStatus,
  type DeviceStatus, type SetSummary, type HrStatus,
} from '../api/ble';
import { createWorkout, getExercises, ingestHardwareSet, syncHardwareReadiness } from '../api/client';
import { ExercisePicker } from '../components/ExercisePicker';
import type { Exercise } from '../types/api';
import type { RootStackParamList } from '../navigation/types';
import { colors, shared } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function WorkoutBandScreen() {
  const navigation = useNavigation<Nav>();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Device[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [device, setDevice] = useState<Device | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [latestHr, setLatestHr] = useState<HrStatus | null>(null);
  const [liveReps, setLiveReps] = useState(0);
  const [pendingSet, setPendingSet] = useState<SetSummary | null>(null);
  const [exerciseId, setExerciseId] = useState('');
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setsLogged, setSetsLogged] = useState(0);

  const sessionIdRef = useRef<number | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const sessionStartRef = useRef<Date>(new Date());

  useEffect(() => {
    getExercises().then(setExercises).catch(() => {});
    return () => {
      stopScanRef.current?.();
      unsubsRef.current.forEach((fn) => fn());
      if (device) disconnectDevice(device);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startScan() {
    setError(null);
    setFound([]);
    setScanning(true);
    stopScanRef.current = scanForWorkoutBand((d) => {
      setFound((prev) => (prev.some((x) => x.id === d.id) ? prev : [...prev, d]));
    }, 10000);
    setTimeout(() => setScanning(false), 10000);
  }

  async function connect(target: Device) {
    stopScanRef.current?.();
    setScanning(false);
    setConnecting(true);
    setError(null);
    try {
      const connected = await connectToDevice(target.id);
      setDevice(connected);

      const initialStatus = await readDeviceStatus(connected);
      setStatus(initialStatus);

      const unsubRep = subscribeRepEvents(connected, (ev) => setLiveReps(ev.repNumber));
      const unsubSet = subscribeSetSummaries(connected, (summary) => {
        setPendingSet(summary);
        setLiveReps(0);
      });
      const unsubHr = subscribeHrStatus(connected, setLatestHr);
      unsubsRef.current = [unsubRep, unsubSet, unsubHr];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect.');
    } finally {
      setConnecting(false);
    }
  }

  async function confirmSet() {
    if (!pendingSet || !exerciseId) {
      setError('Select an exercise before saving this set.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (sessionIdRef.current === null) {
        const session = await createWorkout({
          workout_name: `WorkoutBand ${new Date().toLocaleDateString()}`,
          date: new Date().toISOString().slice(0, 10),
          notes: null,
          sets: [],
        });
        sessionIdRef.current = session.id;
      }

      const hrConfident = latestHr !== null && latestHr.signalQuality >= 50;

      await ingestHardwareSet({
        session_id: sessionIdRef.current,
        exercise_id: Number(exerciseId),
        set_order: setsLogged + 1,
        weight: parseNum(weight),
        reps: pendingSet.totalReps,
        rpe: parseNum(rpe),
        avg_velocity_mm_s: pendingSet.avgVelocityMmS,
        peak_velocity_mm_s: pendingSet.peakVelocityMmS,
        velocity_loss_pct: pendingSet.velocityLossPct,
        set_duration_s: pendingSet.setDurationS,
        avg_hr_bpm: hrConfident ? latestHr!.bpm : undefined,
      });

      setSetsLogged((n) => n + 1);
      setPendingSet(null);
      setWeight('');
      setRpe('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save set.');
    } finally {
      setSubmitting(false);
    }
  }

  async function endSession() {
    if (sessionIdRef.current !== null) {
      try {
        await syncHardwareReadiness(sessionIdRef.current, {
          started_at: sessionStartRef.current.toISOString(),
          ended_at: new Date().toISOString(),
          hrv_rmssd_ms: latestHr?.hrvRmssdMs ?? null,
          resting_hr_bpm: null,
        });
      } catch {
        // fire-and-forget
      }
    }
    unsubsRef.current.forEach((fn) => fn());
    unsubsRef.current = [];
    if (device) await disconnectDevice(device);
    setDevice(null);
    setStatus(null);
    navigation.goBack();
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      {error ? <Text style={shared.error}>{error}</Text> : null}

      {!device ? (
        <>
          <Text style={shared.sectionTitle}>Connect WorkoutBand</Text>
          <TouchableOpacity
            style={[shared.primaryBtn, scanning && s.btnDisabled]}
            onPress={startScan}
            disabled={scanning}
          >
            {scanning ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={shared.primaryBtnText}>Scan for WorkoutBand</Text>
            )}
          </TouchableOpacity>

          <FlatList
            style={{ marginTop: 16 }}
            data={found}
            keyExtractor={(d) => d.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={shared.card}
                onPress={() => connect(item)}
                disabled={connecting}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  {item.name ?? 'WorkoutBand'}
                </Text>
                <Text style={{ color: colors.textSec, fontSize: 12, marginTop: 4 }}>
                  {item.id}
                </Text>
              </TouchableOpacity>
            )}
          />
          {connecting ? <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} /> : null}
        </>
      ) : (
        <>
          <Text style={shared.sectionTitle}>Connected</Text>
          <View style={shared.card}>
            <Text style={{ color: colors.text, fontWeight: '600', marginBottom: 6 }}>
              {device.name}
            </Text>
            {status ? (
              <Text style={{ color: colors.textSec, fontSize: 13 }}>
                Battery {status.batteryPct}%{status.charging ? ' (charging)' : ''} · firmware v{status.firmwareRev}
              </Text>
            ) : null}
            <Text style={{ color: colors.textSec, fontSize: 13, marginTop: 4 }}>
              Reps this set: {liveReps} · Sets logged: {setsLogged}
            </Text>
            {latestHr ? (
              <Text style={{ color: colors.textSec, fontSize: 13, marginTop: 4 }}>
                HR {latestHr.bpm} bpm (signal {latestHr.signalQuality}%)
              </Text>
            ) : null}
          </View>

          {pendingSet ? (
            <View style={shared.card}>
              <Text style={{ color: colors.text, fontWeight: '600', marginBottom: 10 }}>
                Set complete — {pendingSet.totalReps} reps, avg {pendingSet.avgVelocityMmS} mm/s
              </Text>

              <Text style={shared.label}>Exercise</Text>
              <ExercisePicker exercises={exercises} selectedId={exerciseId} onChange={setExerciseId} />

              <Text style={[shared.label, { marginTop: 12 }]}>Weight</Text>
              <TextInput
                style={shared.input}
                keyboardType="decimal-pad"
                value={weight}
                onChangeText={setWeight}
                placeholder="lb/kg"
                placeholderTextColor={colors.textSec}
              />

              <Text style={[shared.label, { marginTop: 12 }]}>RPE</Text>
              <TextInput
                style={shared.input}
                keyboardType="decimal-pad"
                value={rpe}
                onChangeText={setRpe}
                placeholder="1-10"
                placeholderTextColor={colors.textSec}
              />

              <TouchableOpacity
                style={[shared.primaryBtn, { marginTop: 16 }, submitting && s.btnDisabled]}
                onPress={confirmSet}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={shared.primaryBtnText}>Save Set</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity style={[shared.dangerBtn, { marginTop: 16 }]} onPress={endSession}>
            <Text style={shared.dangerBtnText}>End Session</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  btnDisabled: {
    opacity: 0.4,
  },
});
