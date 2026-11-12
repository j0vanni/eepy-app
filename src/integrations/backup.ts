/** JSON backup / restore of everything eepy stores on the device. */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { dateKey } from '../engine/time';
import type { SleepDataset } from '../engine/types';

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: 'eepy';
  version: number;
  exportedAt: string;
  data: SleepDataset;
}

export function serializeBackup(data: SleepDataset, now = Date.now()): string {
  const file: BackupFile = { app: 'eepy', version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), data };
  return JSON.stringify(file);
}

/** Validates and parses a backup; throws a readable error for anything else. */
export function parseBackup(text: string): SleepDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const f = parsed as Partial<BackupFile>;
  if (f?.app !== 'eepy' || !f.data) throw new Error('That file is not an eepy backup.');
  if ((f.version ?? 0) > BACKUP_VERSION) throw new Error('This backup was made by a newer version of eepy.');
  const d = f.data;
  if (!Array.isArray(d.sessions) || !Array.isArray(d.caffeine) || typeof d.profile !== 'object') {
    throw new Error('The backup is missing required sections.');
  }
  return {
    sessions: d.sessions,
    vitals: d.vitals ?? {},
    daily: d.daily ?? {},
    dayLogs: d.dayLogs ?? {},
    caffeine: d.caffeine,
    profile: d.profile,
    // These three used to be dropped on restore, which silently lost every check-in.
    checkins: Array.isArray(d.checkins) ? d.checkins : [],
    workouts: Array.isArray(d.workouts) ? d.workouts : [],
    reactions: Array.isArray(d.reactions) ? d.reactions : [],
    wakeLog: d.wakeLog,
  };
}

export const backupFileName = (now = Date.now()) => `eepy-backup-${dateKey(now)}.json`;

function downloadOnWeb(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export type SaveOutcome = 'saved' | 'shared' | 'cancelled';

/**
 * Saves text as a file in a folder the user picks (Android's own folder picker), e.g. Downloads.
 * This doesn't depend on any other app accepting the file, which the share sheet does.
 */
export async function saveTextToFolder(name: string, content: string, mimeType: string): Promise<SaveOutcome> {
  if (Platform.OS === 'web') {
    downloadOnWeb(name, content, mimeType);
    return 'saved';
  }
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    // Backing out of the picker rejects.
    return 'cancelled';
  }
  const file = dir.createFile(name, mimeType);
  await file.write(content);
  return 'saved';
}

/** Hands text to another app (Drive, email, Files…) through the share sheet. */
export async function shareText(name: string, content: string, mimeType: string, dialogTitle: string): Promise<SaveOutcome> {
  if (Platform.OS === 'web') {
    downloadOnWeb(name, content, mimeType);
    return 'saved';
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device. Use "Save to a folder" instead.');
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle });
  return 'shared';
}

/** Saves the backup into a folder the user picks. */
export function saveBackup(data: SleepDataset): Promise<SaveOutcome> {
  return saveTextToFolder(backupFileName(), serializeBackup(data), 'application/json');
}

/** Sends the backup to another app through the share sheet. */
export function shareBackup(data: SleepDataset): Promise<SaveOutcome> {
  return shareText(backupFileName(), serializeBackup(data), 'application/json', 'Save your eepy backup');
}

/** @deprecated the share-sheet export; kept for callers that haven't moved to saveBackup / shareBackup. */
export async function exportBackup(data: SleepDataset): Promise<void> {
  await shareBackup(data);
}

export async function pickBackup(): Promise<SleepDataset | undefined> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return undefined;
  const asset = res.assets[0];
  const text = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
  return parseBackup(text);
}
