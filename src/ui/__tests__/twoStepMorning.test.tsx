/**
 * Render tests for two-step mornings: the editor (switch, steppers, mornings, the next two-step
 * night), Today's routine card (only around the routine; skipping the routine or the final alarm,
 * with undo), the "did you do it?" question afterwards and the night timeline's routine step.
 *
 * The routine card, the question and the timeline belong to Today / Sleep: those tests find their
 * buttons by a loose pattern and check what a tap did (marks, the wake plan, the native alarm) and
 * the times shown, not the surrounding copy.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2, MAX: 5 },
  AndroidAudioUsage: { ALARM: 4 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockNative = {
  scheduleAlarm: jest.fn((..._args: unknown[]) => Promise.resolve(true)),
  cancelAlarm: jest.fn((_id: string) => Promise.resolve()),
  canUseFullScreenIntent: jest.fn(() => Promise.resolve(true)),
  openFullScreenIntentSettings: jest.fn(() => Promise.resolve()),
};
jest.mock('../../../modules/eepy-alarm', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

import { act } from 'react';
import { Platform } from 'react-native';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { analyze } from '../../engine/analysis';
import { computeSessionMetrics } from '../../engine/sessions';
import { atMinutes, MINUTE } from '../../engine/time';
import type { TwoStepMorning } from '../../engine/types';
import type { NightTimeline } from '../../engine/wakeDetect';
import { resetWakeAlarmMemo, WAKE_AT_MARK, WAKE_FINAL_SKIP_MARK, WAKE_ROUTINE_AT_MARK, WAKE_ROUTINE_SKIP_MARK } from '../../notifications/fullScreenAlarm';
import { selectDataset, useStore } from '../../state/store';
import { RoutineMorningNow } from '../cards/RoutineMorningNow';
import { TwoStepMorningCard } from '../cards/TwoStepMorningCard';
import { RoutineCheck } from '../RoutineCheck';
import { NightTimelineCard } from '../WakeCheck';

const THU_EVE = atMinutes('2026-10-22', 21 * 60);
const FRI = '2026-10-23';
const TWO: TwoStepMorning = { enabled: true, firstWakeMin: 5 * 60, routineMin: 20 };
const prevOS = Platform.OS;
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  resetWakeAlarmMemo();
  jest.spyOn(Date, 'now').mockReturnValue(THU_EVE);
  (Platform as { OS: string }).OS = 'android';
  useStore.getState().loadDemo(THU_EVE);
  useStore.getState().setProfile({ onboarded: true, workWakeMin: 6 * 60 + 5, twoStepMorning: undefined });
  useStore.getState().setNotificationPrefs({ smartAlarm: true });
  useStore.getState().setSettings({ clock: '24h', marks: {} });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  await act(async () => undefined);
};
const text = () => JSON.stringify(root.container.toJSON());
const find = (test: (i: TestInstance) => boolean) => root.container.queryAll(test)[0];
const press = async (label: string | RegExp) => {
  const matches = (t: string) => (typeof label === 'string' ? t.includes(label) : label.test(t));
  let n: TestInstance | null | undefined = find((i) => i.type === 'Text' && matches(i.children.join('')));
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  if (!n) throw new Error(`no button "${label}"`);
  const target = n;
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined }));
};

describe('TwoStepMorningCard', () => {
  it('switches on, remembering from which morning', async () => {
    await render(<TwoStepMorningCard />);
    expect(text()).toContain('Two-step mornings');
    expect(text()).not.toContain('Routine alarm');
    // The native switch (RCTSwitch / AndroidSwitch, depending on the platform under test).
    const toggle = find((i) => i.props.accessibilityRole === 'switch' && typeof i.props.onChange === 'function');
    expect(toggle).toBeDefined();
    await act(async () => toggle!.props.onChange({ nativeEvent: { value: true } }));
    expect(useStore.getState().profile.twoStepMorning).toMatchObject({ enabled: true, firstWakeMin: 300, routineMin: 20, since: FRI });
  });

  it('previews the next two-step night', async () => {
    useStore.getState().setProfile({ twoStepMorning: TWO });
    await render(<TwoStepMorningCard />);
    const t = text();
    expect(t).toContain('Routine alarm');
    expect(t).toContain('05:00');
    expect(t).toContain('06:05');
    expect(t).toMatch(/routine alarm → back to sleep ~/);
    expect(t).toContain('Tomorrow');
    // A longer routine, from the stepper.
    const inc = find((i) => i.props.accessibilityLabel === 'Increase Routine' && typeof i.props.onClick === 'function');
    await act(async () => inc!.props.onClick({ nativeEvent: {}, stopPropagation: () => undefined }));
    expect(useStore.getState().profile.twoStepMorning?.routineMin).toBe(25);
  });

  it('picks the mornings', async () => {
    useStore.getState().setProfile({ workdays: [1, 2, 3, 4, 5], twoStepMorning: TWO });
    await render(<TwoStepMorningCard />);
    await press('Sat');
    expect(useStore.getState().profile.twoStepMorning?.days).toEqual([1, 2, 3, 4, 5, 6]);
    // Saturday isn't a workday: only two-step when a wake-up is set for that date.
    expect(text()).toContain("Saturday isn't a workday");
    await press('Mon');
    expect(useStore.getState().profile.twoStepMorning?.days).toEqual([2, 3, 4, 5, 6]);
  });

  it('embedded (Your usual week, Settings): the same switch and controls as a row', async () => {
    await render(<TwoStepMorningCard embedded />);
    expect(text()).not.toContain('Routine alarm');
    await press('Two-step mornings');
    expect(useStore.getState().profile.twoStepMorning).toMatchObject({ enabled: true, since: FRI });
    expect(text()).toContain('Routine alarm');
    await press('Two-step mornings');
    expect(useStore.getState().profile.twoStepMorning).toMatchObject({ enabled: false });
    expect(text()).not.toContain('Routine alarm');
  });

  it('explains a setting that would not work', async () => {
    useStore.getState().setProfile({ twoStepMorning: { ...TWO, firstWakeMin: 6 * 60 + 30 } });
    await render(<TwoStepMorningCard />);
    expect(text()).toContain('The routine alarm has to be before your 06:05 wake-up.');
  });
});

describe('RoutineMorningNow', () => {
  function morning(hour: number, marks: Record<string, string | number | undefined> = {}) {
    useStore.getState().setProfile({ twoStepMorning: TWO });
    // What syncWakeAlarm records before 4am: this morning's two alarms.
    const before = analyze(selectDataset(useStore.getState()), atMinutes(FRI, 3 * 60));
    useStore.getState().setSettings({ marks: { [WAKE_AT_MARK]: before.tonight.wake, [WAKE_ROUTINE_AT_MARK]: before.alarm.alarm, ...marks } });
    const now = atMinutes(FRI, hour * 60);
    (Date.now as jest.Mock).mockReturnValue(now);
    return { routineAt: before.alarm.alarm, final: before.tonight.wake };
  }

  it('shows nothing outside the routine', async () => {
    morning(7);
    await render(<RoutineMorningNow />);
    expect(root.container.children).toHaveLength(0);
  });

  it('during the routine: back to bed by …, alarm at 06:05 — and "staying up" skips it', async () => {
    const { routineAt } = morning(5);
    await render(<RoutineMorningNow />);
    const t = text();
    // The final alarm, and when to be back in bed.
    expect(t).toContain('06:05');
    const by = new Date(routineAt + 20 * MINUTE);
    const hhmm = `${String(by.getHours()).padStart(2, '0')}:${String(by.getMinutes()).padStart(2, '0')}`;
    if (Date.now() < routineAt + 20 * MINUTE) expect(t).toContain(hhmm);
    await press(/staying up/i);
    expect(useStore.getState().settings.marks[WAKE_FINAL_SKIP_MARK]).toBe(FRI);
    await act(async () => undefined);
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith('eepy-wake');
    await render(<RoutineMorningNow />);
    await press(/undo/i);
    expect(useStore.getState().settings.marks[WAKE_FINAL_SKIP_MARK]).toBeUndefined();
  });
});

describe('skipping the routine', () => {
  function morning(hour: number) {
    useStore.getState().setProfile({ twoStepMorning: TWO, wakePlan: {} });
    const before = analyze(selectDataset(useStore.getState()), atMinutes(FRI, 3 * 60));
    useStore.getState().setSettings({ marks: { [WAKE_AT_MARK]: before.tonight.wake, [WAKE_ROUTINE_AT_MARK]: before.alarm.alarm } });
    (Date.now as jest.Mock).mockReturnValue(atMinutes(FRI, hour * 60));
    return { routineAt: before.alarm.alarm };
  }

  it('awake before the routine alarm: skip it and sleep through to 06:05 (and undo)', async () => {
    const { routineAt } = morning(4.25);
    expect(Date.now()).toBeLessThan(routineAt);
    await render(<RoutineMorningNow />);
    expect(text()).toContain('06:05');
    await press(/skip the routine/i);
    expect(useStore.getState().settings.marks[WAKE_ROUTINE_SKIP_MARK]).toBe(FRI);
    expect(useStore.getState().profile.wakePlan?.[FRI]).toEqual({ twoStep: false });
    expect(mockNative.cancelAlarm).toHaveBeenCalledWith('eepy-wake-routine');
    expect(mockNative.cancelAlarm).not.toHaveBeenCalledWith('eepy-wake');
    // Still says when the one alarm left rings.
    expect(text()).toContain('06:05');
    await press(/undo/i);
    expect(useStore.getState().settings.marks[WAKE_ROUTINE_SKIP_MARK]).toBeUndefined();
    expect(useStore.getState().profile.wakePlan?.[FRI]).toBeUndefined();
  });

  it('during the routine: "Skip it — back to sleep" keeps the final alarm', async () => {
    morning(5.1);
    await render(<RoutineMorningNow />);
    await press(/skip it/i);
    expect(useStore.getState().settings.marks[WAKE_ROUTINE_SKIP_MARK]).toBe(FRI);
    expect(useStore.getState().settings.marks[WAKE_FINAL_SKIP_MARK]).toBeUndefined();
    expect(useStore.getState().profile.wakePlan?.[FRI]).toEqual({ twoStep: false });
    // The way back.
    await press(/undo/i);
    expect(useStore.getState().settings.marks[WAKE_ROUTINE_SKIP_MARK]).toBeUndefined();
  });

  it('afterwards: "Did it / Skipped it" on the morning', async () => {
    useStore.getState().setProfile({ twoStepMorning: { ...TWO, since: '2026-10-01' }, wakePlan: {} });
    (Date.now as jest.Mock).mockReturnValue(atMinutes(FRI, 8 * 60));
    const m = { wakeDate: FRI, isNap: false } as Parameters<typeof RoutineCheck>[0]['m'];
    await render(<RoutineCheck m={m} compact />);
    expect(root.container.children).not.toHaveLength(0);
    await press(/did it/i);
    expect(useStore.getState().profile.wakePlan?.[FRI]).toEqual({ twoStep: true });
    await press(/skipped it/i);
    expect(useStore.getState().profile.wakePlan?.[FRI]).toEqual({ twoStep: false });
    // Not a routine morning (Saturday) and nothing said: no question.
    await render(<RoutineCheck m={{ ...m, wakeDate: '2026-10-24' }} compact />);
    expect(root.container.children).toHaveLength(0);
  });
});

describe('Night timeline', () => {
  it('labels the routine and says when you were back asleep', async () => {
    const at = (h: number, m = 0) => atMinutes(h >= 12 ? '2026-10-20' : '2026-10-21', h * 60 + m);
    const m = computeSessionMetrics(
      {
        id: 'n',
        source: 'health-connect',
        start: at(23),
        end: at(6, 10),
        stages: [
          { stage: 'light', start: at(23), end: at(2) },
          { stage: 'deep', start: at(2), end: at(3) },
          { stage: 'rem', start: at(3), end: at(4, 47) },
          { stage: 'awake', start: at(4, 47), end: at(5, 12) },
          { stage: 'light', start: at(5, 12), end: at(6, 5) },
          { stage: 'awake', start: at(6, 5), end: at(6, 10) },
        ],
      },
      { routine: { start: at(4, 47), end: at(5, 12) } },
    )!;
    const b = (time: number) => ({ time, source: 'watch' as const, confidence: 'medium' as const });
    const t: NightTimeline = {
      id: 'n',
      recorded: { start: m.start, end: m.end, onset: m.sleepOnset, finalWake: m.finalWake },
      inBed: b(m.start),
      asleep: b(m.sleepOnset),
      woke: b(m.finalWake),
      outOfBed: b(m.end),
      trimmedMin: 0,
      onsetShiftMin: 0,
      onsetEvidence: [],
      upEvidence: [],
      episodes: [{ start: at(4, 47), end: at(5, 12), minutes: 25, up: true, steps: 100, usedEepy: true, routine: true }],
      fixed: false,
      confirmed: true,
      askLate: false,
      routine: { start: at(4, 47), end: at(5, 12), minutes: 25, plannedMin: 25, stayedUp: false, backAsleep: at(5, 12), evidence: ['stopped the alarm'] },
    };
    await render(<NightTimelineCard m={m} t={t} />);
    const s = text();
    // The planned time awake is named as the routine, with when you were back asleep.
    expect(s).toMatch(/routine/i);
    expect(s).toContain('05:12');
  });
});
