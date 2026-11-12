/**
 * Render tests for the sleep session's buttons and states: "I'm in bed" from wind-down (Today's quick
 * actions and the night view), the confirmation with Undo, "In bed since …" with I'm up / Cancel,
 * the morning's "I'm up" with Undo, and "Save last night from your taps".
 */
// Icons load their font asynchronously, which Jest's asset registry can't serve.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('../../integrations/screen', () => ({
  getScreenBrightness: () => Promise.resolve(undefined),
  dimEepy: () => Promise.resolve(),
  undimEepy: () => Promise.resolve(),
  screenControlsSupported: () => false,
}));

import { act } from 'react';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { soundPlayer } from '../../audio/player';
import { analyze, Analysis } from '../../engine/analysis';
import { phaseInputFor } from '../../engine/dayPhase';
import { closeInBed } from '../../engine/inBed';
import { atMinutes, MINUTE } from '../../engine/time';
import { analyzeOptionsFor } from '../../state/analysisOptions';
import { startInBedSession } from '../../state/inBed';
import { selectDataset, useStore } from '../../state/store';
import { colors } from '../theme';
import { InBedButton, SessionHeader, TapsNightCard, UpCard } from '../today/InBed';
import { NightView } from '../today/heroes';
import { QuickActions } from '../today/QuickActions';

// Monday 2026-11-02: wind-down from ~22:08, lights-out ~23:08, wake-up Tuesday 07:00.
const DAY = '2026-11-02';
const WINDING = atMinutes(DAY, 22 * 60 + 45);
let clock = WINDING;
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
  clock = WINDING;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const st = useStore.getState();
  st.loadDemo(WINDING);
  st.setProfile({ onboarded: true });
  st.setSettings({ session: undefined, tonight: undefined, inBedSounds: undefined, marks: {}, clock: '24h' });
  st.setNotificationPrefs({ smartAlarm: true });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  soundPlayer.stopNow();
  jest.restoreAllMocks();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  await act(async () => undefined);
};
/** Every Text on screen, its pieces joined ("In bed {time}" renders as several children). */
const text = () =>
  root.container
    .queryAll((i) => i.type === 'Text')
    .map((i) => i.children.filter((c) => typeof c === 'string').join(''))
    .join('\n');
/** A fresh mount (components keep their own clock between renders). */
const remount = async () => {
  await act(async () => root.unmount());
  root = createRoot();
};
const button = (label: string): TestInstance | undefined => {
  let n: TestInstance | null | undefined = root.container.queryAll((i) => i.type === 'Text' && i.children.join('') === label)[0];
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  return n ?? undefined;
};
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}" in ${text()}`);
  await act(async () => target.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined }));
  await act(async () => undefined);
};
const nightView = (now: number) => {
  const a = analysisAt(now);
  return <NightView a={a} now={now} input={phaseInputFor(a, useStore.getState().profile)} />;
};

describe("I'm in bed", () => {
  it('is in the quick actions from wind-down (Wind down before it) and starts the session in one tap', async () => {
    const a = analysisAt(WINDING);
    await render(<QuickActions phase="evening" a={a} now={a.tonight.windDownStart - 10 * MINUTE} />);
    expect(button('Wind down')).toBeDefined();
    expect(button("I'm in bed")).toBeUndefined();
    await render(<QuickActions phase="evening" a={a} now={WINDING} />);
    expect(button('Wind down')).toBeUndefined();
    await press("I'm in bed");
    expect(useStore.getState().settings.session).toMatchObject({ inBedAt: WINDING, retimed: true });
  });

  it('the big button remembers "Start sleep sounds"', async () => {
    await render(<InBedButton a={analysisAt(WINDING)} />);
    expect(text()).toContain('Start sleep sounds');
    expect(text()).toContain('Brown noise · 45 min');
    const toggle = root.container.queryAll((i) => i.props.accessibilityRole === 'switch' && typeof i.props.onClick === 'function')[0];
    await act(async () => toggle.props.onClick({ nativeEvent: {}, stopPropagation: () => undefined }));
    expect(useStore.getState().settings.inBedSounds).toBe(false);
    await press("I'm in bed");
    expect(useStore.getState().settings.session?.soundsStarted).toBeUndefined();
    expect(soundPlayer.getState().status).toBe('idle');
  });

  it('night view: the button, then the confirmation with Undo, then "In bed since" with I\'m up / Cancel', async () => {
    const lateNight = atMinutes(DAY, 23 * 60 + 42);
    clock = lateNight;
    await render(nightView(lateNight));
    expect(text()).toContain('Time to sleep');
    await press("I'm in bed");
    expect(useStore.getState().settings.session?.inBedAt).toBe(lateNight);

    await render(nightView(lateNight));
    const t = text();
    expect(t).toContain('Sleep session started');
    expect(t).toContain('In bed since 23:42');
    expect(t).toMatch(/Alarm 0[67]:\d\d/);
    expect(t).toContain('Brown noise · 45 min');
    expect(t).toContain("Tonight's reminders are off. Sleep well.");
    expect(t).not.toContain('Time to sleep');
    expect(button('Undo')).toBeDefined();
    expect(button("I'm up")).toBeUndefined();

    clock = lateNight + 3 * MINUTE;
    await remount();
    await render(nightView(clock));
    expect(text()).toContain('In bed since 23:42');
    expect(text()).not.toContain('Sleep session started');
    expect(button('Undo')).toBeUndefined();
    expect(button("I'm up")).toBeDefined();
    await press('Cancel');
    expect(useStore.getState().settings.session).toBeUndefined();
    expect(useStore.getState().settings.tonight).toBeUndefined();
    await render(nightView(clock));
    expect(text()).toContain('Time to sleep');
    expect(button("I'm in bed")).toBeDefined();
  });

  it('on the night view the button is not a filled amber block (the kit\'s primary), elsewhere it is', async () => {
    const background = (): unknown => {
      // The pressable's own style, flattened: its background colour.
      const style = button("I'm in bed")!.props.style;
      return Object.assign({}, ...[style].flat(Infinity).filter(Boolean)).backgroundColor;
    };
    await render(<InBedButton a={analysisAt(WINDING)} />);
    const day = background();
    expect(day).toBe(colors.accent);
    await remount();
    await render(<InBedButton a={analysisAt(WINDING)} night />);
    expect(background()).not.toBe(day);
    await press("I'm in bed");
    expect(useStore.getState().settings.session).toMatchObject({ inBedAt: WINDING });
  });

  it('"I\'m up" in the header ends the session, with Undo; before the alarm it says "End session"', async () => {
    await startInBedSession(analysisAt(WINDING), WINDING);
    // 01:10: nothing else on screen says "I'm up".
    clock = atMinutes('2026-11-03', 70);
    await render(<SessionHeader a={analysisAt(clock)} />);
    expect(button('End session')).toBeUndefined();
    // 04:30: the early "I'm up" (which also turns the alarms off) is offered above it.
    clock = atMinutes('2026-11-03', 4 * 60 + 30);
    await remount();
    await render(<SessionHeader a={analysisAt(clock)} />);
    expect(button("I'm up")).toBeUndefined();
    await press('End session');
    expect(useStore.getState().settings.session).toMatchObject({ closed: 'up', upAt: clock });
    await render(<SessionHeader a={analysisAt(clock)} />);
    expect(text()).toContain('Up at 04:30');
    await press('Undo');
    expect(useStore.getState().settings.session?.closed).toBeUndefined();
  });

  it('Undo right after the tap puts the plan back', async () => {
    const lateNight = atMinutes(DAY, 23 * 60 + 42);
    clock = lateNight;
    await render(nightView(lateNight));
    await press("I'm in bed");
    await render(nightView(lateNight));
    await press('Undo');
    expect(useStore.getState().settings.session).toBeUndefined();
    expect(useStore.getState().wakeLog.inBed ?? []).not.toContain(lateNight);
  });
});

describe('in the morning', () => {
  const MORNING = atMinutes('2026-11-03', 7 * 60 + 30);

  it('"I\'m up" ends the session, with Undo', async () => {
    await startInBedSession(analysisAt(WINDING), WINDING);
    clock = MORNING;
    await render(<UpCard a={analysisAt(MORNING)} />);
    expect(text()).toContain('In bed since 22:45');
    expect(text()).toContain('8h 45m ago');
    await press("I'm up");
    expect(useStore.getState().settings.session).toMatchObject({ closed: 'up', upAt: MORNING });
    await render(<UpCard a={analysisAt(MORNING)} />);
    expect(text()).toContain('Up at 07:30 · in bed 8h 45m');
    await press('Undo');
    expect(useStore.getState().settings.session?.closed).toBeUndefined();
    // Gone once it's closed and the moment has passed.
    useStore.getState().setSettings({ session: closeInBed(useStore.getState().settings.session!, MORNING, 'up') });
    clock = MORNING + 5 * MINUTE;
    await remount();
    await render(<UpCard a={analysisAt(clock)} />);
    expect(text()).toBe('');
  });

  it('offers "Save last night from your taps" when the watch night is missing', async () => {
    const up = atMinutes('2026-11-03', 7 * 60 + 5);
    useStore.getState().setSettings({
      session: closeInBed({ inBedAt: atMinutes(DAY, 23 * 60 + 42), wakeDate: '2026-11-03', wakeAt: atMinutes('2026-11-03', 420), retimed: false }, up, 'up'),
    });
    clock = MORNING;
    const a = analysisAt(MORNING);
    expect(a.lastNightIsCurrent).toBe(false);
    await render(<TapsNightCard a={a} />);
    expect(text()).toContain('Last night from your taps');
    expect(text()).toContain('In bed 23:42 → up 07:05');
    await press('Save last night');
    const saved = useStore.getState().sessions.find((s) => s.id === `manual-${atMinutes(DAY, 23 * 60 + 42)}`);
    expect(saved).toMatchObject({ source: 'manual', start: atMinutes(DAY, 23 * 60 + 42), end: up });
    const after = analysisAt(MORNING);
    expect(after.lastNightIsCurrent).toBe(true);
    await render(<TapsNightCard a={after} />);
    expect(text()).toBe('');
  });
});
