/** Cards for the Today screen, shared between the time-of-day heroes and the sections below them. */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { sleepPressureAt } from '@/engine/alertness';
import type { Analysis } from '@/engine/analysis';
import { caffeineAt } from '@/engine/caffeine';
import { USUAL_SKIPPED_MARK, usualCaffeine, usualCaffeineMissing, usualDose } from '@/engine/caffeineHabits';
import { CHRONOTYPE_LABELS } from '@/engine/chronotype';
import type { PlanKind } from '@/engine/coach';
import { curvePosition } from '@/engine/dayPhase';
import { dateKey, formatClock, formatDuration, formatTime, HOUR, MINUTE, minutesOfDay } from '@/engine/time';
import { nextWakeAlarm } from '@/notifications/fullScreenAlarm';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { ArcGauge, EnergyChart, energyWord, Hypnogram } from '@/ui/charts';
import { Button, Card, CardTitle, Chip, Icon, Meter, Note, Ring, Row, Section, Stat } from '@/ui/components';
import { nightLabel } from '@/ui/format';
import { colors, debtColor, font, scoreColor, space } from '@/ui/theme';

type A = { a: Analysis };

/** "2h 14m", "9m 05s", "now". */
export function until(ms: number): string {
  if (ms <= 0) return 'now';
  if (ms < 10 * MINUTE) {
    const m = Math.floor(ms / MINUTE);
    const s = Math.floor((ms % MINUTE) / 1000);
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  }
  return formatDuration(Math.floor(ms / MINUTE));
}

const chevron = <Icon name="chevron-right" color={colors.textFaint} />;

// ---------------------------------------------------------------------------
// Last night
// ---------------------------------------------------------------------------

export function LastNightCard({ a, hero }: A & { hero?: boolean }) {
  const last = a.lastNight?.main;
  const score = last ? a.scores[last.id] : undefined;
  if (!last || !score) return null;
  const size = hero ? 112 : 92;
  return (
    <Card onPress={() => router.push({ pathname: '/night/[id]', params: { id: last.id } })} accent={hero ? scoreColor(score.total) : undefined}>
      <CardTitle icon="bed-outline" title={hero ? `${nightLabel(a.lastNight!.wakeDate)} · your report` : nightLabel(a.lastNight!.wakeDate)} right={chevron} />
      <Row gap={space.lg}>
        <Ring value={score.total} color={scoreColor(score.total)} size={size} stroke={hero ? 12 : 10}>
          <Text style={[font.stat, { fontSize: hero ? 32 : 26 }]}>{score.total}</Text>
          <Text style={font.tiny}>{score.label.toUpperCase()}</Text>
        </Ring>
        <View style={{ flex: 1, gap: space.sm }}>
          <Row>
            <Stat label="Asleep" value={formatDuration(last.totalSleepMin)} sub={`need ${formatDuration(a.need.needMin)}`} />
            <Stat label="In bed" value={formatTime(last.start)} sub={`→ ${formatTime(last.end)}`} />
          </Row>
          {last.stagePct ? (
            <Text style={font.small}>
              Deep {Math.round(last.stagePct.deep * 100)}% · REM {Math.round(last.stagePct.rem * 100)}% · {last.awakenings} wake-ups
            </Text>
          ) : null}
        </View>
      </Row>
      <View style={{ marginTop: space.md }}>
        <Hypnogram segments={last.segments} start={last.start} end={last.end} height={hero ? 120 : 96} />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Morning
// ---------------------------------------------------------------------------

const RATINGS = ['😫', '😕', '😐', '🙂', '😄'];

export function MorningCheckInCard({ a }: A) {
  const log = useStore((s) => s.dayLogs[a.day]);
  const logDay = useStore((s) => s.logDay);
  const done = log?.sleepRating !== undefined && log?.wokeNaturally !== undefined;
  return (
    <Card accent={done ? undefined : colors.energy}>
      <CardTitle
        icon={done ? 'check-circle-outline' : 'weather-sunset-up'}
        title={done ? 'Morning check-in done' : 'Morning check-in'}
        color={done ? colors.good : colors.energy}
        right={
          <Pressable onPress={() => router.push('/journal')} hitSlop={8} accessibilityRole="link" accessibilityLabel="Open journal">
            <Row gap={2}>
              <Text style={[font.small, { color: colors.accent }]}>Journal</Text>
              <Icon name="chevron-right" size={18} color={colors.accent} />
            </Row>
          </Pressable>
        }
      />
      <Text style={font.small}>How did you sleep?</Text>
      <Row gap={space.xs} style={{ marginTop: 6, justifyContent: 'space-between' }}>
        {RATINGS.map((r, i) => {
          const selected = log?.sleepRating === i + 1;
          return (
            <Pressable
              key={r}
              onPress={() => logDay(a.day, { sleepRating: i + 1 })}
              style={({ pressed }) => [
                { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: selected ? colors.accent : 'transparent' },
                { backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceAlt : 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Rate last night ${i + 1} of 5`}
            >
              <Text style={{ fontSize: 30, opacity: log?.sleepRating && !selected ? 0.45 : 1 }}>{r}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Text style={[font.small, { marginTop: space.md }]}>Woke up naturally?</Text>
      <Row gap={space.sm} style={{ marginTop: 6 }}>
        <Chip label="Yes, on my own" icon="weather-sunny" selected={log?.wokeNaturally === true} onPress={() => logDay(a.day, { wokeNaturally: true })} />
        <Chip label="Alarm / woken" icon="alarm" selected={log?.wokeNaturally === false} onPress={() => logDay(a.day, { wokeNaturally: false })} />
      </Row>
      <Text style={[font.tiny, { marginTop: 6 }]}>Natural wake-ups are the best evidence of how much sleep you really need.</Text>
    </Card>
  );
}

export function LightNowCard({ a, now }: A & { now: number }) {
  const tags = useStore((s) => s.dayLogs[a.day]?.tags);
  const toggleTag = useStore((s) => s.toggleTag);
  const done = tags?.includes('outdoor-light') ?? false;
  const item = a.plan.find((p) => p.kind === 'light');
  const end = item?.end ?? a.wakeTime + 70 * MINUTE;
  const late = now > end;
  return (
    <Card accent={done ? undefined : colors.energy}>
      <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#3A2F12', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="white-balance-sunny" size={26} color={colors.energy} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={font.h3}>{done ? 'Morning light: done' : late ? 'Get some daylight' : 'Get bright light now'}</Text>
          <Text style={[font.small, { marginTop: 2 }]}>
            {done
              ? 'Nice — light early in the day anchors your body clock and makes tonight’s sleepiness arrive on time.'
              : late
                ? 'Still worth it before noon: 10–30 min outdoors (even overcast) sets your body clock.'
                : `10–30 min outdoors before ${formatTime(end)}. It advances your body clock and clears grogginess faster than coffee.`}
          </Text>
          <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
            <Chip label={done ? 'Logged' : 'I got outside'} icon={done ? 'check' : 'walk'} selected={done} color={colors.energy} onPress={() => toggleTag(a.day, 'outdoor-light')} />
          </View>
        </View>
      </Row>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------------

function curveSentence(a: Analysis, now: number): string | undefined {
  const pos = curvePosition(a.energy, now);
  if (!pos) return undefined;
  if (pos.inDip && a.energy.dip) return `You're in your afternoon dip until ${formatTime(a.energy.dip.end)} — good for routine tasks, a walk outside or a short nap.`;
  const focus = a.energy.focusWindows.find((w) => now >= w.start && now <= w.end);
  if (focus) return `Peak focus window until ${formatTime(focus.end)} — do your most demanding work now.`;
  const next = pos.next;
  if (next?.kind === 'peak') return `${pos.trend === 'falling' ? 'A small lull' : 'Rising'} — your next peak is around ${formatTime(next.t)}.`;
  if (next?.kind === 'dip') return `${pos.trend === 'rising' ? 'Still climbing' : 'Easing off'} — your afternoon dip starts around ${formatTime(a.energy.dip?.start ?? next.t)}.`;
  if (next?.kind === 'bedtime') return `Winding down toward lights-out at ${formatTime(next.t)}.`;
  return undefined;
}

export function EnergyCard({ a, now, hero }: A & { now: number; hero?: boolean }) {
  const pos = curvePosition(a.energy, now);
  const chrono = a.chronotype.category ? CHRONOTYPE_LABELS[a.chronotype.category].label : undefined;
  const napBlock = a.nap.best && a.nap.verdict !== 'skip' ? { start: a.nap.best.start, end: a.nap.best.start + a.nap.best.alarmAfterMin * MINUTE } : undefined;
  return (
    <Card accent={hero ? colors.energy : undefined}>
      {hero && pos ? (
        <Row gap={space.md} style={{ marginBottom: space.md, alignItems: 'flex-end' }}>
          <View>
            <Text style={font.tiny}>ENERGY RIGHT NOW</Text>
            <Row gap={6} style={{ alignItems: 'flex-end' }}>
              <Text style={[font.stat, { fontSize: 52, lineHeight: 58, color: colors.energy, fontVariant: ['tabular-nums'] }]}>{Math.round(pos.energy)}</Text>
              <Icon name={pos.trend === 'rising' ? 'trending-up' : pos.trend === 'falling' ? 'trending-down' : 'trending-neutral'} size={26} color={colors.energy} />
            </Row>
            <Text style={font.small}>{energyWord(pos.energy)} · out of 100</Text>
          </View>
          <Text style={[font.small, { flex: 1, color: colors.text }]}>{curveSentence(a, now)}</Text>
        </Row>
      ) : (
        <CardTitle
          icon="lightning-bolt-outline"
          title="Energy today"
          color={colors.energy}
          right={pos ? <Text style={[font.h3, { color: colors.energy }]}>{Math.round(pos.energy)}</Text> : null}
        />
      )}
      <EnergyChart points={a.energy.points} now={now} dip={a.energy.dip} focusWindows={a.energy.focusWindows} nap={napBlock} height={hero ? 180 : 170} />
      <Row gap={space.lg} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
        {a.energy.peaks.map((p) => (
          <Text key={p.t} style={font.small}>
            <Text style={{ color: colors.good }}>▲</Text> peak {formatTime(p.t)}
          </Text>
        ))}
        {a.energy.dip ? (
          <Text style={font.small}>
            <Text style={{ color: colors.warn }}>▼</Text> dip {formatTime(a.energy.dip.t)}
          </Text>
        ) : null}
        {chrono ? <Text style={font.small}>{chrono} chronotype</Text> : null}
      </Row>
      {hero ? <Text style={[font.tiny, { marginTop: 6 }]}>Touch and drag the curve to read any moment.</Text> : null}
    </Card>
  );
}

export function NapCard({ a }: A) {
  return (
    <Card onPress={() => router.push('/nap')} accent={a.nap.verdict === 'nap-now' ? colors.accent : undefined}>
      <CardTitle icon="sleep" title="Do I need a nap?" right={chevron} />
      <Text style={font.body}>{a.nap.headline}</Text>
      <View style={{ marginTop: space.sm }}>
        <Meter value={a.nap.needScore} color={a.nap.needScore >= 55 ? colors.accent : a.nap.needScore >= 35 ? colors.warn : colors.good} />
        <Text style={[font.tiny, { marginTop: 4 }]}>NAP NEED {a.nap.needScore}/100</Text>
      </View>
    </Card>
  );
}

const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '');

/** "Had your usual coffee?" — shown when the usual morning drink hasn't been logged by an hour after its time. */
export function UsualCoffeeCard() {
  const now = useNow(60_000);
  const doses = useStore((s) => s.caffeine);
  const skipped = useStore((s) => s.settings.marks[USUAL_SKIPPED_MARK]);
  const addCaffeine = useStore((s) => s.addCaffeine);
  const setMark = useStore((s) => s.setMark);
  const usual = usualCaffeine(doses, now);
  if (!usual || skipped === dateKey(now) || !usualCaffeineMissing(doses, now, usual)) return null;
  return (
    <Card accent={colors.caffeine}>
      <CardTitle icon="coffee" title="Had your usual coffee?" color={colors.caffeine} />
      <Text style={font.small}>
        Nothing logged today. You usually have a {shortDrink(usual.label).toLowerCase()} ({usual.mg} mg) around {formatClock(usual.timeMin)} — logging it keeps your cut-off and
        bedtime advice right.
      </Text>
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        <Button
          small
          icon="check"
          label={`Yes, at ${formatClock(usual.timeMin)}`}
          onPress={() => {
            const dose = usualDose(usual, Date.now());
            if (!useStore.getState().caffeine.some((d) => d.id === dose.id)) addCaffeine(dose);
          }}
        />
        <Button small kind="secondary" icon="clock-edit-outline" label="Other time" onPress={() => router.push({ pathname: '/caffeine', params: { usual: '1' } })} />
        <Button small kind="ghost" label="Not today" onPress={() => setMark(USUAL_SKIPPED_MARK, dateKey(Date.now()))} />
      </Row>
    </Card>
  );
}

/** Caffeine in your system, recomputed every few seconds so it visibly ticks down. */
export function CaffeineLiveCard({ a }: A) {
  const now = useNow(4000);
  const doses = useStore((s) => s.caffeine);
  const halfLife = useStore((s) => s.profile.caffeineHalfLifeH);
  const limit = useStore((s) => s.profile.caffeineBedtimeLimitMg);
  const recent = doses.filter((d) => d.time > now - 36 * HOUR && d.time <= now);
  const mg = caffeineAt(recent, now, halfLife);
  // When the level falls under the bedtime limit (if it's above it now).
  let underAt: number | undefined;
  if (mg > limit) {
    for (let t = now; t < now + 24 * HOUR; t += 5 * MINUTE) {
      if (caffeineAt(recent, t, halfLife) <= limit) {
        underAt = t;
        break;
      }
    }
  }
  const cut = a.caffeine.cutoff;
  const lastDose = recent[recent.length - 1];
  return (
    <Card>
      <CardTitle icon="coffee-outline" title="Caffeine in your system" color={colors.caffeine} right={<Button small kind="secondary" icon="plus" label="Log" onPress={() => router.push('/checkin')} />} />
      <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
        <Text style={[font.stat, { color: colors.caffeine, fontVariant: ['tabular-nums'] }]}>{mg >= 0.05 ? mg.toFixed(1) : '0'}</Text>
        <Text style={[font.small, { marginBottom: 5 }]}>mg active now</Text>
      </Row>
      <View style={{ marginTop: space.sm }}>
        <Meter value={mg} max={Math.max(200, mg)} color={colors.caffeine} height={10} />
        <Row style={{ marginTop: 4 }}>
          {lastDose ? (
            <Pressable onPress={() => router.push({ pathname: '/caffeine', params: { id: lastDose.id } })} hitSlop={8} style={{ flex: 1 }} accessibilityRole="button">
              <Text style={font.tiny}>
                last: {shortDrink(lastDose.label).toLowerCase()} at {formatTime(lastDose.time)} · <Text style={{ color: colors.accent }}>change</Text>
              </Text>
            </Pressable>
          ) : (
            <Text style={[font.tiny, { flex: 1 }]}>nothing logged in the last day</Text>
          )}
          <Text style={font.tiny}>half-life {halfLife} h</Text>
        </Row>
      </View>
      <Text style={[font.small, { marginTop: space.sm }]}>
        {cut.overLimit
          ? `~${Math.round(cut.atBedtimeMg)} mg will still be active at lights-out — skip more caffeine today.`
          : cut.cutoff && cut.cutoff > now
            ? `Cut-off for another coffee: ${formatTime(cut.cutoff)}.`
            : cut.cutoff
              ? `Past today's cut-off (${formatTime(cut.cutoff)}) — more now would linger into your sleep.`
              : ''}
        {underAt ? ` Drops under your ${limit} mg bedtime limit around ${formatTime(underAt)}.` : ''}
      </Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sleep pressure
// ---------------------------------------------------------------------------

function pressureWord(p: number): string {
  if (p < 0.25) return 'Low — freshly slept';
  if (p < 0.45) return 'Building up';
  if (p < 0.6) return 'High';
  return 'Very high — sleep comes easily';
}

export function SleepPressureCard({ a, now, embedded }: A & { now: number; embedded?: boolean }) {
  const p = sleepPressureAt(a.sleeps, now);
  const bed = a.sleepPressure.atBedtime;
  const color = p >= 0.6 ? colors.accent : p >= 0.45 ? colors.light : colors.info;
  const body = (
    <Row gap={space.md}>
      <ArcGauge value={p} marker={bed} size={150} stroke={13} color={color}>
        <Text style={[font.stat, { fontSize: 28, fontVariant: ['tabular-nums'] }]}>{Math.round(p * 100)}%</Text>
      </ArcGauge>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[font.h3, { color }]}>{pressureWord(p)}</Text>
        <Text style={font.small}>
          {now < a.tonight.bedtime
            ? `Reaches ~${Math.round(bed * 100)}% at lights-out (${formatTime(a.tonight.bedtime)}, white tick).`
            : `It was ~${Math.round(bed * 100)}% at lights-out.`}
        </Text>
        <Text style={font.tiny}>Builds every hour you're awake and drains while you sleep. Naps and lie-ins lower it.</Text>
      </View>
    </Row>
  );
  if (embedded) return body;
  return (
    <Card>
      <CardTitle icon="gauge" title="Sleep pressure" color={colors.light} />
      {body}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Need / debt, tonight, readiness, plan, coaching, insights
// ---------------------------------------------------------------------------

export function NeedDebtRow({ a }: A) {
  const debtCol = debtColor(a.debt.category);
  return (
    <>
      <Row gap={space.md} style={{ alignItems: 'stretch' }}>
        <Card style={{ flex: 1 }} onPress={() => router.push('/need')}>
          <Text style={font.tiny}>SLEEP NEED</Text>
          <Text style={[font.stat, { marginTop: 4 }]}>{formatDuration(a.need.needMin)}</Text>
          <Text style={font.small}>
            {a.need.method === 'override' ? 'set by you' : a.need.method === 'personalized' ? `personalised · ${a.need.confidence} confidence` : 'age-based estimate'}
          </Text>
        </Card>
        <Card style={{ flex: 1 }} onPress={() => router.push('/trends')}>
          <Text style={font.tiny}>SLEEP DEBT</Text>
          <Text style={[font.stat, { marginTop: 4, color: debtCol }]}>{formatDuration(a.debt.debtMin)}</Text>
          <Text style={font.small}>
            {a.debt.category === 'none' ? 'fully rested' : `${a.debt.category}`}
            {a.debt.trendMin !== undefined && Math.abs(a.debt.trendMin) >= 15 ? ` · ${a.debt.trendMin > 0 ? '▲' : '▼'} ${formatDuration(Math.abs(a.debt.trendMin))} this week` : ''}
          </Text>
        </Card>
      </Row>
      {a.debt.payoff ? (
        <Note tone="warn" icon="bed-clock">
          Pay it back: sleep ~{a.debt.payoff.extraMinPerNight} min more for {a.debt.payoff.nights} night{a.debt.payoff.nights > 1 ? 's' : ''}. Tonight's plan already includes it.
        </Note>
      ) : null}
    </>
  );
}

export function TonightCard({ a, now, detailed }: A & { now: number; detailed?: boolean }) {
  const settings = useStore((s) => s.settings);
  const wake = settings.notifications.smartAlarm ? nextWakeAlarm(a, settings, now) : undefined;
  const skipped = wake?.skipped && dateKey(wake.base) === a.tonight.wakeDate;
  return (
    <Card onPress={() => router.push('/plan')}>
      <CardTitle icon="moon-waning-crescent" title={detailed ? "Tonight's plan" : 'Tonight'} right={chevron} />
      <Row>
        <Stat label="Wind down" value={formatTime(a.tonight.windDownStart)} />
        <Stat label="Lights out" value={formatTime(a.tonight.bedtime)} color={colors.accent} />
        <Stat
          label="Alarm"
          value={skipped ? 'Skipped' : formatTime(a.alarm.alarm)}
          color={skipped ? colors.textDim : undefined}
          sub={skipped ? 'sleep in' : a.alarm.onBoundary ? 'cycle-timed' : undefined}
        />
      </Row>
      <Pressable onPress={() => router.push('/tonight')} hitSlop={8} accessibilityRole="button" style={{ marginTop: space.sm }}>
        <Text style={[font.small, { color: colors.accent, fontWeight: '600' }]}>
          {a.tonight.adjusted ? `Adjusted for tonight · plan was ${formatTime(a.tonight.adjusted.plannedBedtime)} — change` : "Can't make it tonight? Adjust"}
        </Text>
      </Pressable>
      <View style={{ marginTop: space.md, gap: 4 }}>
        {a.caffeine.cutoff.cutoff ? (
          <Text style={font.small}>
            ☕ Caffeine cut-off {formatTime(a.caffeine.cutoff.cutoff)}
            {a.caffeine.cutoff.cutoff < now ? ' (passed)' : ''}
            {a.caffeine.nowMg >= 5 ? ` · ${Math.round(a.caffeine.nowMg)} mg in your system now` : ''}
          </Text>
        ) : a.caffeine.cutoff.overLimit ? (
          <Text style={[font.small, { color: colors.warn }]}>☕ ~{Math.round(a.caffeine.cutoff.atBedtimeMg)} mg will still be active at bedtime — skip more caffeine today.</Text>
        ) : null}
        {detailed ? (
          <>
            <Text style={font.small}>
              🍽 Last big meal by {formatTime(a.tonight.lastMeal)} · 🏃 hard exercise done by {formatTime(a.tonight.lastExercise)}
            </Text>
            {a.tonight.rationale.map((r) => (
              <Row key={r} gap={6} style={{ alignItems: 'flex-start' }}>
                <Icon name="circle-small" size={18} color={colors.accent} />
                <Text style={[font.small, { flex: 1 }]}>{r}</Text>
              </Row>
            ))}
          </>
        ) : null}
      </View>
    </Card>
  );
}

export function ReadinessCard({ a }: A) {
  if (!a.readiness) return null;
  return (
    <Card>
      <CardTitle
        icon="heart-pulse"
        title="Readiness"
        color={colors.bad}
        right={
          <Text style={[font.h3, { color: scoreColor(a.readiness.score) }]}>
            {a.readiness.score} · {a.readiness.label}
          </Text>
        }
      />
      {a.readiness.contributors.map((c) => (
        <View key={c.key} style={{ marginBottom: space.sm }}>
          <Row>
            <Text style={[font.small, { flex: 1, color: colors.text }]}>{c.label}</Text>
            <Text style={font.small}>{c.score}</Text>
          </Row>
          <View style={{ marginTop: 4 }}>
            <Meter value={c.score} color={scoreColor(c.score)} height={6} />
          </View>
          <Text style={[font.tiny, { marginTop: 3 }]}>{c.detail}</Text>
        </View>
      ))}
    </Card>
  );
}

const PLAN_ICON: Record<PlanKind, { icon: string; color: string }> = {
  wake: { icon: 'weather-sunset-up', color: colors.energy },
  light: { icon: 'white-balance-sunny', color: colors.energy },
  focus: { icon: 'target', color: colors.good },
  dip: { icon: 'trending-down', color: colors.warn },
  nap: { icon: 'sleep', color: colors.accent },
  caffeine: { icon: 'coffee-off-outline', color: colors.caffeine },
  meal: { icon: 'silverware-fork-knife', color: colors.textDim },
  exercise: { icon: 'run', color: colors.textDim },
  winddown: { icon: 'lightbulb-night-outline', color: colors.light },
  bed: { icon: 'bed', color: colors.accent },
  alarm: { icon: 'alarm', color: colors.energy },
};

export function PlanSection({ a, now }: A & { now: number }) {
  // The item happening now (or next) gets a marker.
  const current = a.plan.find((p) => p.kind !== 'alarm' && (p.end ?? p.time) >= now);
  return (
    <Section title="Your day">
      <Card>
        {a.plan.map((p, i) => {
          const meta = PLAN_ICON[p.kind];
          const past = (p.end ?? p.time) < now && minutesOfDay(p.time) >= 0 && p.kind !== 'alarm';
          const isCurrent = current?.id === p.id;
          return (
            <Row key={p.id} gap={space.md} style={{ alignItems: 'flex-start', paddingVertical: 8, opacity: past ? 0.45 : 1, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <Text style={[font.h3, { width: 50, fontVariant: ['tabular-nums'], color: isCurrent ? colors.accent : colors.text }]}>{formatTime(p.time)}</Text>
              <Icon name={meta.icon} color={meta.color} />
              <View style={{ flex: 1 }}>
                <Text style={font.body}>
                  {p.title}
                  {p.end ? <Text style={font.small}> · until {formatTime(p.end)}</Text> : null}
                </Text>
                <Text style={font.small}>{p.detail}</Text>
              </View>
              {isCurrent ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 7 }} /> : null}
            </Row>
          );
        })}
      </Card>
    </Section>
  );
}

export function CoachingSection({ a }: A) {
  if (!a.tips.length) return null;
  return (
    <Section title="Coaching">
      {a.tips.slice(0, 3).map((t) => (
        <Card key={t.id}>
          <CardTitle icon={t.icon} title={t.title} />
          <Text style={font.small}>{t.detail}</Text>
        </Card>
      ))}
    </Section>
  );
}

export function InsightsSection({ a }: A) {
  if (!a.insights.length) return null;
  return (
    <Section title="What affects your sleep" action={<Button small kind="ghost" label="All" onPress={() => router.push('/trends')} />}>
      {a.insights.slice(0, 3).map((i) => (
        <Card key={i.id} accent={i.kind === 'negative' ? colors.warn : i.kind === 'positive' ? colors.good : undefined}>
          <Text style={font.h3}>{i.title}</Text>
          <Text style={[font.small, { marginTop: 4 }]}>{i.detail}</Text>
          {i.evidence ? <Text style={[font.tiny, { marginTop: 6 }]}>{i.evidence}</Text> : null}
        </Card>
      ))}
    </Section>
  );
}
