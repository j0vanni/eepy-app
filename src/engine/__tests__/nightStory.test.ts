import { analyze } from '../analysis';
import { caffeineAt } from '../caffeine';
import { generateDemoData } from '../demo';
import type { Insight } from '../insights';
import { buildNightStory, formatTimeRange, NightStory, NightStoryInput } from '../nightStory';
import { analyzeSessions, buildNights, SessionMetrics } from '../sessions';
import { addDays, atMinutes, MINUTE, setClockFormat } from '../time';
import type { BreathingSummary, CaffeineDose, DayLog, NightVitals, SleepSession, Stage, StageSegment, Workout } from '../types';
import { night, profile } from './helpers';

const WAKE = '2026-10-15';
const EVE = addDays(WAKE, -1);

/** A night built from a stage plan (minutes), starting `latencyMin` before onset. */
function planned(evening: string, plan: [Stage, number][], opts: { onsetMin?: number; latencyMin?: number; id?: string } = {}): SleepSession {
  const onset = atMinutes(evening, opts.onsetMin ?? 23 * 60);
  const start = onset - (opts.latencyMin ?? 10) * MINUTE;
  const stages: StageSegment[] = [{ stage: 'awake', start, end: onset }];
  let t = onset;
  for (const [stage, min] of plan) {
    stages.push({ stage, start: t, end: t + min * MINUTE });
    t += min * MINUTE;
  }
  return { id: opts.id ?? `n-${evening}`, source: 'manual', start, end: t, stages };
}

/** Replaces part of a night with wakefulness at a clock time on the wake date. */
function awakeAt(s: SleepSession, date: string, clockMin: number, durMin: number): SleepSession {
  const a = atMinutes(date, clockMin);
  const b = a + durMin * MINUTE;
  const stages: StageSegment[] = [];
  for (const seg of s.stages) {
    if (seg.end <= a || seg.start >= b) {
      stages.push(seg);
      continue;
    }
    if (seg.start < a) stages.push({ ...seg, end: a });
    if (seg.end > b) stages.push({ ...seg, start: b });
  }
  stages.push({ stage: 'awake', start: a, end: b });
  return { ...s, stages: stages.sort((x, y) => x.start - y.start) };
}

/** Typical vitals: low point 52 bpm early in the night, flat 10-minute curve at 55. */
function vitalsFor(s: SleepSession, over: Partial<NightVitals> = {}): NightVitals {
  const curve: [number, number][] = [];
  for (let off = 0; off < (s.end - s.start) / MINUTE; off += 10) curve.push([off, 55]);
  return { sessionId: s.id, hrMin: 52, hrAvg: 56, hrNadirOffsetMin: 140, hrvRmssd: 50, hrCurve: curve, ...over };
}

interface Scenario {
  target: SleepSession;
  vitals?: Partial<NightVitals> | null;
  dayLogs?: Record<string, DayLog>;
  caffeine?: CaffeineDose[];
  workouts?: Workout[];
  insights?: Insight[];
  extra?: SleepSession[];
  baselineNights?: number;
}

function story(sc: Scenario): { s: NightStory | undefined; m: SessionMetrics } {
  const sessions: SleepSession[] = [];
  const vitals: Record<string, NightVitals> = {};
  for (let i = sc.baselineNights ?? 14; i >= 1; i--) {
    const wake = addDays(WAKE, -i);
    const n = night(addDays(wake, -1), 23 * 60, 7.5);
    sessions.push(n);
    vitals[n.id] = vitalsFor(n);
  }
  sessions.push(sc.target, ...(sc.extra ?? []));
  if (sc.vitals !== null) vitals[sc.target.id] = vitalsFor(sc.target, sc.vitals ?? {});
  const nights = buildNights(analyzeSessions(sessions));
  const m = nights.find((n) => n.wakeDate === WAKE)!.main!;
  const input: NightStoryInput = {
    night: m,
    nights,
    vitals,
    dayLogs: { [EVE]: { date: EVE, tags: [] }, ...sc.dayLogs },
    caffeine: sc.caffeine ?? [],
    profile: profile(),
    workouts: sc.workouts,
    insights: sc.insights,
  };
  return { s: buildNightStory(input), m };
}

const topic = (s: NightStory, t: string) => s.sentences.find((x) => x.topic === t);
const textOf = (s: NightStory, t: string) => topic(s, t)?.parts.map((p) => p.text).join('');
const tags = (...t: string[]) => ({ [EVE]: { date: EVE, tags: t } });

afterEach(() => setClockFormat('24h'));

describe('night story', () => {
  it('a typical night reads as typical, with no factors', () => {
    const { s } = story({ target: night(EVE, 23 * 60, 7.5) });
    expect(s!.deviations).toEqual([]);
    expect(s!.factors).toEqual([]);
    expect(s!.oneLiner).toBe('A typical night for you — asleep in 10 min.');
    expect(textOf(s!, 'onset')).toBe('Asleep in 10 min, about your usual.');
    expect(textOf(s!, 'deep')).toBe('Deep sleep came early (1h 12m, your normal).');
    expect(textOf(s!, 'rem')).toBe('REM was in your normal range (22%).');
    expect(textOf(s!, 'awake')).toBe('You slept through without waking.');
    expect(textOf(s!, 'heart')).toMatch(/^Heart rate bottomed out at 52 bpm around 01:20 — early in the night/);
    expect(s!.baselineNights).toBe(14);
    // Numbers are marked for bold.
    expect(topic(s!, 'onset')!.parts.find((p) => p.strong)!.text).toBe('10 min');
  });

  it('a short, restless night after alcohol: awakenings with times, HR rise, short REM, alcohol as the likely factor', () => {
    setClockFormat('12h');
    // Same structure as usual but REM periods cut to 4 min and two awakenings.
    const plan: [Stage, number][] = [];
    for (let k = 0; k < 8; k++) plan.push(['light', 35], ['deep', Math.max(0, 30 - 8 * k)], ['light', 15], ['rem', 4]);
    let target = planned(EVE, plan.slice(0, 22));
    target = awakeAt(target, WAKE, 3 * 60 + 10, 14);
    target = awakeAt(target, WAKE, 5 * 60, 6);
    const curve: [number, number][] = [];
    for (let off = 0; off < (target.end - target.start) / MINUTE; off += 10) {
      const t = target.start + off * MINUTE;
      const nearFirst = t + 10 * MINUTE > atMinutes(WAKE, 3 * 60 + 5) && t < atMinutes(WAKE, 3 * 60 + 29);
      curve.push([off, nearFirst ? 68 : 58]);
    }
    const { s } = story({ target, vitals: { hrMin: 57, hrCurve: curve, hrNadirOffsetMin: 330 }, dayLogs: tags('alcohol') });
    expect(s!.deviations).toEqual(expect.arrayContaining(['wasoUp', 'remDown', 'hrUp', 'lateNadir', 'tstDown']));
    expect(textOf(s!, 'awake')).toBe(
      'You were awake 3:10–3:24\u00A0AM and 5:00–5:06\u00A0AM; your heart rate rose during the first. In all, 20m awake during the night — usually you barely wake at all.',
    );
    expect(textOf(s!, 'rem')).toMatch(/^REM was short \(\d+% vs your usual 22%\) — most REM comes late in the night/);
    expect(textOf(s!, 'heart')).toMatch(/5 bpm above your usual — late in the night/);
    const alcohol = s!.factors.find((f) => f.id === 'tag:alcohol')!;
    expect(alcohol.role).toBe('likely');
    expect(alcohol.explains).toEqual(expect.arrayContaining(['remDown', 'wasoUp', 'hrUp', 'lateNadir']));
    expect(textOf(s!, 'factors')).toBe('Likely factor: drinking alcohol.');
    expect(topic(s!, 'factors')!.parts.find((p) => p.factor)!.factor).toBe('tag:alcohol');
    expect(s!.oneLiner).toMatch(/^Restless \(20m awake\) and REM short \(\d+% vs 22%\) — likely drinking alcohol\.$/);
  });

  it('caffeine still active at lights-out explains a slow start', () => {
    const caffeine: CaffeineDose[] = [{ id: 'c', time: atMinutes(EVE, 18 * 60), mg: 150, label: 'Coffee' }];
    const target = night(EVE, 23 * 60, 7.5, { latencyMin: 40 });
    const { s, m } = story({ target, caffeine });
    const mg = caffeineAt(caffeine, m.start, 5);
    const rounded = Math.round(mg / 5) * 5;
    expect(rounded).toBeGreaterThanOrEqual(80);
    expect(textOf(s!, 'onset')).toBe('It took 40 min to fall asleep — longer than your usual 10 min.');
    const f = s!.factors.find((x) => x.id === 'caffeine')!;
    expect(f).toMatchObject({ role: 'likely', label: `~${rounded} mg of caffeine still active at lights-out`, explains: ['latencyUp'], date: EVE });
    expect(s!.oneLiner).toBe('Slow to fall asleep (40 min) — likely late caffeine.');
  });

  it('quotes the personal effect from insights when it matches tonight', () => {
    const plan: [Stage, number][] = [];
    for (let k = 0; k < 8; k++) plan.push(['light', 40], ['deep', Math.max(0, 30 - 8 * k)], ['light', 15], ['rem', 5]);
    const insights: Insight[] = [
      {
        id: 'tag:alcohol',
        kind: 'negative',
        category: 'habit',
        title: 'After drinking alcohol, your REM sleep is 5 percentage points lower',
        detail: '',
        strength: 0.5,
        effect: { metric: 'rem', label: 'REM sleep', diff: -0.05, amount: '5 percentage points', better: false, p: 0.03 },
      },
    ];
    const { s } = story({ target: planned(EVE, plan.slice(0, 21)), dayLogs: tags('alcohol'), insights });
    expect(s!.factors[0]).toMatchObject({ id: 'tag:alcohol', role: 'likely' });
    expect(textOf(s!, 'personal')).toBe('On nights after drinking alcohol, your REM sleep is usually 5 percentage points lower.');
  });

  it('never blames a tag whose effects did not show up — it is only "also logged"', () => {
    const { s } = story({ target: night(EVE, 23 * 60, 7.5), dayLogs: tags('alcohol', 'late-meal') });
    expect(s!.factors.map((f) => f.role)).toEqual(['noted', 'noted']);
    expect(textOf(s!, 'factors')).toBeUndefined();
    expect(textOf(s!, 'noted')).toBe('Also logged, with no obvious effect tonight: drinking alcohol and a late meal.');
    expect(s!.oneLiner).toBe('A typical night for you — asleep in 10 min.');
  });

  it('a helpful habit is credited when the night shows it, and a weak correlation never blames it', () => {
    const quick = story({ target: night(EVE, 23 * 60, 7.5, { latencyMin: 3 }), dayLogs: tags('reading') }).s!;
    expect(quick.factors[0]).toMatchObject({ id: 'tag:reading', role: 'helped', explains: ['latencyDown'] });
    expect(textOf(quick, 'helped')).toBe('Probably helped: reading before bed.');

    const weak: Insight = {
      id: 'tag:reading',
      kind: 'negative',
      category: 'habit',
      title: '',
      detail: '',
      strength: 0.2,
      effect: { metric: 'hrv', label: 'overnight HRV', diff: -4, amount: '4 ms', better: false, p: 0.2 },
    };
    const lowHrv = story({ target: night(EVE, 23 * 60, 7.5), vitals: { hrvRmssd: 35 }, dayLogs: tags('reading'), insights: [weak] }).s!;
    expect(lowHrv.deviations).toContain('hrvDown');
    expect(lowHrv.factors.find((f) => f.role === 'likely')).toBeUndefined();
    // Not even with strong personal evidence: a usually-helpful habit is never blamed.
    const strong = story({ target: night(EVE, 23 * 60, 7.5), vitals: { hrvRmssd: 35 }, dayLogs: tags('reading'), insights: [{ ...weak, effect: { ...weak.effect!, p: 0.001 } }] }).s!;
    expect(strong.factors.find((f) => f.role === 'likely')).toBeUndefined();
  });

  it('a late watch workout is named (and replaces the matching tag); a nap before bed too', () => {
    const target = night(EVE, 23 * 60, 7.5, { latencyMin: 35 });
    const onset = atMinutes(EVE, 23 * 60);
    const workouts: Workout[] = [{ id: 'w', start: onset - 100 * MINUTE, end: onset - 60 * MINUTE, type: 56 }];
    const nap: SleepSession = {
      id: 'nap',
      source: 'manual',
      kind: 'nap',
      start: atMinutes(EVE, 16 * 60 + 30),
      end: atMinutes(EVE, 17 * 60 + 15),
      stages: [{ stage: 'light', start: atMinutes(EVE, 16 * 60 + 30), end: atMinutes(EVE, 17 * 60 + 15) }],
    };
    const { s } = story({ target, workouts, extra: [nap], dayLogs: tags('late-exercise') });
    const ids = s!.factors.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['workout', 'nap']));
    expect(ids).not.toContain('tag:late-exercise');
    expect(s!.factors.find((f) => f.id === 'workout')!.label).toBe('a running workout ending 1h 00m before you fell asleep');
    expect(s!.factors.find((f) => f.id === 'nap')!.label).toBe('a 45m nap ending at 17:15');
    // "an 18m nap", "an elliptical workout".
    const short = { ...nap, id: 'nap18', end: atMinutes(EVE, 16 * 60 + 48), stages: [{ stage: 'light' as Stage, start: nap.start, end: atMinutes(EVE, 16 * 60 + 48) }] };
    const s2 = story({ target, workouts: [{ ...workouts[0], type: 25 }], extra: [short] }).s!;
    expect(s2.factors.find((f) => f.id === 'nap')!.label).toBe('an 18m nap ending at 16:48');
    expect(s2.factors.find((f) => f.id === 'workout')!.label).toMatch(/^an elliptical workout/);
  });

  it('caps the likely factors at three', () => {
    const target = awakeAt(night(EVE, 23 * 60, 7.5, { latencyMin: 45 }), WAKE, 3 * 60, 30);
    const { s } = story({ target, vitals: { hrMin: 58 }, dayLogs: tags('stress', 'late-meal', 'noise', 'nicotine', 'shared-bed') });
    expect(s!.factors.filter((f) => f.role === 'likely')).toHaveLength(3);
    expect(textOf(s!, 'factors')).toMatch(/^Likely factors: .+, .+ and .+\.$/);
  });

  it('a later bedtime that cost sleep is a factor', () => {
    const target = night(EVE, 24 * 60 + 40, 5.8);
    const { s } = story({ target });
    expect(s!.deviations).toEqual(expect.arrayContaining(['lateOnset', 'tstDown']));
    expect(textOf(s!, 'timing')).toBe('You fell asleep at 00:40, 1h 40m later than usual.');
    expect(s!.factors[0]).toMatchObject({ id: 'bedtime', role: 'likely', label: 'the later bedtime' });
    expect(s!.oneLiner).toMatch(/— likely a late bedtime\.$/);
  });

  it('mentions frequent oxygen dips', () => {
    const breathing: BreathingSummary = { n: 210, sleepMin: 450, coveredMin: 440, dips3: 130, dips4: 60, lowest: 84, avg: 94, below90: 10, glitches: 0 };
    const { s } = story({ target: night(EVE, 23 * 60, 7.5), vitals: { breathing } });
    expect(textOf(s!, 'breathing')).toMatch(/^Your watch saw 18 oxygen dips an hour — more than is typical/);
  });

  it('missing data: first nights, no vitals, unstaged sleep', () => {
    const { s } = story({ target: night(EVE, 23 * 60, 7, { staged: false }), vitals: null, baselineNights: 2 });
    expect(textOf(s!, 'duration')).toBe('7h 00m asleep.');
    expect(topic(s!, 'deep')).toBeUndefined();
    expect(topic(s!, 'rem')).toBeUndefined();
    expect(topic(s!, 'heart')).toBeUndefined();
    expect(textOf(s!, 'stages')).toMatch(/no stage data/);
    expect(textOf(s!, 'baseline')).toBe("eepy needs 3 more nights to know what's usual for you.");
    expect(s!.oneLiner).toBe('7h 00m asleep, asleep in 10 min.');
    expect(s!.staged).toBe(false);
  });

  it('naps get no story; nothing logged that evening is pointed out when the night was off', () => {
    const nap: SleepSession = { ...night(WAKE, 14 * 60, 0.4, { id: 'nap2', kind: 'nap' }) };
    const nights = buildNights(analyzeSessions([nap]));
    expect(buildNightStory({ night: nights[0].naps[0] ?? nights[0].main!, nights, vitals: {}, dayLogs: {}, caffeine: [], profile: profile() })).toBeUndefined();

    const sessions: SleepSession[] = [];
    for (let i = 14; i >= 1; i--) sessions.push(night(addDays(addDays(WAKE, -i), -1), 23 * 60, 7.5));
    sessions.push(night(EVE, 23 * 60, 7.5, { latencyMin: 50 }));
    const all = buildNights(analyzeSessions(sessions));
    const s = buildNightStory({ night: all[all.length - 1].main!, nights: all, vitals: {}, dayLogs: {}, caffeine: [], profile: profile() })!;
    expect(textOf(s, 'hint')).toMatch(/Nothing was logged for that evening/);
  });

  it('formats awake ranges for both clock styles', () => {
    const a = atMinutes(WAKE, 3 * 60 + 10);
    const b = atMinutes(WAKE, 3 * 60 + 24);
    expect(formatTimeRange(a, b)).toBe('03:10–03:24');
    setClockFormat('12h');
    expect(formatTimeRange(a, b)).toBe('3:10–3:24 AM');
    expect(formatTimeRange(atMinutes(EVE, 23 * 60 + 50), atMinutes(WAKE, 10))).toBe('11:50 PM–12:10 AM');
  });

  it('runs on the demo data via analyze(), for the last night', () => {
    const now = Date.parse('2026-10-28T09:30:00-05:00');
    const a = analyze(generateDemoData(now), now);
    const s = a.lastNightStory!;
    expect(s.sessionId).toBe(a.lastNight!.main!.id);
    expect(s.sentences.length).toBeGreaterThan(3);
    expect(s.oneLiner.length).toBeLessThan(130);
    expect(s.text).not.toMatch(/undefined|NaN/);
  });
});
