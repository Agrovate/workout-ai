import { useEffect, useRef, useState } from 'react';
import {
  connectToWorkoutBand, disconnect, readDeviceStatus,
  subscribeRepEvents, subscribeSetSummaries, subscribeHrStatus,
  isBluetoothSupported,
  type WorkoutBandConnection, type DeviceStatus, type SetSummary, type HrStatus,
} from '../api/webBle';
import { createWorkout, getExercises, ingestHardwareSet, syncHardwareReadiness } from '../api/client';
import type { Exercise } from '../types/api';
import './WorkoutBand.css';

function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function WorkoutBand() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [conn, setConn] = useState<WorkoutBandConnection | null>(null);
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
  const unsubsRef = useRef<Array<() => void>>([]);
  const sessionStartRef = useRef<Date>(new Date());

  useEffect(() => {
    getExercises().then(setExercises).catch(() => {});
    return () => {
      unsubsRef.current.forEach((fn) => fn());
      if (conn) disconnect(conn.device);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setError(null);
    setConnecting(true);
    try {
      const connection = await connectToWorkoutBand();
      setConn(connection);

      connection.device.addEventListener('gattserverdisconnected', handleUnexpectedDisconnect);

      const initialStatus = await readDeviceStatus(connection.service);
      setStatus(initialStatus);

      const unsubRep = await subscribeRepEvents(connection.service, (ev) => setLiveReps(ev.repNumber));
      const unsubSet = await subscribeSetSummaries(connection.service, (summary) => {
        setPendingSet(summary);
        setLiveReps(0);
      });
      const unsubHr = await subscribeHrStatus(connection.service, setLatestHr);
      unsubsRef.current = [unsubRep, unsubSet, unsubHr];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect.');
    } finally {
      setConnecting(false);
    }
  }

  function handleUnexpectedDisconnect() {
    unsubsRef.current = [];
    setConn(null);
    setStatus(null);
    setError('WorkoutBand disconnected unexpectedly.');
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
    if (conn) {
      conn.device.removeEventListener('gattserverdisconnected', handleUnexpectedDisconnect);
      disconnect(conn.device);
    }
    setConn(null);
    setStatus(null);
    setPendingSet(null);
    sessionIdRef.current = null;
    setSetsLogged(0);
  }

  if (!isBluetoothSupported()) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">WorkoutBand</h1>
        </div>
        <div className="empty-state">
          <h3>Bluetooth not supported in this browser</h3>
          <p>Web Bluetooth only works in Chrome, Edge, or Brave — not Safari or Firefox.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">WorkoutBand</h1>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      {!conn ? (
        <button className="btn btn-primary" onClick={connect} disabled={connecting}>
          {connecting ? <><div className="spinner spinner-sm" /> Connecting…</> : 'Connect WorkoutBand'}
        </button>
      ) : (
        <>
          <div className="card wb-status-card">
            <div className="wb-status-row">
              <span className="wb-status-label">Device</span>
              <span>{conn.device.name ?? 'WorkoutBand'}</span>
            </div>
            {status && (
              <div className="wb-status-row">
                <span className="wb-status-label">Battery</span>
                <span>{status.batteryPct}%{status.charging ? ' (charging)' : ''} · firmware v{status.firmwareRev}</span>
              </div>
            )}
            <div className="wb-status-row">
              <span className="wb-status-label">Reps this set</span>
              <span>{liveReps}</span>
            </div>
            <div className="wb-status-row">
              <span className="wb-status-label">Sets logged</span>
              <span>{setsLogged}</span>
            </div>
            {latestHr && (
              <div className="wb-status-row">
                <span className="wb-status-label">Heart rate</span>
                <span>{latestHr.bpm} bpm (signal {latestHr.signalQuality}%)</span>
              </div>
            )}
          </div>

          {pendingSet && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2 className="wb-pending-title">
                Set complete — {pendingSet.totalReps} reps, avg {pendingSet.avgVelocityMmS} mm/s
              </h2>

              <div className="field-row">
                <div className="field" style={{ flex: 2 }}>
                  <label>Exercise</label>
                  <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
                    <option value="">— Select exercise —</option>
                    {exercises.map((ex) => (
                      <option key={ex.id} value={ex.id}>{ex.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Weight</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="0"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>RPE</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="10"
                    placeholder="—"
                    value={rpe}
                    onChange={(e) => setRpe(e.target.value)}
                  />
                </div>
              </div>

              <button
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                onClick={confirmSet}
                disabled={submitting}
              >
                {submitting ? <><div className="spinner spinner-sm" /> Saving…</> : 'Save Set'}
              </button>
            </div>
          )}

          <button className="btn btn-danger" style={{ marginTop: 16 }} onClick={endSession}>
            End Session
          </button>
        </>
      )}
    </div>
  );
}
