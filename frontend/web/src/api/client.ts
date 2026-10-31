import type {
  Exercise,
  ExerciseCreate,
  WorkoutSession,
  WorkoutSessionCreate,
  PredictionRequest,
  PredictionResponse,
  PredictionTrajectoryResponse,
  HardwareSetIn,
  HardwareSetOut,
  HardwareReadinessUpdate,
  ChatMessageIn,
  ChatMessageOut,
  ChatSessionOut,
  ChatSessionDetail,
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

export const getPredictionTrajectory = (exerciseName: string) =>
  request<PredictionTrajectoryResponse>(`/predictions/trajectory?exercise_name=${encodeURIComponent(exerciseName)}`);

// Hardware (WorkoutBand BLE sync)
export const ingestHardwareSet = (data: HardwareSetIn) =>
  request<HardwareSetOut>('/hardware/sets', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const syncHardwareReadiness = (sessionId: number, data: HardwareReadinessUpdate) =>
  request<void>(`/hardware/session/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

// Chat (rule-based, no external API) — persisted sessions
export const listChatSessions = () => request<ChatSessionOut[]>('/chat/sessions');

export const createChatSession = () =>
  request<ChatSessionOut>('/chat/sessions', { method: 'POST' });

export const getChatSession = (id: number) =>
  request<ChatSessionDetail>(`/chat/sessions/${id}`);

export const deleteChatSession = (id: number) =>
  request<void>(`/chat/sessions/${id}`, { method: 'DELETE' });

export const postChatMessage = (sessionId: number, data: ChatMessageIn) =>
  request<ChatMessageOut>(`/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
