import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const STORAGE_KEY = 'voice-recorder.recordings.v1';

export type RecordingKind = 'audio' | 'video';

export interface LocalRecording {
  id: string;
  kind: RecordingKind;
  uri: string;
  createdAt: string;
  durationMs: number;
}

function isLocalRecording(value: unknown): value is LocalRecording {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    (item.kind === 'audio' || item.kind === 'video') &&
    typeof item.uri === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.durationMs === 'number'
  );
}

export async function loadRecordings(): Promise<LocalRecording[]> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isLocalRecording)) {
    throw new Error('The local recordings list is invalid.');
  }
  return parsed.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function saveRecording(
  kind: RecordingKind,
  sourceUri: string,
  durationMs: number,
): Promise<LocalRecording> {
  const documents = FileSystem.documentDirectory;
  if (!documents) {
    throw new Error('This device does not provide app storage for recordings.');
  }

  const directory = `${documents}recordings/`;
  const directoryInfo = await FileSystem.getInfoAsync(directory);
  if (!directoryInfo.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const extension = kind === 'audio' ? 'm4a' : 'mp4';
  const uri = `${directory}${kind}-${id}.${extension}`;

  await FileSystem.moveAsync({ from: sourceUri, to: uri });

  const recording: LocalRecording = {
    id,
    kind,
    uri,
    createdAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(durationMs)),
  };

  try {
    const recordings = await loadRecordings();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([recording, ...recordings]),
    );
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    throw error;
  }

  return recording;
}

export async function removeRecording(
  recording: LocalRecording,
): Promise<void> {
  await FileSystem.deleteAsync(recording.uri, { idempotent: true });
  const remaining = (await loadRecordings()).filter(
    (item) => item.id !== recording.id,
  );
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const twoDigits = (value: number) => value.toString().padStart(2, '0');
  return hours > 0
    ? `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

export function formatRecordingDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
