/**
 * Render tests for "Options for tonight" (Plan tab) and Today's "Still up?" card, on nights like the
 * user's: up at 6:00 with a 5:00 routine, ~3½ h of debt, usually asleep around 2 AM.
 *
 * The "Still up?" card and the night view belong to Today: those tests find things by the engine's
 * own words (an option's headline and title) and check what a tap did, not Today's copy.
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
/** The first thing you can tap after the text `after` (reading order): the button that belongs to it. */
const pressAfter = (after: string) => {
  const all = root.container.queryAll(() => true);
  const at = all.findIndex((i) => i.type === 'Text' && i.children.join('').includes(after));
  const button = at < 0 ? undefined : all.slice(at + 1).find((i) => typeof i.props.onClick === 'function' && !i.queryAll((c) => c === all[at]).length);
  return click(button, `the button after "${after}"`);
};
/** The button `label` inside the option row whose accessibility label starts with `row`. */
const pressInRow = (row: string, label: string) => {
  const r = root.container.queryAll((i) => typeof i.props.accessibilityLabel === 'string' && i.props.accessibilityLabel.startsWith(row))[0];
  const t = r?.queryAll((i) => i.type === 'Text' && i.children.join('') === label)[0];
  return click(clickableOf(t), `${row} › ${label}`);
};

describe('Options for tonight', () => {
  it("lists the options one line each with eepy's pick first, details on tap, and how eepy decided folded", async () => {
    await render(<PlanOptionsCard a={analysisAt(EVENING)} />);
    const useThis = () => root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === 'Use this');
    const t = text();
    expect(t).toContain('Options for tonight');
    expect(t).toContain("eepy's pick");
    expect(t).toContain("eepy's plan");
    expect(t).toContain('Lights out 23:52 · routine 05:00 · up 06:00');
    for (const title of ['Skip the routine', 'Full catch-up', 'Plan + nap tomorrow']) expect(t).toContain(title);
    // eepy's pick comes first.
    const rows = root.container.queryAll((i) => typeof i.props.accessibilityLabel === 'string' && i.props.accessibilityLabel.includes('debt in a week'));
    expect(rows).toHaveLength(4);
    expect(rows[0].props.accessibilityLabel).toMatch(/^eepy's plan, eepy's pick, in use\. Lights out 23:52/);
    // The pick is already in use, so nothing is open: one line each.
    expect(t).toContain('In use');
    expect(t).not.toContain('Keeps your routine at 05:00');
    expect(t).toContain("Planning earlier won't help while bedtime keeps slipping ~35 min");
    // Its numbers, pros and cons on tap. Durations never break across lines (no-break spaces). Nothing to use on it.
    await press("eepy's plan");
    expect(text()).toMatch(/5h\u00A0\d\dm sleep · debt in a week \dh\u00A0\d\dm/);
    expect(text()).toContain('Keeps your routine at 05:00');
    expect(text()).toContain("You've been going to bed ~35 min after the plan lately");
    expect(useThis()).toHaveLength(0);
    expect(text()).not.toContain('You have 3h 38m of sleep debt.');
    await press('How eepy decided');
    expect(text()).toContain('You have 3h 38m of sleep debt.');
    expect(text()).toContain('Last 3 nights you went to bed ~35 min after the plan.');
    expect(text()).toContain("So: keep eepy's plan — lights out 23:52, routine alarm 05:00.");
    // Another option's details on tap: its numbers against the plan, and "Use this".
    expect(text()).not.toMatch(/Tomorrow: energy \d+ \(plan \d+\)/);
    await press('Skip the routine');
    expect(text()).toMatch(/5h\u00A0\d\dm sleep \(\+30m\) · debt in a week/);
    expect(text()).toMatch(/Tomorrow: energy \d+ \(plan \d+\)/);
    expect(useThis()).toHaveLength(1);
    // One option open at a time.
    expect(text()).not.toContain('Keeps your routine at 05:00');
    // Every other option can be used.
    for (const title of ['Full catch-up', 'Plan + nap tomorrow']) {
      await press(title);
      expect(useThis()).toHaveLength(1);
    }
  });

  it('"Use this" skips the routine for that morning; then it shows as in use, with the way back', async () => {
    await render(<PlanOptionsCard a={analysisAt(EVENING)} />);
    await press('Skip the routine');
    await pressInRow('Skip the routine.', 'Use this');
    expect(useStore.getState().profile.wakePlan?.[TUE]).toEqual({ twoStep: false });
    expect(useStore.getState().settings.tonight).toEqual({ wakeDate: TUE, choice: { id: 'skip-routine', title: 'Skip the routine', routineBefore: null } });
    const a = analysisAt(EVENING);
    expect(a.tonight.twoStep).toBeUndefined();
    await remount(<PlanOptionsCard a={a} />);
    expect(text()).toContain("Using “Skip the routine” tonight. eepy's plan: lights out 23:52, routine 05:00, up 06:00.");
    const inUse = root.container.queryAll((i) => typeof i.props.accessibilityLabel === 'string' && i.props.accessibilityLabel.includes(', in use.')).map((i) => i.props.accessibilityLabel);
    expect(inUse.join('|')).toMatch(/^Skip the routine\b[^.|]*, in use\./);
    await press("Back to eepy's plan");
    expect(useStore.getState().profile.wakePlan?.[TUE]).toBeUndefined();
    expect(useStore.getState().settings.tonight).toBeUndefined();
    expect(analysisAt(EVENING).tonight.twoStep).toBeDefined();
  });

  it("past lights-out: eepy's pick from now is open, ready to use", async () => {
    clock = STILL_UP;
    await render(<PlanOptionsCard a={analysisAt(STILL_UP)} />);
    const t = text();
    expect(t).toContain('Lights out was 23:52.');
    expect(t).toContain("eepy's pick");
    expect(t).not.toContain('In use');
    // The pick's details are open, with the one button that uses it.
    expect(t).toMatch(/Tomorrow: energy \d+/);
    await press('Use this');
    expect(useStore.getState().settings.tonight).toMatchObject({ wakeDate: TUE, bedtime: atMinutes(USER_MON, 24 * 60 + 20), choice: { id: 'now-skip' } });
  });

  it('shows 12-hour times', async () => {
    setClockFormat('12h');
    await render(<PlanOptionsCard a={analysisAt(EVENING)} />);
    expect(text()).toContain('Lights out 11:52 PM · routine 5:00 AM · up 6:00 AM');
  });
});

describe('Still up?', () => {
  // The engine's words for the best plan from 00:05 and for two of the alternatives.
  const BEST = 'Lights out by 00:20, skip the routine';
  const shown = () => text().includes(BEST);

  it('past lights-out: the best plan from now in one tap, and a few alternatives', async () => {
    clock = STILL_UP;
    await render(<StillUpCard a={analysisAt(STILL_UP)} now={STILL_UP} />);
    const t = text();
    expect(t).toContain(BEST);
    expect(t).toContain('Lights out by 00:20 · alarm 06:00');
    expect(t).toContain('Bed now');
    expect(t).toContain('Another 30 min up');
    await pressAfter(BEST);
    expect(useStore.getState().settings.tonight).toMatchObject({ wakeDate: TUE, bedtime: atMinutes(USER_MON, 24 * 60 + 20), choice: { id: 'now-skip' } });
    expect(useStore.getState().profile.wakePlan?.[TUE]).toEqual({ twoStep: false });
    // Re-planned: lights-out is ahead again, the alarm follows (one alarm, no routine) — no "Still up?".
    const a = analysisAt(STILL_UP);
    expect(a.tonight.bedtime).toBe(atMinutes(USER_MON, 24 * 60 + 20));
    expect(a.tonight.twoStep).toBeUndefined();
    await remount(<StillUpCard a={a} now={STILL_UP} />);
    expect(shown()).toBe(false);
    expect(root.container.queryAll((i) => i.type === 'Text')).toHaveLength(0);
  });

  it('an alternative is one tap too', async () => {
    clock = STILL_UP;
    await render(<StillUpCard a={analysisAt(STILL_UP)} now={STILL_UP} />);
    await pressAfter('Bed now');
    expect(useStore.getState().settings.tonight).toMatchObject({ bedtime: atMinutes(USER_MON, 24 * 60 + 20), choice: { id: 'now' } });
    // Bed now keeps the routine.
    expect(useStore.getState().profile.wakePlan?.[TUE]).toBeUndefined();
  });

  it("is in Today's night view after lights-out (not before, not once in bed)", async () => {
    clock = STILL_UP;
    const a = analysisAt(STILL_UP);
    await render(<NightView a={a} now={STILL_UP} input={phaseInputFor(a, useStore.getState().profile)} />);
    expect(shown()).toBe(true);
    await remount(<StillUpCard a={analysisAt(EVENING)} now={EVENING} />);
    expect(root.container.queryAll((i) => i.type === 'Text')).toHaveLength(0);
    await act(async () => useStore.getState().setSettings({ session: { inBedAt: STILL_UP, wakeDate: TUE, wakeAt: atMinutes(TUE, 6 * 60), retimed: false } }));
    await remount(<StillUpCard a={a} now={STILL_UP} />);
    expect(root.container.queryAll((i) => i.type === 'Text')).toHaveLength(0);
  });
});
