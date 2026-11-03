/**
 * Render tests for "Options for tonight" (Planner → Tonight) and Today's "Still up?" card, on nights
 * like the user's: up at 6:00 with a 5:00 routine, ~3½ h of debt, usually asleep around 2 AM.
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), navigate: (...a: unknown[]) => mockPush(...a), back: jest.fn(), canGoBack: () => false } }));
jest.mock('../../integrations/screen', () => ({
  getScreenBrightness: () => Promise.resolve(undefined),
  dimEepy: () => Promise.resolve(),
  undimEepy: () => Promise.resolve(),
  screenControlsSupported: () => false,
}));

import { act } from 'react';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { analyze, Analysis } from '../../engine/analysis';
import { phaseInputFor } from '../../engine/dayPhase';
import { addDays, atMinutes, setClockFormat } from '../../engine/time';
import { USER_MON, userLikeData } from '../../engine/__tests__/helpers';
import { analyzeOptionsFor } from '../../state/analysisOptions';
import { selectDataset, useStore } from '../../state/store';
import { PlanOptionsCard } from '../planner/PlanOptions';
import { NightView } from '../today/heroes';
import { StillUpCard } from '../today/StillUp';

const TUE = addDays(USER_MON, 1);
const EVENING = atMinutes(USER_MON, 21 * 60);
const STILL_UP = atMinutes(USER_MON, 24 * 60 + 5);
let clock = EVENING;
let root: Root;

const analysisAt = (now: number): Analysis => {
  const s = useStore.getState();
  return analyze(selectDataset(s), now, analyzeOptionsFor(s, { now }));
};

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  clock = EVENING;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const { data, planLog } = userLikeData();
  useStore.setState({ ...data, checkins: [], workouts: [], wakeLog: data.wakeLog!, planLog });
  const st = useStore.getState();
  st.setSettings({ session: undefined, tonight: undefined, marks: {}, clock: '24h', dataMode: 'live' });
  st.setNotificationPrefs({ screensOff: true, smartAlarm: true });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  setClockFormat('24h');
  jest.restoreAllMocks();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  await act(async () => undefined);
};
/** A fresh mount (the cards keep their own open / closed state). */
const remount = async (el: React.ReactElement) => {
  await act(async () => root.unmount());
  root = createRoot();
  await render(el);
};
const text = () =>
  root.container
    .queryAll((i) => i.type === 'Text')
    .map((i) => i.children.filter((c) => typeof c === 'string').join(''))
    .join('\n');
const clickableOf = (n: TestInstance | null | undefined) => {
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const click = async (n: TestInstance | undefined, what: string) => {
  if (!n) throw new Error(`no "${what}" in ${text()}`);
  await act(async () => n.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined }));
  await act(async () => undefined);
};
const press = (label: string) => click(clickableOf(root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === label)[0]), label);
/** The button `label` inside the option row whose accessibility label starts with `row`. */
const pressInRow = (row: string, label: string) => {
  const r = root.container.queryAll((i) => typeof i.props.accessibilityLabel === 'string' && i.props.accessibilityLabel.startsWith(row))[0];
  const t = r?.queryAll((i) => i.type === 'Text' && i.children.join('') === label)[0];
  return click(clickableOf(t), `${row} › ${label}`);
};

describe('Options for tonight', () => {
  it("lists the options with eepy's pick first, its details open, and how eepy decided folded", async () => {
    await render(<PlanOptionsCard a={analysisAt(EVENING)} />);
    const t = text();
    expect(t).toContain('Options for tonight');
    expect(t).toContain("EEPY'S PICK");
    expect(t).toContain("eepy's plan");
    expect(t).toContain('Lights out 23:52 · routine 05:00 · up 06:00');
    // Durations never break across lines (no-break spaces).
    expect(t).toMatch(/5h\u00A0\d\dm sleep · debt in a week \dh\u00A0\d\dm/);
    for (const title of ['Skip the routine', 'Full catch-up', 'Plan + nap tomorrow']) expect(t).toContain(title);
    expect(t).toMatch(/5h\u00A0\d\dm sleep \(\+30m\) · debt in a week/);
    // eepy's plan is in use (no "Use this" on it), the others can be used.
    expect(t).toContain('IN USE');
    expect(root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === 'Use this')).toHaveLength(3);
    // The pick's pros and cons are open.
    expect(t).toContain('Keeps your routine at 05:00');
    expect(t).toContain("You've been going to bed ~35 min after the plan lately");
    expect(t).toContain("Planning earlier won't help while bedtime keeps slipping ~35 min");
    expect(t).not.toContain('You have 3h 38m of sleep debt.');
    await press('How eepy decided');
    expect(text()).toContain('You have 3h 38m of sleep debt.');
    expect(text()).toContain('Last 3 nights you went to bed ~35 min after the plan.');
    expect(text()).toContain("So: keep eepy's plan — lights out 23:52, routine alarm 05:00.");
    // Another option's details on tap.
    await press('Pros, cons and the week');
    expect(text()).toMatch(/Tomorrow: energy \d+ \(plan \d+\)/);
  });

  it('"Use this" skips the routine for that morning; then it shows as in use, with the way back', async () => {
    await render(<PlanOptionsCard a={analysisAt(EVENING)} />);
    await pressInRow('Skip the routine.', 'Use this');
    expect(useStore.getState().profile.wakePlan?.[TUE]).toEqual({ twoStep: false });
    expect(useStore.getState().settings.tonight).toEqual({ wakeDate: TUE, choice: { id: 'skip-routine', title: 'Skip the routine', routineBefore: null } });
    const a = analysisAt(EVENING);
    expect(a.tonight.twoStep).toBeUndefined();
    await remount(<PlanOptionsCard a={a} />);
    expect(text()).toContain("Using “Skip the routine” tonight. eepy's plan: lights out 23:52, routine 05:00, up 06:00.");
    await press("Back to eepy's plan");
    expect(useStore.getState().profile.wakePlan?.[TUE]).toBeUndefined();
    expect(useStore.getState().settings.tonight).toBeUndefined();
    expect(analysisAt(EVENING).tonight.twoStep).toBeDefined();
  });

  it('shows 12-hour times', async () => {
    setClockFormat('12h');
    await render(<PlanOptionsCard a={analysisAt(EVENING)} />);
    expect(text()).toContain('Lights out 11:52 PM · routine 5:00 AM · up 6:00 AM');
  });
});

describe('Still up?', () => {
  it('past lights-out: the best plan from now in one tap, and a few alternatives', async () => {
    clock = STILL_UP;
    await render(<StillUpCard a={analysisAt(STILL_UP)} now={STILL_UP} />);
    const t = text();
    expect(t).toContain('STILL UP?');
    expect(t).toContain('Lights out by 00:20, skip the routine → 5h 25m');
    expect(t).toContain('Lights out by 00:20 · alarm 06:00');
    expect(t).toContain('OR');
    expect(t).toContain('Bed now');
    expect(t).toContain('Another 30 min up');
    await press('Use this');
    expect(useStore.getState().settings.tonight).toMatchObject({ wakeDate: TUE, bedtime: atMinutes(USER_MON, 24 * 60 + 20), choice: { id: 'now-skip' } });
    expect(useStore.getState().profile.wakePlan?.[TUE]).toEqual({ twoStep: false });
    // Re-planned: lights-out is ahead again, the alarm follows (one alarm, no routine) — no "Still up?".
    const a = analysisAt(STILL_UP);
    expect(a.tonight.bedtime).toBe(atMinutes(USER_MON, 24 * 60 + 20));
    expect(a.tonight.twoStep).toBeUndefined();
    await remount(<StillUpCard a={a} now={STILL_UP} />);
    expect(text()).not.toContain('STILL UP?');
  });

  it('an alternative is one tap too', async () => {
    clock = STILL_UP;
    await render(<StillUpCard a={analysisAt(STILL_UP)} now={STILL_UP} />);
    const bedNow = root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === 'Bed now')[0];
    let row: TestInstance | null | undefined = bedNow;
    while (row && !row.queryAll((i) => i.type === 'Text' && i.children.join('') === 'Use').length) row = row.parent;
    await click(clickableOf(row!.queryAll((i) => i.type === 'Text' && i.children.join('') === 'Use')[0]), 'Use');
    expect(useStore.getState().settings.tonight).toMatchObject({ bedtime: atMinutes(USER_MON, 24 * 60 + 20), choice: { id: 'now' } });
    // Bed now keeps the routine.
    expect(useStore.getState().profile.wakePlan?.[TUE]).toBeUndefined();
  });

  it("is in Today's night view after lights-out (not before, not once in bed)", async () => {
    clock = STILL_UP;
    const a = analysisAt(STILL_UP);
    await render(<NightView a={a} now={STILL_UP} input={phaseInputFor(a, useStore.getState().profile)} />);
    expect(text()).toContain('STILL UP?');
    expect(text()).not.toContain('Still up? Re-plan the rest of the night');
    await remount(<StillUpCard a={analysisAt(EVENING)} now={EVENING} />);
    expect(text()).not.toContain('STILL UP?');
    await act(async () => useStore.getState().setSettings({ session: { inBedAt: STILL_UP, wakeDate: TUE, wakeAt: atMinutes(TUE, 6 * 60), retimed: false } }));
    await remount(<StillUpCard a={a} now={STILL_UP} />);
    expect(text()).not.toContain('STILL UP?');
  });
});
