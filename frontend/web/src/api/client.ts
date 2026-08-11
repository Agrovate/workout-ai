import type {
  Exercise,
  ExerciseCreate,
  WorkoutSession,
  WorkoutSessionCreate,
  PredictionRequest,
  PredictionResponse,
} from '../types/api';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Exercises
export const getExercises = () => request<Exercise[]>('/exercises');

export const createExercise = (data: ExerciseCreate) =>
  request<Exercise>('/exercises', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Workouts
export const getWorkouts = () => request<WorkoutSession[]>('/workouts');

export const getWorkout = (id: number) => request<WorkoutSession>(`/workouts/${id}`);

export const createWorkout = (data: WorkoutSessionCreate) =>
  request<WorkoutSession>('/workouts', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const deleteWorkout = (id: number) =>
  request<void>(`/workouts/${id}`, { method: 'DELETE' });

// Predictions
export const getPrediction = (data: PredictionRequest) =>
  request<PredictionResponse>('/predictions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
