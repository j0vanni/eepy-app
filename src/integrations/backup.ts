/** JSON backup / restore of everything eepy stores on the device. */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
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
    wakeLog: d.wakeLog,
  };
}

export async function exportBackup(data: SleepDataset): Promise<void> {
  const json = serializeBackup(data);
  const name = `eepy-backup-${dateKey(Date.now())}.json`;
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your eepy backup' });
}

export async function pickBackup(): Promise<SleepDataset | undefined> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return undefined;
  const asset = res.assets[0];
  const text = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
  return parseBackup(text);
}
