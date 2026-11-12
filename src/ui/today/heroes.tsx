/**
 * The top of Today. It is about one thing, and which thing depends on the time of day
 * (engine/dayPhase.ts): last night in the morning, energy during the day, the countdown to
 * lights-out in the evening, and the in-bed view at night.
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { curvePosition, DayPhaseInput, fallAsleepNowOptions, nightWakeTarget, PHASE } from '@/engine/dayPhase';
import { isOpen, justNow, tapsNightOffer } from '@/engine/inBed';
import { rundownGlance } from '@/engine/rundown';
import { formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import { sessionFor } from '@/state/inBed';
import { usePlanOptions } from '@/state/planOptions';
import { useRundown } from '@/state/rundown';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { AlarmControl } from '@/ui/cards/AlarmControl';
import { SleepModeLine } from '@/ui/cards/SleepModeLine';
import { EnergyChart, Hypnogram } from '@/ui/charts';
import { Button, Card, Chip, Hero, Icon, ListCard, ListRow, Meter, Note, Row } from '@/ui/components';
import { until } from '@/ui/format';
import { EnterView } from '@/ui/motion';
import { RoutineCheck } from '@/ui/RoutineCheck';
import { colors, font, night as nightColors, radius, scoreColor, space } from '@/ui/theme';
import { WakeCheck } from '@/ui/WakeCheck';
import { CantSleepTip } from './CantSleepTip';
import { MorningWakeRow } from './EarlyUp';
import { InBedButton, SessionHeader, TapsNightCard } from './InBed';
import { StillUpCard } from './StillUp';

type HeroProps = { a: Analysis; now: number };

// ---------------------------------------------------------------------------
// Morning: last night
// ---------------------------------------------------------------------------

const RATINGS = ['😫', '😕', '😐', '🙂', '😄'];

/** Two questions that teach eepy your sleep need, plus "is that when you got up?" when it isn't sure. */
export function MorningCheckIn({ a }: { a: Analysis }) {
  const log = useStore((s) => s.dayLogs[a.day]);
  const logDay = useStore((s) => s.logDay);
  const last = a.lastNightIsCurrent ? a.lastNight?.main : undefined;
  const timeline = last ? a.timelines[last.id] : undefined;
  return (
    <Card>
      {last && timeline ? <WakeCheck m={last} t={timeline} /> : null}
      {last ? <RoutineCheck m={last} t={timeline} compact /> : <MorningWakeRow a={a} now={Date.now()} />}
      <Text style={font.h3}>How did you sleep?</Text>
      <Row gap={space.xs} style={{ marginTop: space.sm, justifyContent: 'space-between' }}>
        {RATINGS.map((r, i) => {
          const selected = log?.sleepRating === i + 1;
          return (
            <Pressable
              key={r}
              onPress={() => logDay(a.day, { sleepRating: i + 1 })}
              style={({ pressed }) => [
                { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.md },
                { backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceAlt : 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Rate last night ${i + 1} of 5`}
            >
              <Text style={{ fontSize: 30, opacity: log?.sleepRating && !selected ? 0.4 : 1 }}>{r}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Text style={[font.h3, { marginTop: space.lg }]}>Did you wake up on your own?</Text>
      <Row gap={space.sm} style={{ marginTop: space.sm }}>
        <Chip label="Yes" icon="weather-sunny" selected={log?.wokeNaturally === true} onPress={() => logDay(a.day, { wokeNaturally: true })} />
        <Chip label="No, alarm or woken" icon="alarm" selected={log?.wokeNaturally === false} onPress={() => logDay(a.day, { wokeNaturally: false })} />
      </Row>
      <Text style={[font.tiny, { marginTop: space.sm }]}>Mornings without an alarm are how eepy learns how much sleep you need.</Text>
    </Card>
  );
}

/** Morning daylight: the one habit that sets the body clock. One tap to tick it off. */
function MorningLight({ a, now }: HeroProps) {
  const done = useStore((s) => s.dayLogs[a.day]?.tags.includes('outdoor-light') ?? false);
  const toggleTag = useStore((s) => s.toggleTag);
  const item = a.plan.find((p) => p.kind === 'light');
  const end = item?.end ?? a.wakeTime + 70 * MINUTE;
  return (
    <ListCard>
      <ListRow
        icon="white-balance-sunny"
        iconColor={colors.energy}
        title={done ? 'Morning light: done' : 'Get daylight'}
        sub={done ? 'It sets your body clock for tonight.' : now > end ? 'Still worth it before noon: 10–30 min outdoors.' : `10–30 min outdoors before ${formatTime(end)}.`}
        right={<Chip label={done ? 'Done' : 'I did'} icon={done ? 'check' : undefined} selected={done} onPress={() => toggleTag(a.day, 'outdoor-light')} />}
      />
    </ListCard>
  );
}

export function MorningHero({ a, now }: HeroProps) {
  const session = useStore((s) => s.settings.session);
  const last = a.lastNightIsCurrent ? a.lastNight?.main : undefined;
  const score = last ? a.scores[last.id] : undefined;
  // No watch night, but you tapped "I'm in bed" and "I'm up": offer those times instead.
  const fromTaps = !!tapsNightOffer(session, { day: a.day, lastNightIsCurrent: a.lastNightIsCurrent, latencyMin: a.latencyMin });
  return (
    <>
      {last && score ? (
        <Hero
          label="Last night"
          value={formatDuration(last.totalSleepMin)}
          caption={`Score ${score.total} · ${score.label.toLowerCase()} · you need ${formatDuration(a.need.needMin)}`}
          onPress={() => router.push({ pathname: '/night/[id]', params: { id: last.id } })}
          right={<Icon name="chevron-right" size={28} color={colors.textFaint} />}
        >
          {a.lastNightStory?.sessionId === last.id ? (
            <Text style={[font.small, { marginTop: space.xs }]} numberOfLines={2}>
              {a.lastNightStory.oneLiner}
            </Text>
          ) : null}
          <View style={{ marginTop: space.md }}>
            <Hypnogram segments={last.segments} start={last.start} end={last.end} height={110} />
          </View>
        </Hero>
      ) : fromTaps ? (
        <TapsNightCard a={a} />
      ) : (
        <Hero label="Last night" value="Not here yet" caption="Your report appears as soon as Nothing X hands last night to Health Connect.">
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button small kind="secondary" icon="pencil-plus" label="Slept without the watch? Log it" onPress={() => router.push('/log-sleep')} />
          </View>
        </Hero>
      )}
      <MorningCheckIn a={a} />
      <MorningLight a={a} now={now} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Day: energy
// ---------------------------------------------------------------------------

/** What the curve is doing right now, in a sentence. */
export function energySentence(a: Analysis, now: number): string | undefined {
  const pos = curvePosition(a.energy, now);
  if (!pos) return undefined;
  if (pos.inDip && a.energy.dip) return `Afternoon dip until ${formatTime(a.energy.dip.end)}. Routine work, a walk or a short nap.`;
  const focus = a.energy.focusWindows.find((w) => now >= w.start && now <= w.end);
  if (focus) return `Peak focus until ${formatTime(focus.end)}. Do the hard thing now.`;
  const next = pos.next;
  if (next?.kind === 'peak') return `${pos.trend === 'falling' ? 'A small lull' : 'Rising'}. Next peak around ${formatTime(next.t)}.`;
  if (next?.kind === 'dip') return `${pos.trend === 'rising' ? 'Still climbing' : 'Easing off'}. Dip starts around ${formatTime(a.energy.dip?.start ?? next.t)}.`;
  if (next?.kind === 'bedtime') return `Winding down toward lights-out at ${formatTime(next.t)}.`;
  return undefined;
}

/** "Sleep debt −14 · Caffeine +3": what is moving the number, at a glance. */
export function energyReasons(a: Analysis): string | undefined {
  const parts = a.energyNow?.parts.filter((p) => p.points !== 0) ?? [];
  if (!parts.length) return undefined;
  return parts
    .sort((x, y) => Math.abs(y.points) - Math.abs(x.points))
    .slice(0, 3)
    .map((p) => `${p.label} ${p.points > 0 ? '+' : '−'}${Math.abs(p.points)}`)
    .join(' · ');
}

export function DayHero({ a, now }: HeroProps) {
  const pos = curvePosition(a.energy, now);
  const napBlock = a.nap.best && a.nap.verdict !== 'skip' ? { start: a.nap.best.start, end: a.nap.best.start + a.nap.best.alarmAfterMin * MINUTE } : undefined;
  const reasons = energyReasons(a);
  return (
    <>
      <TapsNightCard a={a} />
      <Hero
        label="Energy now"
        value={pos ? String(Math.round(pos.energy)) : '–'}
        unit="/ 100"
        color={colors.energy}
        caption={energySentence(a, now)}
        right={pos ? <Icon name={pos.trend === 'rising' ? 'trending-up' : pos.trend === 'falling' ? 'trending-down' : 'trending-neutral'} size={30} color={colors.energy} /> : undefined}
      >
        <View style={{ marginTop: space.md }}>
          <EnergyChart points={a.energy.points} now={now} dip={a.energy.dip} focusWindows={a.energy.focusWindows} nap={napBlock} height={170} />
        </View>
      </Hero>
      <ListCard>
        <ListRow icon="help-circle-outline" title="Why this number" sub={reasons ?? 'Your sleep, your body clock and what your watch saw last night'} onPress={() => router.push('/energy')} />
      </ListCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Evening: the countdown
// ---------------------------------------------------------------------------

export function EveningHero({ a }: HeroProps) {
  const now = useNow(1000);
  const { windDownStart, bedtime } = a.tonight;
  const winding = now >= windDownStart;
  // From wind-down: the one tap that starts the night (unless you already did).
  const inBed = useStore((s) => isOpen(sessionFor(s.settings.session, a)));
  // An option from "Options for tonight" in use.
  const choice = useStore((s) => (s.settings.tonight?.wakeDate === a.tonight.wakeDate ? s.settings.tonight.choice : undefined));
  // Tonight's bedtime rundown at a glance (per minute is plenty).
  const rundown = useRundown(a, Math.floor(now / MINUTE) * MINUTE);
  const eveningStart = windDownStart - PHASE.eveningLeadH * HOUR;
  const progress = Math.max(0, Math.min(1, (now - eveningStart) / (bedtime - eveningStart)));
  return (
    <>
      <Hero
        label={winding ? 'Winding down · lights out in' : 'Lights out in'}
        value={until(bedtime - now)}
        caption={`At ${formatTime(bedtime)}${a.alarm.onBoundary ? ` · ${a.alarm.cycles} sleep cycles to your alarm` : ''}`}
      >
        <View style={{ marginTop: space.md }}>
          <Meter value={progress} max={1} color={colors.sleep} />
        </View>
      </Hero>
      {winding && !inBed ? <InBedButton a={a} /> : null}
      <ListCard>
        <ListRow
          icon="weather-night"
          iconColor={colors.sleep}
          title={winding ? `Wind-down started ${formatDuration(Math.max(1, Math.round((now - windDownStart) / MINUTE)))} ago` : `Wind-down in ${until(windDownStart - now)}`}
          sub={rundown ? rundownGlance(rundown) : winding ? 'Dim the lights, screens away, keep the room cool.' : `From ${formatTime(windDownStart)}: dim lights, screens away.`}
          onPress={() => router.push('/winddown')}
        />
        <ListRow
          icon="clock-edit-outline"
          title={choice ? `Using “${choice.title}” tonight` : a.tonight.adjusted ? 'Adjusted for tonight' : `Can't make ${formatTime(bedtime)}?`}
          sub={choice ? 'See the other options' : a.tonight.adjusted ? `The plan was ${formatTime(a.tonight.adjusted.plannedBedtime)} · change` : 'Move tonight’s bedtime'}
          onPress={() => (choice ? router.navigate({ pathname: '/planner', params: { show: 'tonight' } }) : router.push('/tonight'))}
        />
      </ListCard>
      <Card>
        <AlarmControl a={a} />
        <SleepModeLine a={a} />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

const NIGHT_PANEL = { backgroundColor: nightColors.surface };

/**
 * Dimmed, minimal view after lights-out: the big "I'm in bed" (or, once tapped, the running sleep
 * session) and when to wake if you fall asleep now.
 */
export function NightView({ a, now, input }: HeroProps & { input: DayPhaseInput }) {
  const stored = useStore((s) => s.settings.session);
  const session = sessionFor(stored, a);
  // The session header covers a session that runs, or ended a moment ago (its Undo) — on its own 10-s clock.
  const clock = useNow(10_000);
  const showSession = !!session && (isOpen(session) || (session.closed === 'up' && justNow(session.closedAt, clock)));
  const afterBedtime = now >= input.bedtime;
  const alarm = nightWakeTarget(now, input);
  // The smart alarm sits in a window before the target wake-up; anything up to the target is fine.
  // On a two-step morning the main stretch ends at the routine alarm, not the final wake-up.
  const latest = afterBedtime ? Math.max(a.tonight.twoStep?.firstWake ?? a.tonight.wake, alarm) : alarm;
  const options = fallAsleepNowOptions(now, { cycleMin: a.cycleMin, latencyMin: a.latencyMin, needMin: a.need.needMin, latestWake: latest });
  // The last few options that fit before the alarm, plus the first one that doesn't.
  const fitting = options.filter((o) => o.fitsBeforeWake);
  const late = options.find((o) => !o.fitsBeforeWake);
  const shown = [...fitting.slice(-3), ...(late && fitting.length ? [late] : [])];
  // Past lights-out and not in bed: "Still up?" re-plans the rest of the night (engine/planOptions.ts).
  const replan = usePlanOptions(a, now);
  const stillUp = afterBedtime && !showSession && !!replan?.options.some((o) => o.bedtime >= now);
  return (
    <EnterView>
      {showSession ? (
        <SessionHeader a={a} />
      ) : (
        <Hero
          dim
          value="Time to sleep"
          caption={`It's ${formatTime(now)}${afterBedtime ? ` · lights out was ${formatTime(input.bedtime)}` : ''} · alarm ${formatTime(alarm)}`}
        >
          {afterBedtime && !stillUp ? (
            <Pressable onPress={() => router.push('/tonight')} hitSlop={8} accessibilityRole="button" style={{ marginTop: space.sm }}>
              <Text style={[font.small, { color: colors.accent, fontWeight: '700' }]}>Still up? Re-plan the rest of the night</Text>
            </Pressable>
          ) : null}
        </Hero>
      )}
      {showSession ? null : (
        <View style={{ marginBottom: space.lg }}>
          <InBedButton a={a} night />
        </View>
      )}
      {stillUp ? <StillUpCard a={a} now={now} /> : null}
      <Card style={NIGHT_PANEL} animate={false}>
        <Text style={[font.small, { color: nightColors.text }]}>If you fall asleep now (≈{Math.round(a.latencyMin)} min to drift off), wake at the end of a cycle:</Text>
        {fitting.length === 0 ? (
          <Text style={[font.body, { color: nightColors.text, marginTop: space.md }]}>Less than one sleep cycle is left before your alarm. Stay in the dark and rest — even dozing helps.</Text>
        ) : null}
        <View style={{ marginTop: space.md, gap: space.xs }}>
          {shown.map((o) => (
            <Row
              key={o.cycles}
              gap={space.md}
              style={{ paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: o.best ? colors.sleepSoft : 'transparent', opacity: o.fitsBeforeWake ? 1 : 0.5 }}
            >
              <Text style={[font.h2, { color: o.best ? colors.sleep : nightColors.text, width: 100, fontVariant: ['tabular-nums'] }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatTime(o.wake)}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[font.small, { color: nightColors.text }]}>
                  {o.cycles} cycle{o.cycles > 1 ? 's' : ''} · {formatDuration(o.sleepMin)} sleep
                </Text>
                {o.best ? (
                  <Text style={[font.tiny, { color: colors.sleep }]}>{Math.abs(o.wake - alarm) <= 3 * MINUTE ? 'Best · matches your alarm' : `Best · set your alarm for ${formatTime(o.wake)}`}</Text>
                ) : !o.fitsBeforeWake ? (
                  <Text style={font.tiny}>later than your {formatTime(latest)} wake-up</Text>
                ) : null}
              </View>
            </Row>
          ))}
        </View>
      </Card>
      <Card style={NIGHT_PANEL} animate={false} onPress={() => router.push('/winddown')}>
        <Row gap={space.md}>
          <Icon name="weather-night" size={22} color={colors.textFaint} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: nightColors.text }]}>Can't sleep?</Text>
            <CantSleepTip />
          </View>
          <Icon name="chevron-right" color={colors.textFaint} />
        </Row>
      </Card>
      {/* Up late and want to log how you feel. */}
      <View style={{ alignItems: 'center', marginBottom: space.md }}>
        <Button small kind="ghost" icon="emoticon-happy-outline" label="Check in" onPress={() => router.push('/checkin')} />
      </View>
      {afterBedtime && !showSession && now - input.bedtime > 2 * HOUR ? (
        <Note tone="info" icon="clock-outline">
          You're up {formatDuration((now - input.bedtime) / MINUTE)} past lights-out. Keep the screen short and dim.
        </Note>
      ) : null}
    </EnterView>
  );
}

/** "Show the rest of today" toggle under the night view. */
export function NightMoreToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={{ alignItems: 'center', paddingVertical: space.md }} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <Row gap={4}>
        <Text style={[font.small, { color: colors.textFaint }]}>{open ? 'Hide today’s details' : 'Show today’s details'}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
      </Row>
    </Pressable>
  );
}

export { scoreColor };
