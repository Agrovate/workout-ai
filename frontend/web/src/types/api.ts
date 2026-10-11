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
}

export interface WorkoutSession {
  id: number;
  workout_name: string;
  date: string;
  notes: string | null;
  created_at: string;
  sets: WorkoutSet[];
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
}

export interface PredictionTrajectoryPoint {
  date: string;
  weight: number;
  reps: number;
  confidence: number | null;
}

export interface PredictionTrajectoryResponse {
  exercise_name: string;
  points: PredictionTrajectoryPoint[];
  assumed_rpe: number;
}

// ── WorkoutBand hardware ingest (Web Bluetooth sync) ────────────────────────

export interface HardwareSetIn {
  session_id: number;
  exercise_id: number;
  set_order: number;
  weight?: number | null;
  reps: number;                     // authoritative from hardware rep counter
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

// HRV/resting-HR readiness read from WorkoutBand's onboard PPG, POSTed to
// PATCH /hardware/session/{id}.
export interface HardwareReadinessUpdate {
  started_at?: string | null;
  ended_at?: string | null;
  hrv_rmssd_ms?: number | null;
  resting_hr_bpm?: number | null;
}
