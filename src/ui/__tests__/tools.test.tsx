/**
 * Render tests for the daytime tools on the demo data: the check-in (one tap stores a rating, a
 * second tap changes it, Undo takes it back; the rest stays reachable), the drink form (a new
 * drink at the chosen time, editing and deleting one, the usual drink) and the Nap screen (the
 * verdict, starting the recommended nap, the running timer and "I'm up").
 *
 * Then the one-tap sheets (eepy://quick/…) and the coach's screens — Coach, Experiments, Goals,
 * Weekly review, the insomnia programme and a questionnaire: what each opens with and its main
 * action.
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

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string | undefined> = {};
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
  useCanGoBack: () => true,
  Stack: { Screen: () => null },
  Redirect: (p: { href: string }) => {
    mockRedirect(p.href);
    return null;
  },
}));

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
import { Alert, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot, Root, TestInstance } from 'test-renderer';

import DrinkEditor from '../../app/caffeine';
import CbtiScreen from '../../app/cbti';
import CheckInScreen from '../../app/checkin';
import CoachScreen from '../../app/coach';
import ExperimentDetail from '../../app/experiments/[id]';
import ExperimentsScreen from '../../app/experiments/index';
import GoalsScreen from '../../app/goals';
import NapScreen from '../../app/nap';
import QuickActionScreen from '../../app/quick/[action]';
import QuizScreen from '../../app/quiz/[id]';
import ReviewScreen from '../../app/review';
import { analyze } from '../../engine/analysis';
import { usualCaffeine, usualDoseId } from '../../engine/caffeineHabits';
import { generateDemoData } from '../../engine/demo';
import { startCbtiProgram } from '../../engine/cbti';
import { rankTemplates, suggestionInput } from '../../engine/experiments';
import { GOAL_DEFS } from '../../engine/goals';
import { QUIZZES, scoreQuiz } from '../../engine/screening';
import { atMinutes, dateKey, formatTime, HOUR, MINUTE } from '../../engine/time';
import { analyzeOptionsFor } from '../../state/analysisOptions';
import { selectDataset, useStore } from '../../state/store';
import { CbtiCard } from '../cards/CbtiCard';
import { RecoveryAlertCard } from '../cards/CoachCards';
import { REVIEW_SEEN_MARK } from '../coach/hooks';
import { QuickCheckIn } from '../learning/QuickCheckIn';

// Friday, early afternoon.
const DAY = '2026-11-06';
const NOW = atMinutes(DAY, 14 * 60);
const prevOS = Platform.OS;
let root: Root;

beforeAll(async () => {
  await useStore.persist.rehydrate();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  (Platform as { OS: string }).OS = 'android';
  useStore.getState().loadDemo(NOW);
  useStore.getState().setProfile({ onboarded: true });
  useStore.getState().setSettings({ clock: '24h', napTimer: undefined, upcoming: undefined, session: undefined });
  useStore.setState({ experiments: [], goals: [], cbti: undefined });
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  (Platform as { OS: string }).OS = prevOS;
  jest.restoreAllMocks();
});

const state = () => useStore.getState();
const analysis = () => analyze(selectDataset(state()), NOW, analyzeOptionsFor(state(), { now: NOW }));
const render = async (el: React.ReactElement) => {
  await act(async () =>
    root.render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>{el}</SafeAreaProvider>),
  );
  await act(async () => undefined);
};
const text = () => JSON.stringify(root.container.toJSON());
const EVENT = { nativeEvent: {}, target: 1, currentTarget: 1, stopPropagation: () => undefined, preventDefault: () => undefined };
const click = async (n: TestInstance | null | undefined, what: string) => {
  while (n && typeof n.props.onClick !== 'function') n = n.parent;
  if (!n) throw new Error(`no button "${what}"`);
  const target = n;
  await act(async () => target.props.onClick(EVENT));
  await act(async () => undefined);
};
/** Taps the first button whose text contains `label`. */
const press = (label: string) => click(root.container.queryAll((i) => i.type === 'Text' && i.children.some((c) => typeof c === 'string' && c.includes(label)))[0], label);
/** Says yes to the next confirmation dialog. */
const confirmYes = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as { text: string; onPress?: () => void }[];
    buttons[buttons.length - 1].onPress?.();
  });
const rerender = async (el: React.ReactElement) => {
  await act(async () => root.unmount());
  root = createRoot();
  await render(el);
};
/** Taps the button with this accessibility label (the numbers of the scale, the time stepper). */
const pressLabelled = (label: string) => click(root.container.queryAll((i) => i.props.accessibilityLabel === label && typeof i.props.onClick === 'function')[0], label);

describe('the demo data', () => {
  it('has what these screens need: nights, drinks and a usual drink', () => {
    const demo = generateDemoData(NOW);
    expect(demo.sessions.length).toBeGreaterThan(7);
    expect(demo.caffeine.length).toBeGreaterThan(0);
    expect(state().caffeine.length).toBe(demo.caffeine.length);
  });
});

describe('Check-in', () => {
  it('opens with the question, the three quick answers and the 1–9 scale; the rest is rows below', async () => {
    await render(<CheckInScreen />);
    const s = text();
    expect(s).toContain('How alert are you right now?');
    for (const word of ['Alert', 'OK', 'Sleepy']) expect(s).toContain(`"${word}"`);
    for (let n = 1; n <= 9; n++) expect(root.container.queryAll((i) => typeof i.props.accessibilityLabel === 'string' && i.props.accessibilityLabel.startsWith(`${n}: `)).length).toBe(1);
    for (const row of ['Coffee', 'Energy today', 'A nap you took', 'Tags for today', 'Reaction test', 'One minute, objective', 'Journal', 'Log sleep']) expect(s).toContain(row);
    // Folded until asked for.
    expect(s).not.toContain('Exhausted');
  });

  it('one tap stores the rating; another answer replaces it; Undo takes it back', async () => {
    const before = state().checkins.length;
    await render(<CheckInScreen />);
    await press('Sleepy');
    expect(state().checkins.length).toBe(before + 1);
    const saved = state().checkins.find((c) => c.time === NOW)!;
    expect(saved).toMatchObject({ kss: 7, source: 'manual' });
    expect(text()).toContain('Saved. Tap another answer to change it.');
    expect(text()).toContain('7 of 9 · Sleepy, no effort to stay awake');

    // The full scale, straight under the quick answers: changing your mind is not a second rating.
    await pressLabelled('4: Rather alert');
    expect(state().checkins.length).toBe(before + 1);
    expect(state().checkins.find((c) => c.id === saved.id)!.kss).toBe(4);
    expect(text()).toContain('4 of 9 · Rather alert');

    await press('Undo');
    expect(state().checkins.length).toBe(before);
    expect(text()).not.toContain('Saved. Tap another answer');
  });

  it('logs a coffee, the energy of the day and a tag from the rows below, each with Undo', async () => {
    const doses = state().caffeine.length;
    await render(<CheckInScreen />);

    await press('Coffee');
    await press('30 min ago');
    await press('Espresso');
    expect(state().caffeine.length).toBe(doses + 1);
    const dose = state().caffeine.find((d) => d.time === NOW - 30 * MINUTE && d.label.startsWith('Espresso'))!;
    expect(dose).toBeDefined();
    expect(text()).toContain(`at ${formatTime(dose.time)}`);
    await press('Undo');
    expect(state().caffeine.length).toBe(doses);

    await press('Energy today');
    await press('Good');
    expect(state().dayLogs[DAY].energy).toBe(4);

    await press('Tags for today');
    const had = state().dayLogs[DAY]?.tags.includes('stress') ?? false;
    await press('Stress');
    expect(state().dayLogs[DAY].tags.includes('stress')).toBe(!had);
  });

  it('opens the reaction test, and Done goes back', async () => {
    await render(<CheckInScreen />);
    await press('Reaction test');
    expect(mockRouter.replace).toHaveBeenCalledWith('/reaction');
    await press('Done');
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Drink', () => {
  it('logs a drink now with one button', async () => {
    const doses = state().caffeine.length;
    await render(<DrinkEditor />);
    expect(text()).toContain('What');
    expect(text()).toContain('When');
    // The time controls stay out of the way until you say it was earlier.
    expect(text()).not.toContain('1 h ago');
    await press('Log it');
    expect(state().caffeine.length).toBe(doses + 1);
    expect(state().caffeine.some((d) => d.time === NOW)).toBe(true);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('stores the drink you picked at the time you chose', async () => {
    await render(<DrinkEditor />);
    await press('Black tea');
    await press('Earlier');
    await press('1 h ago');
    await pressLabelled('Five minutes earlier');
    await pressLabelled('One hour earlier');
    expect(text()).toContain(formatTime(NOW - 2 * HOUR - 5 * MINUTE));
    // What it does to tonight, in one line.
    expect(text()).toContain('still active at lights-out');
    await press('Log it');
    const dose = state().caffeine.find((d) => d.time === NOW - 2 * HOUR - 5 * MINUTE)!;
    expect(dose.label).toContain('Black tea');
    // Never in the future.
    expect(state().caffeine.every((d) => d.time <= NOW)).toBe(true);
  });

  it('your own drinks come first and are saved from the form', async () => {
    state().setSettings({ customDrinks: [{ label: 'Mate', mg: 80 }] });
    await render(<DrinkEditor />);
    const s = text();
    expect(s.indexOf('Mate · 80')).toBeGreaterThan(-1);
    expect(s.indexOf('Mate · 80')).toBeLessThan(s.indexOf('Espresso'));
    await press('Mate · 80');
    await press('Log it');
    expect(state().caffeine.find((d) => d.time === NOW)).toMatchObject({ label: 'Mate', mg: 80 });
  });

  it('edits the time of a drink already logged, and deletes it', async () => {
    state().addCaffeine({ id: 'c-test', time: NOW - 3 * HOUR, mg: 95, label: 'Coffee (8 oz / 240 ml)' });
    mockParams = { id: 'c-test' };
    await render(<DrinkEditor />);
    expect(text()).toContain(`Was ${formatTime(NOW - 3 * HOUR)}`);
    await pressLabelled('One hour later');
    await press('Save');
    expect(state().caffeine.find((d) => d.id === 'c-test')!.time).toBe(NOW - 2 * HOUR);

    await act(async () => root.unmount());
    root = createRoot();
    await render(<DrinkEditor />);
    await press('Delete');
    expect(state().caffeine.some((d) => d.id === 'c-test')).toBe(false);
  });

  it('the usual drink starts at its usual time and gets the per-day id', async () => {
    // No drink yet today, so the usual one is still to log.
    useStore.setState({ caffeine: state().caffeine.filter((d) => dateKey(d.time) !== DAY) });
    const usual = usualCaffeine(state().caffeine, NOW)!;
    expect(usual).toBeDefined();
    mockParams = { usual: '1' };
    await render(<DrinkEditor />);
    expect(text()).toContain(formatTime(atMinutes(DAY, usual.timeMin)));
    await press('Log it');
    expect(state().caffeine.find((d) => d.id === usualDoseId(DAY))).toMatchObject({ label: usual.label, mg: usual.mg, time: atMinutes(DAY, usual.timeMin) });
  });

  it('says so when the drink to edit is gone', async () => {
    mockParams = { id: 'nope' };
    await render(<DrinkEditor />);
    expect(text()).toContain('Drink not found');
  });
});

describe('Nap', () => {
  it('opens with the verdict and its reason, then the naps with what they gain and cost', async () => {
    const nap = analysis().nap;
    await render(<NapScreen />);
    const s = text();
    expect(s).toContain('Should you nap?');
    expect(s).toContain(nap.verdict === 'nap-now' ? 'Nap now' : nap.verdict === 'nap-later' ? 'Nap at ' : nap.verdict === 'optional' ? 'Up to you' : 'Skip it');
    for (const o of nap.options) if (!(nap.verdict !== 'skip' && nap.best?.suitable && o.type === nap.best.type)) expect(s).toContain(`${o.label} · ${o.alarmAfterMin} min`);
    expect(s).toContain('Energy ');
    // Logging a nap you already took, and the explanation folded away.
    expect(s).toContain('Took a nap?');
    expect(s).toContain('How eepy decides');
    expect(s).not.toContain('Nap need combines');
    await press('How eepy decides');
    expect(text()).toContain('Nap need combines');
  });

  it('starts the recommended nap: the timer takes over the top, and "I\'m up" logs it', async () => {
    // Something demanding later makes a nap the advice whatever the demo night was like.
    state().setSettings({ upcoming: { kind: 'long-drive', date: DAY } });
    const nap = analysis().nap;
    expect(nap.verdict).not.toBe('skip');
    const best = nap.best!;
    expect(best.suitable).toBe(true);
    const sessions = state().sessions.length;

    await render(<NapScreen />);
    expect(text()).toContain('Long drive');
    await press(`Start ${best.alarmAfterMin}-min nap`);
    await act(async () => undefined);

    const timer = state().settings.napTimer!;
    expect(timer).toMatchObject({ start: NOW, alarmAt: NOW + best.alarmAfterMin * MINUTE, label: best.label });
    expect(mockNative.scheduleAlarm).toHaveBeenCalled();
    const s = text();
    expect(s).toContain(`Alarm at ${formatTime(timer.alarmAt)}`);
    expect(s).toContain("I'm up");
    // No second nap can be started while one runs.
    expect(s).not.toContain('Should you nap?');
    expect(s).not.toContain(`Start ${best.alarmAfterMin}-min nap`);

    jest.spyOn(Date, 'now').mockReturnValue(NOW + 10 * MINUTE);
    await press("I'm up");
    await act(async () => undefined);
    expect(state().settings.napTimer).toBeUndefined();
    expect(state().sessions.length).toBe(sessions + 1);
    expect(state().sessions.find((x) => x.id === `nap-${NOW}`)).toMatchObject({ kind: 'nap', start: NOW, end: NOW + 10 * MINUTE });
  });

  it('cancelling a nap logs nothing', async () => {
    state().setSettings({ upcoming: { kind: 'long-drive', date: DAY } });
    const best = analysis().nap.best!;
    const sessions = state().sessions.length;
    await render(<NapScreen />);
    await press(`Start ${best.alarmAfterMin}-min nap`);
    await act(async () => undefined);
    expect(state().settings.napTimer).toBeDefined();
    await press('Cancel without logging');
    await act(async () => undefined);
    expect(state().settings.napTimer).toBeUndefined();
    expect(state().sessions.length).toBe(sessions);
    expect(text()).toContain('Should you nap?');
  });

  it('a sleepiness rating and a demand later today are one tap each, under their rows', async () => {
    await render(<NapScreen />);
    await press('How sleepy are you?');
    await pressLabelled('8: Sleepy, some effort to stay awake');
    expect(state().dayLogs[DAY]).toMatchObject({ sleepiness: 8, sleepinessAt: NOW });
    await press('Anything demanding later?');
    await press('Night shift');
    expect(state().settings.upcoming).toEqual({ kind: 'night-shift', date: DAY });
    await press('Nothing special');
    expect(state().settings.upcoming).toBeUndefined();
  });
});

describe('Quick sheets', () => {
  it('coffee logs the usual drink once, with Undo', async () => {
    useStore.setState({ caffeine: state().caffeine.filter((d) => dateKey(d.time) !== DAY) });
    const usual = usualCaffeine(state().caffeine, NOW)!;
    const doses = state().caffeine.length;
    mockParams = { action: 'coffee' };
    await render(<QuickActionScreen />);
    expect(state().caffeine.length).toBe(doses + 1);
    expect(state().caffeine.find((d) => d.id === usualDoseId(DAY))).toMatchObject({ mg: usual.mg, label: usual.label });
    expect(text()).toContain('logged');
    expect(text()).toContain('Change time');
    await press('Undo');
    expect(state().caffeine.length).toBe(doses);
    expect(text()).toContain('Nothing was logged.');

    // A second tap on the shortcut the same day offers another one instead of logging twice.
    await act(async () => root.unmount());
    state().addCaffeine({ id: usualDoseId(DAY), time: atMinutes(DAY, usual.timeMin), mg: usual.mg, label: usual.label });
    root = createRoot();
    await render(<QuickActionScreen />);
    expect(state().caffeine.length).toBe(doses + 1);
    expect(text()).toContain('Already logged today');
    await press('Log another now');
    expect(state().caffeine.length).toBe(doses + 2);
  });

  it('nap offers the recommended nap and starts it', async () => {
    state().setSettings({ upcoming: { kind: 'long-drive', date: DAY } });
    const best = analysis().nap.best!;
    mockParams = { action: 'nap' };
    await render(<QuickActionScreen />);
    expect(text()).toContain(`Start a ${best.alarmAfterMin}-min nap?`);
    await press('Start nap');
    await act(async () => undefined);
    expect(state().settings.napTimer).toMatchObject({ start: NOW, label: best.label });
    expect(mockRouter.replace).toHaveBeenCalledWith('/nap');
  });

  it('check-in, running late and unknown actions hand over to their screens', async () => {
    for (const [action, href] of [
      ['checkin', '/checkin'],
      ['late', '/tonight'],
      ['whatever', '/'],
    ]) {
      mockParams = { action };
      await rerender(<QuickActionScreen />);
      expect(mockRedirect).toHaveBeenLastCalledWith(href);
    }
  });
});

describe('Coach', () => {
  const suggestions = () => rankTemplates(suggestionInput(analysis(), state(), state().experiments));

  it('opens with the experiment worth starting, then goals, the week and what to try next', async () => {
    const top = suggestions()[0];
    await render(<CoachScreen />);
    const s = text();
    expect(s).toContain('Worth trying this week');
    expect(s).toContain(top.template.title);
    for (const caption of ['Goals today', 'This week', 'More to try']) expect(s).toContain(caption);
    expect(s).toContain('Pick up to three goals');
    await press('Set it up');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/experiments', params: { template: top.template.id } });
    await press('All tools');
    expect(mockRouter.navigate).toHaveBeenCalledWith('/more');
  });

  it('an experiment is set up from its row, runs as the opening of Coach and Experiments, and can be stopped', async () => {
    const top = suggestions()[1];
    mockParams = { template: top.template.id };
    await render(<ExperimentsScreen />);
    expect(text()).toContain('Change one thing');
    // The linked experiment is open, with its one button.
    expect(text()).toContain(top.template.why);
    await press('Start tonight');
    const exp = state().experiments[0];
    expect(exp).toMatchObject({ templateId: top.template.id, status: 'active', startDate: DAY });
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/experiments/[id]', params: { id: exp.id } });

    mockParams = {};
    await rerender(<CoachScreen />);
    expect(text()).toContain(`Day 1 of ${exp.durationDays}`);
    expect(text()).toContain('Up next');
    await rerender(<ExperimentsScreen />);
    expect(text()).toContain(`Day 1 of ${exp.durationDays}`);
    expect(text()).not.toContain('Change one thing');

    mockParams = { id: exp.id };
    await rerender(<ExperimentDetail />);
    const s = text();
    expect(s).toContain(`Day 1 of ${exp.durationDays}`);
    for (const caption of ['Day by day', 'Before and after, so far', 'This experiment']) expect(s).toContain(caption);
    confirmYes();
    await press('Stop experiment');
    await act(async () => undefined);
    expect(state().experiments[0].status).toBe('abandoned');
    expect(text()).toContain('Run it again');
    await press('Delete');
    await act(async () => undefined);
    expect(state().experiments.length).toBe(0);
  });

  it('goals are switched on from the list, then open with today', async () => {
    await render(<GoalsScreen />);
    expect(text()).toContain('Pick up to 3');
    await press(GOAL_DEFS[0].title);
    await press(GOAL_DEFS[1].title);
    expect(state().goals.filter((g) => g.enabled).map((g) => g.id)).toEqual([GOAL_DEFS[0].id, GOAL_DEFS[1].id]);
    const s = text();
    expect(s).toContain('Done today');
    expect(s).toContain('of 2');
    expect(s).toContain('Your goals');
    // Each goal opens to its streak and its setting.
    const row = root.container.queryAll((i) => i.type === 'Text' && i.children.some((c) => typeof c === 'string' && c === GOAL_DEFS[0].title))[0];
    await click(row, GOAL_DEFS[0].title);
    expect(text()).toContain('Last 7 days');
    expect(text()).toContain(GOAL_DEFS[0].param!.label);
  });

  it('the weekly review opens with the average sleep, marks the week as seen and steps back a week', async () => {
    await render(<ReviewScreen />);
    const s = text();
    expect(s).toContain('Average sleep');
    expect(s).toContain('Latest week');
    for (const caption of ['Focus for next week', 'Night by night']) expect(s).toContain(caption);
    expect(state().settings.marks[REVIEW_SEEN_MARK]).toBeDefined();
    await pressLabelled('Previous week');
    expect(text()).toContain('1 week ago');
    expect(text()).not.toContain('Latest week');
  });

  it('the insomnia programme starts from its window, then opens with this week and tonight', async () => {
    await render(<CbtiScreen />);
    expect(text()).toContain('Your starting window');
    expect(text()).toContain('Safety check');
    confirmYes();
    await press('Start tonight');
    await act(async () => undefined);
    expect(state().cbti).toMatchObject({ active: true, startedAt: DAY });
    const s = text();
    expect(s).toContain('Week 1 of 6');
    expect(s).toContain("Tonight's rules · 0 of ");
    // Ticking a rule is remembered for the day.
    const rule = root.container.queryAll((i) => i.props.accessibilityRole === 'checkbox' && typeof i.props.onClick === 'function')[0];
    await click(rule, 'first rule');
    expect(text()).toContain("Tonight's rules · 1 of ");
    expect(state().settings.marks['cbti-rules']).toBe(`${DAY}:1`);
    await press('Stop the programme');
    await act(async () => undefined);
    expect(state().cbti).toMatchObject({ active: false, stoppedAt: DAY });
    expect(text()).toContain('Your starting window');
  });

  it('a questionnaire asks one question at a time and saves the score', async () => {
    const quiz = QUIZZES.rmeq;
    mockParams = { id: 'rmeq' };
    await render(<QuizScreen />);
    const answers: number[] = [];
    for (let i = 0; i < quiz.questions.length; i++) {
      expect(text()).toContain(quiz.questions[i].text);
      const option = quiz.questions[i].options[0];
      answers.push(option.value);
      const rows = root.container.queryAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityState?.selected === 'boolean' && typeof n.props.onClick === 'function');
      expect(rows.length).toBe(quiz.questions[i].options.length);
      await click(rows[0], option.label);
    }
    const { score } = scoreQuiz('rmeq', answers);
    expect(text()).toContain('Your score');
    expect(state().profile.screenings.rmeq).toMatchObject({ score, answers });
    await press('Done');
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Panels shown on other screens', () => {
  it('the compact check-in (Energy) saves on the tap and can be undone', async () => {
    const before = state().checkins.length;
    await render(<QuickCheckIn />);
    expect(text()).toContain('How alert are you right now?');
    await press('OK');
    expect(state().checkins.length).toBe(before + 1);
    expect(state().checkins.find((c) => c.time === NOW)).toMatchObject({ kss: 5, source: 'manual' });
    expect(text()).toContain('neither alert nor sleepy');
    await press('Undo');
    expect(state().checkins.length).toBe(before);
    // The full scale is one tap away.
    await press('1–9 scale');
    expect(mockRouter.push).toHaveBeenCalledWith('/checkin');
  });

  it('the recovery alert lists each signal as a row and folds the advice', async () => {
    const a = {
      ...analysis(),
      recoveryAlert: {
        level: 'warning' as const,
        title: 'Your body is working harder than usual',
        detail: 'Two of three recovery signals have been off for three nights.',
        nights: [DAY],
        signals: [
          { key: 'hr' as const, label: 'Sleeping heart rate', baseline: 52.4, recent: 58, delta: 6, change: '+6 bpm', nightsOff: 3, nightsChecked: 3, off: true },
          { key: 'resp' as const, label: 'Breathing rate', baseline: 14.2, recent: 14.4, delta: 0.2, change: '+0.2/min', nightsOff: 0, nightsChecked: 3, off: false },
        ],
        advice: ['Take today easy.', 'Go to bed a little earlier.'],
      },
    };
    await render(<RecoveryAlertCard analysis={a} />);
    const s = text();
    for (const part of ['Your body is working harder than usual', 'Take it easy', 'Sleeping heart rate', '+6 bpm', 'Usually 52 bpm', 'Usually 14.2 / min', 'What helps']) expect(s).toContain(part);
    expect(s).not.toContain('Take today easy.');
    await press('What helps');
    expect(text()).toContain('Take today easy.');
  });

  it('the insomnia programme is one row on Today, and only when it applies', async () => {
    const a = analysis();
    await render(<CbtiCard analysis={a} />);
    expect(text()).not.toContain('Insomnia programme');
    await act(async () => state().setCbti(startCbtiProgram({ nights: a.nights, today: a.day, wakeMin: 7 * 60 })));
    expect(text()).toContain('Insomnia programme · week 1');
    expect(text()).toContain('In bed ');
    await press('Insomnia programme');
    expect(mockRouter.push).toHaveBeenCalledWith('/cbti');
  });
});
