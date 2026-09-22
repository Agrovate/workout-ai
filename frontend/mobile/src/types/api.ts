export interface Exercise {
  id: number;
  name: string;
  muscle_group: string | null;
}

export interface WorkoutSet {
  id: number;
  session_id: number;
  exercise_id: number;
  set_order: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  distance: number | null;
  seconds: number | null;
  notes: string | null;
  avg_hr_bpm: number | null;
  peak_hr_bpm: number | null;
}

export interface WorkoutSession {
  id: number;
  workout_name: string;
  date: string;
  notes: string | null;
  created_at: string;
  sets: WorkoutSet[];
  started_at: string | null;
  ended_at: string | null;
  hrv_rmssd_ms: number | null;
  resting_hr_bpm: number | null;
}

export interface PredictionResponse {
  exercise_name: string;
  recommended_weight: number;
  recommended_reps: number;
  confidence: number | null;
}

export interface ExerciseCreate {
  name: string;
  muscle_group?: string | null;
}

export interface WorkoutSetCreate {
  exercise_id: number;
  set_order: number;
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null;
  distance?: number | null;
  seconds?: number | null;
  notes?: string | null;
}

export interface WorkoutSessionCreate {
  workout_name: string;
  date: string;
  notes?: string | null;
  sets: WorkoutSetCreate[];
}

export interface PredictionRequest {
  exercise_name: string;
  target_reps?: number | null;
  recent_rpe?: number | null;
  hrv_rmssd_today?: number | null;
  resting_hr_today?: number | null;
}

export interface SessionHealthUpdate {
  started_at?: string | null;
  ended_at?: string | null;
  hrv_rmssd_ms?: number | null;
  resting_hr_bpm?: number | null;
}

export interface SetHRData {
  set_id: number;
  avg_hr_bpm?: number | null;
  peak_hr_bpm?: number | null;
}

// ── WorkoutBand hardware ingest (BLE sync) ──────────────────────────────────

export interface HardwareSetIn {
  session_id: number;
  exercise_id: number;
  set_order: number;
  weight?: number | null;
  reps: number;
  rpe?: number | null;
  avg_velocity_mm_s: number;
  peak_velocity_mm_s: number;
  velocity_loss_pct: number;
  set_duration_s: number;
  notes?: string | null;
  // From WorkoutBand's onboard PPG sensor during the set — omit rather than
  // send when the device's signal_quality was too low to trust.
  avg_hr_bpm?: number | null;
  peak_hr_bpm?: number | null;
}

export interface HardwareSetOut {
  id: number;
  session_id: number;
  exercise_id: number;
  set_order: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  avg_velocity_mm_s: number | null;
  peak_velocity_mm_s: number | null;
  velocity_loss_pct: number | null;
  source: string | null;
  avg_hr_bpm: number | null;
  peak_hr_bpm: number | null;
}

// Readiness (HRV/resting HR) read from WorkoutBand's onboard PPG instead of
// HealthKit — same shape as SessionHealthUpdate, POSTed to
// PATCH /hardware/session/{id} instead of /healthkit/session/{id}.
export type HardwareReadinessUpdate = SessionHealthUpdate;
