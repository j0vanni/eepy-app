import { computeSessionMetrics } from '../../engine/sessions';
import { parseBackup, serializeBackup } from '../backup';
import { generateDemoData } from '../../engine/demo';
import {
  buildDailyStats,
  flattenHeartRate,
  instantSamples,
  mapSleepRecord,
  mapSpo2Samples,
  originLabel,
  stepsPerDay,
  summarizeOrigins,
  toHealthConnectSleep,
} from '../healthConnectMapper';

jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-document-picker', () => ({}));

const cmfNight = {
  startTime: '2026-10-21T04:10:00.000Z',
  endTime: '2026-10-21T12:05:00.000Z',
  title: 'Sleep',
  stages: [
    { startTime: '2026-10-21T04:10:00.000Z', endTime: '2026-10-21T04:25:00.000Z', stage: 7 },
    { startTime: '2026-10-21T04:25:00.000Z', endTime: '2026-10-21T05:10:00.000Z', stage: 4 },
    { startTime: '2026-10-21T05:10:00.000Z', endTime: '2026-10-21T05:50:00.000Z', stage: 5 },
    { startTime: '2026-10-21T05:50:00.000Z', endTime: '2026-10-21T06:05:00.000Z', stage: 6 },
    { startTime: '2026-10-21T06:05:00.000Z', endTime: '2026-10-21T06:10:00.000Z', stage: 1 },
    { startTime: '2026-10-21T06:10:00.000Z', endTime: '2026-10-21T12:00:00.000Z', stage: 4 },
    { startTime: '2026-10-21T12:00:00.000Z', endTime: '2026-10-21T12:05:00.000Z', stage: 3 },
  ],
  metadata: { id: 'abc', dataOrigin: 'com.nothing.smartcenter', device: { manufacturer: 'Nothing', model: 'CMF Watch 3 Pro' } },
};

describe('Health Connect mapping', () => {
  it('maps a staged CMF sleep session', () => {
    const s = mapSleepRecord(cmfNight);
    expect(s.id).toBe('hc:abc');
    expect(s.source).toBe('health-connect');
    expect(s.origin).toBe('com.nothing.smartcenter');
    expect(s.device).toBe('Nothing CMF Watch 3 Pro');
    expect(s.stages.map((x) => x.stage)).toEqual(['awake', 'light', 'deep', 'rem', 'awake', 'light', 'outOfBed']);
    const m = computeSessionMetrics(s)!;
    expect(m.latencyMin).toBe(15);
    expect(m.stageMin.deep).toBe(40);
    expect(m.awakenings).toBe(1);
  });

  it('merges minute-level stage records into runs', () => {
    const minute = (i: number, stage: number) => ({
      startTime: new Date(Date.parse('2026-10-21T05:00:00Z') + i * 60000).toISOString(),
      endTime: new Date(Date.parse('2026-10-21T05:00:00Z') + (i + 1) * 60000).toISOString(),
      stage,
    });
    const stages = [...Array.from({ length: 30 }, (_, i) => minute(i, 4)), ...Array.from({ length: 20 }, (_, i) => minute(30 + i, 5))];
    const s = mapSleepRecord({ ...cmfNight, stages });
    expect(s.stages).toHaveLength(2);
    expect(s.stages.map((x) => x.stage)).toEqual(['light', 'deep']);
  });

  it('flags naps from the record title', () => {
    expect(mapSleepRecord({ ...cmfNight, title: 'Afternoon nap' }).kind).toBe('nap');
  });

  it('flattens heart-rate series and instantaneous records', () => {
    const hr = flattenHeartRate([
      { startTime: 'x', endTime: 'y', samples: [{ time: '2026-10-21T05:00:00Z', beatsPerMinute: 55 }, { time: '2026-10-21T04:59:00Z', beatsPerMinute: 57 }] },
    ]);
    expect(hr.map((s) => s.value)).toEqual([57, 55]);
    expect(instantSamples([{ time: '2026-10-21T05:00:00Z', percentage: 96 }, { time: 'bad', percentage: 'x' }], 'percentage')).toHaveLength(1);
  });

  it('maps OxygenSaturation records (one per reading) with their origin, dropping bad and duplicate ones', () => {
    const rec = (time: string, percentage: unknown, dataOrigin = 'com.nothing.smartcenter') => ({ time, percentage, metadata: { dataOrigin } });
    const out = mapSpo2Samples([
      rec('2026-10-21T08:04:00.000Z', 95),
      rec('2026-10-21T08:00:00.000Z', 96.5),
      rec('2026-10-21T08:00:00.000Z', 96.5), // written twice
      rec('2026-10-21T08:00:00.000Z', 93, 'com.other.app'), // another app, same moment: kept separately
      rec('2026-10-21T08:08:00.000Z', 0),
      rec('2026-10-21T08:12:00.000Z', 101),
      rec('2026-10-21T08:16:00.000Z', 'n/a'),
      { time: '2026-10-21T08:20:00.000Z', percentage: 94 },
    ]);
    expect(out).toEqual([
      { time: Date.parse('2026-10-21T08:00:00.000Z'), value: 96.5, origin: 'com.nothing.smartcenter' },
      { time: Date.parse('2026-10-21T08:00:00.000Z'), value: 93, origin: 'com.other.app' },
      { time: Date.parse('2026-10-21T08:04:00.000Z'), value: 95, origin: 'com.nothing.smartcenter' },
      { time: Date.parse('2026-10-21T08:20:00.000Z'), value: 94 },
    ]);
  });

  it('splits step records across midnight', () => {
    const steps = stepsPerDay([{ startTime: '2026-10-21T04:00:00.000Z', endTime: '2026-10-21T06:00:00.000Z', count: 1000 }]);
    // 04:00Z–06:00Z is 23:00–01:00 in America/Chicago.
    expect(steps['2026-10-20']).toBe(500);
    expect(steps['2026-10-21']).toBe(500);
    const daily = buildDailyStats(steps, [{ time: Date.parse('2026-10-21T14:00:00Z'), value: 58 }], []);
    expect(daily['2026-10-21']).toEqual({ date: '2026-10-21', steps: 500, restingHr: 58 });
  });

  it('labels and ranks data origins, preferring the watch', () => {
    expect(originLabel('com.nothing.smartcenter')).toEqual({ label: 'Nothing X (CMF Watch)', likelyWatch: true });
    const sessions = [mapSleepRecord(cmfNight), mapSleepRecord({ ...cmfNight, stages: [], metadata: { id: 'p', dataOrigin: 'com.google.android.apps.fitness' } })];
    const origins = summarizeOrigins(sessions);
    expect(origins[0].origin).toBe('com.nothing.smartcenter');
    expect(origins[0].staged).toBe(true);
    expect(origins[1].staged).toBe(false);
  });

  it('round-trips a manual log into a Health Connect insert payload', () => {
    const s = mapSleepRecord(cmfNight);
    const payload = toHealthConnectSleep(s);
    expect(payload.recordType).toBe('SleepSession');
    expect(payload.stages.map((x) => x.stage)).toEqual([1, 4, 5, 6, 1, 4, 3]);
  });
});

describe('backup', () => {
  it('serialises and validates a backup', () => {
    const data = generateDemoData(Date.parse('2026-10-28T19:00:00Z'), { days: 7 });
    const restored = parseBackup(serializeBackup(data));
    expect(restored.sessions).toHaveLength(data.sessions.length);
    expect(() => parseBackup('{"hello":1}')).toThrow(/not an eepy backup/);
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/);
  });
});
