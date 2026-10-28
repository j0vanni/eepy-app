import type { SessionMetrics } from './sessions';
import { clamp, clockDiff, formatDuration, minutesOfDay } from './time';

export interface ScoreComponent {
  key: 'duration' | 'efficiency' | 'latency' | 'deep' | 'rem' | 'disruptions' | 'timing';
  label: string;
  /** 0–1 */
  score: number;
  weight: number;
  value: string;
  detail: string;
}

export interface SleepScore {
  total: number;
  label: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  components: ScoreComponent[];
}

const lerp = (x: number, x0: number, x1: number) => clamp((x - x0) / (x1 - x0), 0, 1);

/** Deep sleep declines with age; targets are a share of total sleep time. */
export function deepTarget(age: number): number {
  if (age < 30) return 0.16;
  if (age < 50) return 0.13;
  return 0.1;
}

export function scoreLabel(total: number): SleepScore['label'] {
  if (total >= 85) return 'Excellent';
  if (total >= 70) return 'Good';
  if (total >= 55) return 'Fair';
  return 'Poor';
}

export function scoreSleep(m: SessionMetrics, ctx: { needMin: number; age: number; habitualMidSleepMin?: number }): SleepScore {
  const c: ScoreComponent[] = [];
  const ratio = m.totalSleepMin / ctx.needMin;
  const durScore = ratio > 1.3 ? clamp(1 - (ratio - 1.3), 0.7, 1) : lerp(ratio, 0.6, 1);
  c.push({
    key: 'duration',
    label: 'Duration',
    score: durScore,
    weight: 35,
    value: formatDuration(m.totalSleepMin),
    detail:
      ratio >= 1
        ? `You met your ${formatDuration(ctx.needMin)} need.`
        : `${formatDuration(ctx.needMin - m.totalSleepMin)} short of your ${formatDuration(ctx.needMin)} need.`,
  });

  c.push({
    key: 'efficiency',
    label: 'Efficiency',
    score: lerp(m.efficiency, 0.7, 0.9),
    weight: 15,
    value: `${Math.round(m.efficiency * 100)}%`,
    detail: m.efficiency >= 0.9 ? 'Very little time awake in bed.' : 'Time awake in bed lowered your efficiency (85%+ is healthy).',
  });

  const lat = m.latencyMin;
  let latScore: number;
  let latDetail: string;
  if (lat < 1) {
    latScore = 1;
    latDetail = 'Your watch started recording at sleep onset, so time-to-fall-asleep is not available.';
  } else if (lat < 5) {
    latScore = 0.8;
    latDetail = 'Falling asleep within 5 minutes can be a sign of sleep deprivation.';
  } else if (lat <= 20) {
    latScore = 1;
    latDetail = 'Healthy time to fall asleep.';
  } else {
    latScore = lat >= 60 ? 0 : 1 - lerp(lat, 20, 60) * 0.85;
    latDetail = 'Taking over 20–30 minutes to fall asleep regularly is worth addressing (wind-down, caffeine timing, consistent wake time).';
  }
  c.push({ key: 'latency', label: 'Falling asleep', score: latScore, weight: 5, value: `${Math.round(lat)} min`, detail: latDetail });

  if (m.stagePct) {
    const target = deepTarget(ctx.age);
    c.push({
      key: 'deep',
      label: 'Deep sleep',
      score: lerp(m.stagePct.deep, target * 0.3, target),
      weight: 10,
      value: `${formatDuration(m.stageMin.deep)} · ${Math.round(m.stagePct.deep * 100)}%`,
      detail: `Target for your age is around ${Math.round(target * 100)}% of sleep. Deep sleep is front-loaded and drives physical recovery.`,
    });
    c.push({
      key: 'rem',
      label: 'REM sleep',
      score: lerp(m.stagePct.rem, 0.08, 0.2),
      weight: 10,
      value: `${formatDuration(m.stageMin.rem)} · ${Math.round(m.stagePct.rem * 100)}%`,
      detail: 'REM (about 20–25% of sleep) supports memory and mood; it is concentrated in the last third of the night, so short nights cut it first.',
    });
  }

  const disruptScore = lerp(-m.wasoMin, -60, -15) * (m.awakenings > 6 ? 0.8 : 1);
  c.push({
    key: 'disruptions',
    label: 'Restfulness',
    score: disruptScore,
    weight: 10,
    value: `${Math.round(m.wasoMin)} min awake · ${m.awakenings}×`,
    detail: 'Minutes awake after first falling asleep, and the number of awakenings.',
  });

  if (ctx.habitualMidSleepMin !== undefined) {
    const off = Math.abs(clockDiff(ctx.habitualMidSleepMin, minutesOfDay(m.midSleep)));
    c.push({
      key: 'timing',
      label: 'Timing',
      score: 1 - lerp(off, 30, 150),
      weight: 15,
      value: off < 1 ? 'on time' : `${formatDuration(off)} off`,
      detail: 'How close the middle of your sleep was to your usual. Regular timing strengthens your body clock.',
    });
  }

  const wsum = c.reduce((s, x) => s + x.weight, 0);
  const weighted = Math.round((100 * c.reduce((s, x) => s + x.weight * x.score, 0)) / wsum);
  // Nothing else can make up for not sleeping enough: duration caps the total.
  const total = Math.min(weighted, Math.round(45 + 55 * durScore));
  return { total, label: scoreLabel(total), components: c };
}
