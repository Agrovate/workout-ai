import type {
  Exercise,
  ExerciseCreate,
  WorkoutSession,
  WorkoutSessionCreate,
  PredictionRequest,
  PredictionResponse,
} from '../types/api';

// iOS Simulator: http://localhost:8000
// Android Emulator: http://10.0.2.2:8000
// Physical device: http://<your-machine-LAN-ip>:8000
export const BASE_URL = 'http://172.20.10.2:8000';
const BASE = BASE_URL;

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

export const getExercises = () => request<Exercise[]>('/exercises');

export const createExercise = (data: ExerciseCreate) =>
  request<Exercise>('/exercises', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getWorkouts = () => request<WorkoutSession[]>('/workouts');

export const getWorkout = (id: number) => request<WorkoutSession>(`/workouts/${id}`);

export const createWorkout = (data: WorkoutSessionCreate) =>
  request<WorkoutSession>('/workouts', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const deleteWorkout = (id: number) =>
  request<void>(`/workouts/${id}`, { method: 'DELETE' });

export const getPrediction = (data: PredictionRequest) =>
  request<PredictionResponse>('/predictions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
