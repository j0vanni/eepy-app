/** The top of the Today screen, shaped by the time of day (see engine/dayPhase.ts). */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { DayPhaseInput, fallAsleepNowOptions, nightWakeTarget, PHASE } from '@/engine/dayPhase';
import { formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import { useNow } from '@/state/useAnalysis';
import { CalendarNote } from '@/ui/cards/CalendarNote';
import { WindDownCard } from '@/ui/cards/WindDownCard';
import { Button, Card, CardTitle, Icon, Meter, Note, Row } from '@/ui/components';
import { EnterView } from '@/ui/motion';
import { colors, font, radius, space } from '@/ui/theme';
import { CaffeineLiveCard, EnergyCard, LastNightCard, LightNowCard, MorningCheckInCard, NapCard, SleepPressureCard, TonightCard, until, UsualCoffeeCard } from './cards';

type HeroProps = { a: Analysis; now: number };

export function MorningHero({ a, now }: HeroProps) {
  return (
    <>
      {a.lastNightIsCurrent ? (
        <LastNightCard a={a} hero />
      ) : (
        <Card>
          <CardTitle icon="bed-outline" title="Last night" />
          <Text style={font.small}>Your report appears as soon as Nothing X hands last night to Health Connect. Slept without the watch?</Text>
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button small kind="secondary" icon="pencil-plus" label="Log it manually" onPress={() => router.push('/log-sleep')} />
          </View>
        </Card>
      )}
      <MorningCheckInCard a={a} />
      <UsualCoffeeCard />
      <LightNowCard a={a} now={now} />
    </>
  );
}

export function DayHero({ a, now }: HeroProps) {
  return (
    <>
      <EnergyCard a={a} now={now} hero />
      <UsualCoffeeCard />
      <NapCard a={a} />
      <CaffeineLiveCard a={a} />
    </>
  );
}

/** Big live countdowns to wind-down and lights-out. */
function CountdownCard({ a }: { a: Analysis }) {
  const now = useNow(1000);
  const { windDownStart, bedtime } = a.tonight;
  const winding = now >= windDownStart;
  const eveningStart = windDownStart - PHASE.eveningLeadH * HOUR;
  const progress = Math.max(0, Math.min(1, (now - eveningStart) / (bedtime - eveningStart)));
  return (
    <Card accent={colors.light}>
      <Text style={font.tiny}>{winding ? 'WIND-DOWN · LIGHTS OUT IN' : 'LIGHTS OUT IN'}</Text>
      <Text style={[font.stat, { fontSize: 46, lineHeight: 54, color: colors.text, fontVariant: ['tabular-nums'] }]}>{until(bedtime - now)}</Text>
      <Text style={[font.small, { color: colors.text }]}>
        at {formatTime(bedtime)} · alarm {formatTime(a.alarm.alarm)}
        {a.alarm.onBoundary ? ` (${a.alarm.cycles} cycles)` : ''}
      </Text>
      <View style={{ marginTop: space.md }}>
        <Meter value={progress} max={1} color={colors.light} height={6} />
      </View>
      <Row style={{ marginTop: space.md }} gap={space.md}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lightbulb-night-outline" size={20} color={colors.light} />
        </View>
        <View style={{ flex: 1 }}>
          {winding ? (
            <>
              <Text style={font.h3}>Wind-down started {formatDuration(Math.max(1, Math.round((now - windDownStart) / MINUTE)))} ago</Text>
              <Text style={font.small}>Dim the lights, screens away, keep the room cool.</Text>
            </>
          ) : (
            <>
              <Text style={[font.h3, { fontVariant: ['tabular-nums'] }]}>Wind-down in {until(windDownStart - now)}</Text>
              <Text style={font.small}>From {formatTime(windDownStart)}: dim lights and put screens away as melatonin rises.</Text>
            </>
          )}
        </View>
      </Row>
    </Card>
  );
}

export function EveningHero({ a, now }: HeroProps) {
  return (
    <>
      <CountdownCard a={a} />
      {/* Links to the wind-down routine and plays the default sound (same evening window as this hero). */}
      <WindDownCard analysis={a} />
      <Card>
        <CardTitle icon="gauge" title="Sleep pressure" color={colors.light} />
        <SleepPressureCard a={a} now={now} embedded />
      </Card>
      <TonightCard a={a} now={now} detailed />
      <CalendarNote analysis={a} />
    </>
  );
}

const NIGHT_CARD = { backgroundColor: '#0A0E1C', borderColor: '#161C33' };

/** Dimmed, minimal view after lights-out: when to wake if you fall asleep now. */
export function NightView({ a, now, input }: HeroProps & { input: DayPhaseInput }) {
  const afterBedtime = now >= input.bedtime;
  const alarm = nightWakeTarget(now, input);
  // The smart alarm sits in a window before the target wake-up; anything up to the target is fine.
  const latest = afterBedtime ? Math.max(a.tonight.wake, alarm) : alarm;
  const options = fallAsleepNowOptions(now, { cycleMin: a.cycleMin, latencyMin: a.latencyMin, needMin: a.need.needMin, latestWake: latest });
  // The last few options that fit before the alarm, plus the first one that doesn't.
  const fitting = options.filter((o) => o.fitsBeforeWake);
  const late = options.find((o) => !o.fitsBeforeWake);
  const shown = [...fitting.slice(-3), ...(late && fitting.length ? [late] : [])];
  return (
    <EnterView>
      <View style={{ alignItems: 'center', paddingVertical: space.lg }}>
        <Icon name="moon-waning-crescent" size={44} color={colors.light} />
        <Text style={[font.h1, { color: colors.textDim, marginTop: space.sm }]}>Time to sleep</Text>
        <Text style={[font.small, { textAlign: 'center', marginTop: 4 }]}>
          It's {formatTime(now)}
          {afterBedtime ? ` · lights out was ${formatTime(input.bedtime)}` : ''} · alarm {formatTime(alarm)}
        </Text>
      </View>
      <Card style={NIGHT_CARD} animate={false}>
        <Text style={[font.small, { color: colors.textDim }]}>If you fall asleep now (≈{Math.round(a.latencyMin)} min to drift off), wake at the end of a cycle:</Text>
        {fitting.length === 0 ? (
          <Text style={[font.body, { color: colors.textDim, marginTop: space.md }]}>
            Less than one sleep cycle is left before your alarm. Stay in the dark and rest — even dozing helps.
          </Text>
        ) : null}
        <View style={{ marginTop: space.md, gap: space.sm }}>
          {shown.map((o) => (
            <Row
              key={o.cycles}
              gap={space.md}
              style={{
                paddingVertical: 10,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: o.best ? '#3B3570' : 'transparent',
                backgroundColor: o.best ? '#14132B' : 'transparent',
                opacity: o.fitsBeforeWake ? 1 : 0.5,
              }}
            >
              <Text style={[font.h2, { color: o.best ? colors.light : colors.textDim, width: 70, fontVariant: ['tabular-nums'] }]}>{formatTime(o.wake)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[font.small, { color: colors.textDim }]}>
                  {o.cycles} cycle{o.cycles > 1 ? 's' : ''} · {formatDuration(o.sleepMin)} sleep
                </Text>
                {o.best ? (
                  <Text style={[font.tiny, { color: colors.light }]}>{Math.abs(o.wake - alarm) <= 3 * MINUTE ? 'BEST · MATCHES YOUR ALARM' : `BEST · SET YOUR ALARM FOR ${formatTime(o.wake)}`}</Text>
                ) : !o.fitsBeforeWake ? (
                  <Text style={font.tiny}>later than your {formatTime(latest)} wake-up</Text>
                ) : null}
              </View>
            </Row>
          ))}
        </View>
      </Card>
      <Card style={NIGHT_CARD} animate={false} onPress={() => router.push('/winddown')}>
        <Row gap={space.md}>
          <Icon name="weather-night" size={22} color={colors.textFaint} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: colors.textDim }]}>Can't sleep?</Text>
            <Text style={font.tiny}>Breathing and soft noise. If you've been awake 20+ min, get up in dim light until sleepy.</Text>
          </View>
          <Icon name="chevron-right" color={colors.textFaint} />
        </Row>
      </Card>
      {afterBedtime && now - input.bedtime > 2 * HOUR ? (
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
