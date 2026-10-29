import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import {
  adherenceFor,
  computeExperimentResult,
  createExperiment,
  defaultTargetMin,
  Experiment,
  EXPERIMENT_TEMPLATES,
  ExperimentData,
  experimentData,
  finishExperiment,
  inferAdherence,
  needsQuestion,
  rankTemplates,
  reminderFor,
  suggestionInput,
  TEMPLATE_BY_ID,
} from '../experiments';
import type { Insight } from '../insights';
import { analyzeSessions, buildNights, Night } from '../sessions';
import { gaussian, rng } from '../stats';
import { addDays, atMinutes, formatTime, MINUTE } from '../time';
import type { CaffeineDose, DayLog, SleepSession } from '../types';
import { night } from './helpers';

const TODAY = '2026-10-21';

/** Nights ending on each wake date from `from` to `to` (inclusive) with a per-night latency. */
function buildData(opts: {
  from: string;
  to: string;
  latency: (wakeDate: string, i: number) => number;
  onsetMin?: (wakeDate: string) => number;
  hours?: number;
  dayLogs?: Record<string, DayLog>;
  caffeine?: CaffeineDose[];
  extra?: SleepSession[];
  today?: string;
}): ExperimentData {
  const sessions: SleepSession[] = [];
  for (let d = opts.from, i = 0; d <= opts.to; d = addDays(d, 1), i++) {
    const eve = addDays(d, -1);
    sessions.push(night(eve, opts.onsetMin?.(d) ?? 23 * 60, opts.hours ?? 7.5, { latencyMin: opts.latency(d, i), id: `n-${d}` }));
  }
  const nights = buildNights(analyzeSessions([...sessions, ...(opts.extra ?? [])]));
  const scores: Record<string, { total: number }> = {};
  for (const n of nights) if (n.main) scores[n.main.id] = { total: 80 };
  return { today: opts.today ?? TODAY, nights, scores, vitals: {}, dayLogs: opts.dayLogs ?? {}, caffeine: opts.caffeine ?? [] };
}

const exp = (templateId: string, startDate: string, over: Partial<Experiment> = {}): Experiment => ({
  ...createExperiment(TEMPLATE_BY_ID[templateId], { startDate, now: atMinutes(startDate, 20 * 60), id: `e-${templateId}` }),
  ...over,
});

describe('experiment templates', () => {
  it('offers at least 10 complete templates with unique ids', () => {
    expect(EXPERIMENT_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(EXPERIMENT_TEMPLATES.map((t) => t.id)).size).toBe(EXPERIMENT_TEMPLATES.length);
    for (const t of EXPERIMENT_TEMPLATES) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.why.split(/[.!?](\s|$)/).filter((s) => s && s.trim().length > 2).length).toBeLessThanOrEqual(2);
      expect([7, 14]).toContain(t.durationDays);
      expect(t.metrics.length).toBeGreaterThan(0);
      expect(t.question).toMatch(/\?$/);
    }
  });

  it('covers the planned experiments', () => {
    for (const id of ['caffeine-cutoff', 'no-alcohol', 'no-screens', 'consistent-wake', 'morning-light', 'earlier-bedtime', 'no-late-meals', 'exercise-early', 'cool-bedroom', 'no-naps', 'read-not-phone']) {
      expect(TEMPLATE_BY_ID[id]).toBeDefined();
    }
  });

  it('derives target times from the habitual schedule', () => {
    const chronotype = { habitual: { onsetMin: 23 * 60 + 40, wakeMin: 7 * 60 + 10 } } as never;
    expect(defaultTargetMin(TEMPLATE_BY_ID['consistent-wake'], { chronotype, latencyMin: 10 })).toBe(7 * 60 + 10);
    // Habitual in-bed time (onset − latency) minus 30 min.
    expect(defaultTargetMin(TEMPLATE_BY_ID['earlier-bedtime'], { chronotype, latencyMin: 10 })).toBe(23 * 60);
    expect(defaultTargetMin(TEMPLATE_BY_ID['no-alcohol'], { chronotype, latencyMin: 10 })).toBeUndefined();
  });
});

describe('adherence', () => {
  const day = '2026-10-15';
  const base = buildData({ from: '2026-10-10', to: '2026-10-20', latency: () => 10 });

  it('infers the caffeine cut-off from the caffeine log', () => {
    const e = exp('caffeine-cutoff', '2026-10-14');
    const late = { ...base, caffeine: [{ id: 'a', time: atMinutes(day, 15 * 60), mg: 95, label: 'Coffee' }] };
    expect(inferAdherence(e, day, late)).toMatchObject({ value: false, source: 'data' });
    const early = { ...base, caffeine: [{ id: 'a', time: atMinutes(day, 9 * 60), mg: 95, label: 'Coffee' }] };
    expect(inferAdherence(e, day, early).value).toBe(true);
    // A non-logger: nothing logged means nothing.
    expect(inferAdherence(e, day, base).value).toBeUndefined();
    // Journal tag counts as a miss.
    const tagged = { ...early, dayLogs: { [day]: { date: day, tags: ['late-caffeine'] } } };
    expect(inferAdherence(e, day, tagged).value).toBe(false);
  });

  it('reads avoid-tags from the journal', () => {
    const e = exp('no-alcohol', '2026-10-14');
    expect(inferAdherence(e, day, { ...base, dayLogs: { [day]: { date: day, tags: ['alcohol'] } } }).value).toBe(false);
    expect(inferAdherence(e, day, { ...base, dayLogs: { [day]: { date: day, tags: ['exercise'] } } }).value).toBe(true);
    expect(inferAdherence(e, day, base).value).toBeUndefined();
    // Screens: a journaled evening without the tag is not proof of a screen-free buffer.
    const s = exp('no-screens', '2026-10-14');
    expect(inferAdherence(s, day, { ...base, dayLogs: { [day]: { date: day, tags: ['exercise'] } } }).value).toBeUndefined();
    expect(inferAdherence(s, day, { ...base, dayLogs: { [day]: { date: day, tags: ['screens'] } } }).value).toBe(false);
  });

  it('checks wake time and bedtime from the watch', () => {
    const d = buildData({ from: '2026-10-10', to: '2026-10-20', latency: () => 10, onsetMin: (w) => (w === '2026-10-16' ? 24 * 60 + 30 : 23 * 60) });
    // Night 15→16 starts at 00:20 and ends 08:00; other nights 22:50 → 06:30.
    const wake = exp('consistent-wake', '2026-10-14', { targetMin: 6 * 60 + 30 });
    expect(inferAdherence(wake, '2026-10-14', d).value).toBe(true);
    expect(inferAdherence(wake, '2026-10-15', d).value).toBe(false);
    const bed = exp('earlier-bedtime', '2026-10-14', { targetMin: 22 * 60 + 45 });
    expect(inferAdherence(bed, '2026-10-14', d).value).toBe(true);
    expect(inferAdherence(bed, '2026-10-15', d)).toMatchObject({ value: false, reason: expect.stringContaining('00:20') });
  });

  it('detects naps and late workouts', () => {
    const nap: SleepSession = { id: 'nap', source: 'manual', start: atMinutes(day, 14 * 60), end: atMinutes(day, 14 * 60 + 25), stages: [], kind: 'nap' };
    const withNap = buildData({ from: '2026-10-10', to: '2026-10-20', latency: () => 10, extra: [nap] });
    const e = exp('no-naps', '2026-10-14');
    expect(inferAdherence(e, day, withNap).value).toBe(false);
    expect(inferAdherence(e, '2026-10-16', withNap).value).toBe(true);
    const x = exp('exercise-early', '2026-10-14');
    const late = { ...base, workouts: [{ id: 'w', type: 56, start: atMinutes(day, 18 * 60), end: atMinutes(day, 19 * 60) }] };
    const early = { ...base, workouts: [{ id: 'w', type: 56, start: atMinutes(day, 7 * 60), end: atMinutes(day, 8 * 60) }] };
    expect(inferAdherence(x, day, late).value).toBe(false);
    expect(inferAdherence(x, day, early).value).toBe(true);
    expect(inferAdherence(x, day, base).value).toBeUndefined();
  });

  it('lets a manual answer override inference and asks only when needed', () => {
    const e = exp('no-alcohol', '2026-10-14', { adherence: { [day]: true } });
    const d = { ...base, dayLogs: { [day]: { date: day, tags: ['alcohol'] } } };
    expect(adherenceFor(e, day, d)).toEqual({ value: true, source: 'manual' });
    expect(needsQuestion(e, day, d)).toBe(false);
    expect(needsQuestion(e, '2026-10-16', d)).toBe(true);
    expect(needsQuestion(e, '2026-10-01', d)).toBe(false); // outside the period
  });
});

describe('experiment results', () => {
  const start = '2026-10-12';
  // 28 baseline nights (wake dates up to the start date) with ~25 min latency, then 7 experiment nights with ~12 min.
  const r = rng(7);
  const data = buildData({
    from: addDays(start, -27),
    to: addDays(start, 7),
    today: addDays(start, 7),
    latency: (w) => Math.max(2, Math.round(w <= start ? gaussian(r, 25, 4) : gaussian(r, 12, 3))),
  });
  const allYes = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [addDays(start, i), true]));

  it('reports a strong, plain-language effect and recommends keeping it', () => {
    const e = exp('no-screens', start, { adherence: allYes });
    const res = computeExperimentResult(e, data);
    expect(res.complete).toBe(true);
    expect(res.kept).toBe(7);
    expect(res.adherencePct).toBe(1);
    expect(res.nightsAnalysed).toBe(7);
    expect(res.baselineNights).toBe(28);
    const lat = res.metrics.find((m) => m.key === 'latency')!;
    expect(lat.improved).toBe(true);
    expect(lat.signal).toBe('strong');
    expect(lat.text).toMatch(/^Time to fall asleep dropped 1\d min — strong signal$/);
    expect(res.recommendation.kind).toBe('keep');
  });

  it('only analyses nights that followed the rule', () => {
    const e = exp('no-screens', start, { adherence: { ...allYes, [addDays(start, 1)]: false, [addDays(start, 2)]: false } });
    const res = computeExperimentResult(e, data);
    expect(res.kept).toBe(5);
    expect(res.missed).toBe(2);
    expect(res.nightsAnalysed).toBe(5);
    expect(res.adherencePct).toBeCloseTo(5 / 7);
    expect(res.days.map((d) => d.status)).toEqual(['kept', 'missed', 'missed', 'kept', 'kept', 'kept', 'kept']);
  });

  it('says "no effect" when nothing changed', () => {
    const r2 = rng(3);
    const flat = buildData({ from: addDays(start, -27), to: addDays(start, 7), today: addDays(start, 7), latency: () => Math.round(gaussian(r2, 15, 4)) });
    const res = computeExperimentResult(exp('no-screens', start, { adherence: allYes }), flat);
    expect(res.metrics.find((m) => m.key === 'latency')!.signal).not.toBe('strong');
    expect(['no-effect', 'extend']).toContain(res.recommendation.kind);
  });

  it('is too early on day one and tracks unanswered days', () => {
    const fresh = exp('no-screens', addDays(start, 6));
    const res = computeExperimentResult(fresh, data);
    expect(res.recommendation.kind).toBe('too-early');
    expect(res.days[0].status).toBe('unknown');
    expect(res.days[1].status).toBe('today');
    expect(res.needsAnswer).toBe(addDays(start, 6));
    expect(res.remaining).toBe(6);
  });

  it('freezes the outcome when finished', () => {
    const done = finishExperiment(exp('no-screens', start, { adherence: allYes }), data, atMinutes(addDays(start, 7), 9 * 60));
    expect(done.status).toBe('completed');
    expect(done.outcome).toMatchObject({ kind: 'keep', nights: 7, adherencePct: 1 });
    // Days after an early abandon don't count.
    const early = finishExperiment(exp('no-screens', start, { adherence: allYes }), { ...data, today: addDays(start, 3) }, atMinutes(addDays(start, 3), 9 * 60), 'abandoned');
    const res = computeExperimentResult(early, data);
    expect(res.kept).toBe(3);
    expect(res.days.slice(3).every((d) => d.status === 'upcoming')).toBe(true);
  });
});

describe('suggestions and reminders', () => {
  const now = atMinutes('2026-10-29', 15 * 60);
  const demo = generateDemoData(now);
  const a = analyze(demo, now);

  it('ranks templates by the user’s insights and data', () => {
    const insight: Insight = { id: 'tag:alcohol', kind: 'negative', category: 'habit', title: 'After drinking alcohol, your HRV is 12 ms lower', detail: '', strength: 0.9 };
    const ranked = rankTemplates({ ...suggestionInput(a, demo, []), insights: [insight], tips: [] });
    expect(ranked[0].template.id).toBe('no-alcohol');
    expect(ranked[0].reason).toBe(insight.title);
    expect(ranked).toHaveLength(EXPERIMENT_TEMPLATES.length);
    // Active experiments are not suggested again; recently tried ones drop down.
    const active = createExperiment(TEMPLATE_BY_ID['no-alcohol'], { startDate: a.day, now });
    const without = rankTemplates({ ...suggestionInput(a, demo, [active]), insights: [insight], tips: [] });
    expect(without.find((s) => s.template.id === 'no-alcohol')).toBeUndefined();
    const tried = { ...active, status: 'completed' as const, finishedAt: now };
    const again = rankTemplates({ ...suggestionInput(a, demo, [tried]), insights: [insight], tips: [] });
    expect(again[0].template.id).not.toBe('no-alcohol');
  });

  it('suggests something relevant for the demo user', () => {
    const ranked = rankTemplates(suggestionInput(a, demo, []));
    expect(ranked[0].reason).toBeTruthy();
    expect(ranked[0].score).toBeGreaterThan(ranked[ranked.length - 1].score);
  });

  it('times reminders to the rule', () => {
    const times = { bedtime: atMinutes(TODAY, 23 * 60), wake: atMinutes(TODAY, 7 * 60) };
    expect(formatTime(reminderFor(exp('caffeine-cutoff', TODAY), TODAY, times)!.at)).toBe('13:30');
    expect(formatTime(reminderFor(exp('no-screens', TODAY), TODAY, times)!.at)).toBe('22:20');
    expect(formatTime(reminderFor(exp('morning-light', TODAY), TODAY, times)!.at)).toBe('07:15');
    const bed = reminderFor(exp('earlier-bedtime', TODAY, { targetMin: 22 * 60 + 30 }), TODAY, times)!;
    expect(bed.at).toBe(atMinutes(TODAY, 21 * 60 + 45));
    expect(bed.text).toContain('22:30');
  });

  it('builds its inputs from an analysis', () => {
    const d = experimentData(a, demo);
    expect(d.today).toBe(a.day);
    expect(d.nights).toBe(a.nights);
    const n: Night | undefined = d.nights.find((x) => x.main);
    expect(n && d.scores[n.main!.id]).toBeDefined();
    expect(MINUTE).toBe(60_000);
  });
});
