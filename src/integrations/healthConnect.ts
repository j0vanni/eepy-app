/**
 * Health Connect bridge (Android). The CMF Watch app syncs sleep stages, heart rate, HRV, SpO2 and
 * steps from the CMF Watch 3 Pro into Health Connect; eepy reads them from there.
 */
import { Platform } from 'react-native';
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import type { Permission, RecordType } from 'react-native-health-connect';

import { computeSessionMetrics } from '../engine/sessions';
import { DAY, HOUR } from '../engine/time';
import type { DailyStats, NightVitals, SleepSession, VitalSample } from '../engine/types';
import { summarizeNightVitals } from '../engine/vitals';
import {
  buildDailyStats,
  flattenHeartRate,
  HCHeartRateRecord,
  HCInstantRecord,
  HCSleepRecord,
  HCStepsRecord,
  instantSamples,
  mapSleepRecord,
  stepsPerDay,
  toHealthConnectSleep,
} from './healthConnectMapper';

export type HCStatus = 'unsupported' | 'not-installed' | 'update-required' | 'available';

const READ_TYPES: RecordType[] = [
  'SleepSession',
  'HeartRate',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'OxygenSaturation',
  'RespiratoryRate',
  'Steps',
];

export const HC_PERMISSIONS: Permission[] = [
  ...READ_TYPES.map((recordType) => ({ accessType: 'read' as const, recordType })),
  { accessType: 'write', recordType: 'SleepSession' },
];

let initialized = false;

export async function healthConnectStatus(): Promise<HCStatus> {
  if (Platform.OS !== 'android') return 'unsupported';
  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'update-required';
    return 'not-installed';
  } catch {
    return 'not-installed';
  }
}

async function ensureInit(): Promise<boolean> {
  if (initialized) return true;
  initialized = await initialize();
  return initialized;
}

export interface PermissionState {
  sleep: boolean;
  heartRate: boolean;
  all: boolean;
  granted: string[];
}

export async function getPermissionState(): Promise<PermissionState> {
  if (!(await ensureInit())) return { sleep: false, heartRate: false, all: false, granted: [] };
  const granted = (await getGrantedPermissions()).map((p) => `${p.accessType}:${p.recordType}`);
  const has = (t: string) => granted.includes(`read:${t}`);
  return {
    sleep: has('SleepSession'),
    heartRate: has('HeartRate'),
    all: READ_TYPES.every(has),
    granted,
  };
}

export async function requestHealthPermissions(): Promise<PermissionState> {
  await ensureInit();
  await requestPermission([...HC_PERMISSIONS, { accessType: 'read', recordType: 'ReadHealthDataHistory' }]);
  return getPermissionState();
}

export function openHealthSettings() {
  if (Platform.OS === 'android') openHealthConnectSettings();
}

async function readAll<T>(recordType: RecordType, startTime: number, endTime: number): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const res = await readRecords(recordType, {
      timeRangeFilter: { operator: 'between', startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString() },
      pageSize: 1000,
      pageToken,
    });
    out.push(...(res.records as unknown as T[]));
    pageToken = res.pageToken || undefined;
  } while (pageToken);
  return out;
}

async function safeRead<T>(recordType: RecordType, start: number, end: number, granted: string[]): Promise<T[]> {
  if (!granted.includes(`read:${recordType}`)) return [];
  try {
    return await readAll<T>(recordType, start, end);
  } catch (e) {
    console.warn(`Health Connect read ${recordType} failed`, e);
    return [];
  }
}

export interface SyncResult {
  from: number;
  to: number;
  sessions: SleepSession[];
  vitals: Record<string, NightVitals>;
  daily: Record<string, DailyStats>;
  counts: { sessions: number; heartRate: number; hrv: number; spo2: number; steps: number };
}

/**
 * Pulls everything in [from, to]. Raw heart-rate/SpO2 samples are reduced to per-night summaries
 * immediately so the local database stays small.
 */
export async function syncHealthConnect(from: number, to: number = Date.now()): Promise<SyncResult> {
  if (!(await ensureInit())) throw new Error('Health Connect is not available on this device.');
  const { granted, sleep } = await getPermissionState();
  if (!sleep) throw new Error('eepy does not have permission to read sleep from Health Connect yet.');

  const sleepRecords = await safeRead<HCSleepRecord>('SleepSession', from - 12 * HOUR, to, granted);
  const sessions = sleepRecords.map(mapSleepRecord).filter((s) => s.end > s.start);

  // Vitals: read once over the whole window (paged), then slice per night in memory.
  const vitalsFrom = from - 12 * HOUR;
  const [hrRecs, hrvRecs, spo2Recs, respRecs, rhrRecs, stepRecs] = await Promise.all([
    safeRead<HCHeartRateRecord>('HeartRate', vitalsFrom, to, granted),
    safeRead<HCInstantRecord>('HeartRateVariabilityRmssd', vitalsFrom, to, granted),
    safeRead<HCInstantRecord>('OxygenSaturation', vitalsFrom, to, granted),
    safeRead<HCInstantRecord>('RespiratoryRate', vitalsFrom, to, granted),
    safeRead<HCInstantRecord>('RestingHeartRate', from - DAY, to, granted),
    safeRead<HCStepsRecord>('Steps', from - DAY, to, granted),
  ]);
  const hr = flattenHeartRate(hrRecs);
  const hrv: VitalSample[] = instantSamples(hrvRecs, 'heartRateVariabilityMillis');
  const spo2 = instantSamples(spo2Recs, 'percentage');
  const resp = instantSamples(respRecs, 'rate');
  const rhr = instantSamples(rhrRecs, 'beatsPerMinute');

  const vitals: Record<string, NightVitals> = {};
  for (const s of sessions) {
    const m = computeSessionMetrics(s);
    if (!m) continue;
    vitals[s.id] = summarizeNightVitals(m, { hr, hrv, spo2, resp });
  }
  return {
    from,
    to,
    sessions,
    vitals,
    daily: buildDailyStats(stepsPerDay(stepRecs), rhr, hrv),
    counts: { sessions: sessions.length, heartRate: hr.length, hrv: hrv.length, spo2: spo2.length, steps: stepRecs.length },
  };
}

/** Saves a manually logged sleep to Health Connect so other apps see it too. */
export async function writeSleepToHealthConnect(s: SleepSession): Promise<boolean> {
  if (Platform.OS !== 'android' || !(await ensureInit())) return false;
  const { granted } = await getPermissionState();
  if (!granted.includes('write:SleepSession')) return false;
  await insertRecords([toHealthConnectSleep(s)]);
  return true;
}
