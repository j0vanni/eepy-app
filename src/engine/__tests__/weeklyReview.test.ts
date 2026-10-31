import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import { createExperiment, TEMPLATE_BY_ID } from '../experiments';
import type { GoalSetting } from '../goals';
import { mean } from '../stats';
import { debtOnDate } from '../sleepDebt';
import { addDays, atMinutes, weekdayOfKey } from '../time';
import { availableWeeks, buildWeeklyReview, latestReviewWeek, reviewNightLabel, weekLabel, weekStartOf } from '../weeklyReview';

describe('review weeks', () => {
  it('uses Monday–Sunday weeks', () => {
    // 2026-10-19 is a Monday.
    expect(weekdayOfKey('2026-10-19')).toBe(1);
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-22')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26');
    // Across the DST change (Chicago, 1 Nov 2026).
    expect(weekStartOf('2026-11-03')).toBe('2026-11-02');
    expect(weekLabel('2026-10-26')).toBe('26 Oct – 1 Nov');
  });

  it('is ready on Sunday; until then the latest review is last week', () => {
    expect(latestReviewWeek('2026-10-25')).toBe('2026-10-19');
    expect(latestReviewWeek('2026-10-28')).toBe('2026-10-19');
    expect(latestReviewWeek('2026-10-26')).toBe('2026-10-19');
    expect(latestReviewWeek('2026-11-01')).toBe('2026-10-26');
  });

  it('labels nights by the evening they started', () => {
    expect(reviewNightLabel('2026-10-23')).toBe('Thu night');
  });
});

describe('weekly review', () => {
  const now = atMinutes('2026-10-29', 15 * 60); // a Thursday
  const demo = generateDemoData(now);
  const a = analyze(demo, now);
  const goals: GoalSetting[] = [
    { id: 'consistent-wake', enabled: true, startedAt: '2026-10-01', targetMin: 7 * 60 },
    { id: 'meet-need', enabled: true, startedAt: '2026-10-01' },
  ];
  const week = latestReviewWeek(a.day);
  const review = buildWeeklyReview({ analysis: a, data: demo, goals, experiments: [], weekStart: week });

  it('summarises the week', () => {
    expect(week).toBe('2026-10-19');
    expect(review.ready).toBe(true);
    expect(review.rows.map((r) => r.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(week, i)));
    expect(review.nightsRecorded).toBe(7);
    const nights = a.nights.filter((n) => n.main && n.wakeDate >= week && n.wakeDate <= addDays(week, 6));
    expect(review.avgSleepMin).toBeCloseTo(mean(nights.map((n) => n.totalSleepMin)));
    expect(review.avgScore).toBeGreaterThan(30);
    expect(review.prevAvgScore).toBeDefined();
    expect(review.debtEndMin).toBeCloseTo(debtOnDate(a.nights, a.need.needMin, addDays(week, 6)));
    expect(review.debtChangeMin).toBeCloseTo(review.debtEndMin - review.debtStartMin);
    expect(review.regularity.wakeSdMin).toBeGreaterThan(0);
    expect(review.headline).toMatch(/^Avg \dh \d\dm · score \d+ · best night \w{3}$/);
  });

  it('picks the best and worst nights', () => {
    expect(review.best).toBeDefined();
    expect(review.worst).toBeDefined();
    expect(review.best!.score!).toBeGreaterThanOrEqual(review.worst!.score!);
    expect(review.best!.date).not.toBe(review.worst!.date);
  });

  it('includes goal adherence, top insights and a focus for next week', () => {
    expect(review.goals.map((g) => g.id)).toEqual(['consistent-wake', 'meet-need']);
    for (const g of review.goals) expect(g.known).toBeLessThanOrEqual(7);
    expect(review.goalScore).toBeDefined();
    expect(review.insights.length).toBeGreaterThan(0);
    expect(review.focus.templateId).toBeDefined();
    expect(review.focus.title).toMatch(/^Try: /);
  });

  it('mentions persistent oxygen dips only when the breathing check says they are frequent', () => {
    expect(review.breathing).toBeUndefined(); // the demo person breathes normally
    const frequent = { ...a, breathing: { ...a.breathing!, level: 'frequent' as const, title: 'Frequent dips — worth mentioning to a doctor', detail: 'x' } };
    const r = buildWeeklyReview({ analysis: frequent, data: demo, goals, experiments: [], weekStart: week });
    expect(r.breathing).toEqual({ title: 'Frequent dips — worth mentioning to a doctor', detail: 'x' });
    // Older weeks don't repeat today's 30-night verdict.
    expect(buildWeeklyReview({ analysis: frequent, data: demo, goals, experiments: [], weekStart: addDays(week, -7) }).breathing).toBeUndefined();
  });

  it('keeps the focus on a running experiment', () => {
    const e = createExperiment(TEMPLATE_BY_ID['no-screens'], { startDate: addDays(a.day, -3), now });
    const r = buildWeeklyReview({ analysis: a, data: demo, goals, experiments: [e], weekStart: week });
    expect(r.focus.title).toBe('Keep going: Screens off 30 min before bed');
    expect(r.focus.experimentId).toBe(e.id);
    expect(r.experiment?.id).toBe(e.id);
  });

  it('lists past weeks newest first', () => {
    const weeks = availableWeeks(a.nights, a.day, 6);
    expect(weeks[0]).toBe(week);
    expect(weeks).toHaveLength(6);
    for (let i = 1; i < weeks.length; i++) expect(weeks[i]).toBe(addDays(weeks[i - 1], -7));
    // An older week only compares against what came before it.
    const old = buildWeeklyReview({ analysis: a, data: demo, goals, experiments: [], weekStart: weeks[5] });
    expect(old.nightsRecorded).toBeGreaterThan(0);
    expect(old.weekStart).toBe(weeks[5]);
  });
});
