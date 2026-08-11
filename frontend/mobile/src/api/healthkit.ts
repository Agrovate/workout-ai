/**
 * Apple Watch / HealthKit integration.
 *
 * Currently returning realistic dummy values so the full ML pipeline
 * (HRV fatigue dampening, per-set HR features) can be exercised without
 * Apple Watch hardware or a macOS build environment.
 *
 * To switch to real data later:
 *   1. pnpm add react-native-health
 *   2. pnpm exec expo prebuild --platform ios   (requires macOS + Xcode)
 *   3. cd ios && pod install
 *   4. Replace the DUMMY_MODE block below with the real implementation.
 */
import { BASE_URL } from './client';
import type { SessionHealthUpdate, SetHRData } from '../types/api';

const DUMMY_MODE = true;

// ── types ─────────────────────────────────────────────────────────────────────

export interface Readiness {
  hrvRmssd: number | null;
  restingHr: number | null;
}

export interface SetHeartRate {
  avgHr: number | null;
  peakHr: number | null;
}

// ── permissions ───────────────────────────────────────────────────────────────

export async function requestHealthKitPermissions(): Promise<boolean> {
  if (DUMMY_MODE) return true;
  return false;
}

// ── readiness (queried once per session before first set) ─────────────────────

export async function queryTodayReadiness(): Promise<Readiness> {
  if (DUMMY_MODE) {
    // Typical healthy values: HRV 40–80 ms, resting HR 55–70 bpm
    return { hrvRmssd: 58, restingHr: 62 };
  }
  return { hrvRmssd: null, restingHr: null };
}

// ── per-set heart rate ────────────────────────────────────────────────────────

export async function querySetHeartRate(
  _startDate: Date,
  _endDate: Date,
): Promise<SetHeartRate> {
  if (DUMMY_MODE) {
    // Typical working-set HR: avg 140–165 bpm, peak 155–180 bpm
    const avg = 140 + Math.floor(Math.random() * 25);
    const peak = avg + 10 + Math.floor(Math.random() * 15);
    return { avgHr: avg, peakHr: peak };
  }
  return { avgHr: null, peakHr: null };
}

// ── backend sync ──────────────────────────────────────────────────────────────

export async function syncSessionHealth(
  sessionId: number,
  data: SessionHealthUpdate,
): Promise<void> {
  try {
    await fetch(`${BASE_URL}/healthkit/session/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // fire-and-forget — never blocks the user
  }
}

export async function syncSetHR(items: SetHRData[]): Promise<void> {
  if (!items.length) return;
  try {
    await fetch(`${BASE_URL}/healthkit/sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
  } catch {
    // fire-and-forget
  }
}
