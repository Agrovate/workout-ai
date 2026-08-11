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
