import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { caffeineCurve } from '@/engine/caffeine';
import { bedtimesForWake, shiftSchedule, wakesForBedtime } from '@/engine/schedule';
import { addDays, atMinutes, formatClock, formatDuration, formatTime, HOUR, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { PlanCalendarLines } from '@/ui/cards/CalendarNote';
import { LineChart } from '@/ui/charts';
import { Button, Card, CardTitle, Empty, Icon, ListRow, Note, Row, Screen, Section, Segmented, Stat, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

type CalcMode = 'wake' | 'bed' | 'now';

export default function PlanScreen() {
  const a = useAnalysis();
  const profile = useStore((s) => s.profile);
  const caffeine = useStore((s) => s.caffeine);
  const [mode, setMode] = useState<CalcMode>('wake');
  const [wakeMin, setWakeMin] = useState(profile.workWakeMin);
  const [bedMin, setBedMin] = useState(23 * 60);
  const [targetWake, setTargetWake] = useState<number | undefined>();

  if (!a) {
    return (
      <Screen title="Plan">
        <Empty icon="calendar-clock" title="Nothing to plan yet" body="Once eepy has a few nights of data it will plan your bedtime, alarm and caffeine around your body clock." />
      </Screen>
    );
  }

  const latency = a.latencyMin;
  const cyc = a.cycleMin;
  const tomorrow = addDays(a.day, 1);
  let options;
  if (mode === 'wake') {
    let wake = atMinutes(tomorrow, wakeMin);
    if (wake - a.now > 24 * HOUR) wake -= 24 * HOUR;
    options = bedtimesForWake(wake, cyc, latency, a.need.needMin);
  } else {
    const bed = mode === 'now' ? a.now : (() => {
      let b = atMinutes(a.day, bedMin);
      if (b < a.now - 2 * HOUR) b += 24 * HOUR;
      return b;
    })();
    options = wakesForBedtime(bed, cyc, latency, a.need.needMin);
  }

  const habitualWake = a.chronotype.habitual?.wakeMin ?? profile.workWakeMin;
  const target = targetWake ?? normalizeMinutes(Math.round(habitualWake / 15) * 15 - 60);
  const shift = shiftSchedule(Math.round(habitualWake), target, a.tonight.inBedMin, a.day);

  const curveFrom = a.wakeTime;
  const curve = caffeineCurve(
    caffeine.filter((d) => d.time > a.now - 36 * HOUR),
    curveFrom,
    a.tonight.bedtime + 3 * HOUR,
    profile.caffeineHalfLifeH,
    30,
  );

  return (
    <Screen title="Plan" subtitle="Tonight, tomorrow, and beyond">
      <Card>
        <CardTitle icon="moon-waning-crescent" title={`Tonight → ${dayLabel(a.tonight.wakeDate)} ${a.tonight.isWorkday ? '(workday)' : '(free day)'}`} />
        <Row>
          <Stat label="Wind down" value={formatTime(a.tonight.windDownStart)} />
          <Stat label="Lights out" value={formatTime(a.tonight.bedtime)} color={colors.accent} />
          <Stat label="Wake" value={formatTime(a.tonight.wake)} sub={a.tonight.calendar?.drove ? `usually ${formatTime(a.tonight.calendar.usualWake)}` : undefined} />
        </Row>
        <Text style={[font.small, { marginTop: space.md }]}>Time in bed: {formatDuration(a.tonight.inBedMin)}</Text>
        <Text style={font.small}>
          Last big meal by {formatTime(a.tonight.lastMeal)} · hard exercise done by {formatTime(a.tonight.lastExercise)}
        </Text>
        {a.tonight.rationale.map((r) => {
          const fromCalendar = !!a.tonight.calendar?.reasons.includes(r);
          return (
            <Row key={r} gap={space.sm} style={{ alignItems: 'flex-start', marginTop: 6 }}>
              <Icon name={fromCalendar ? 'calendar-clock' : 'circle-small'} color={colors.accent} size={fromCalendar ? 17 : 20} />
              <Text style={[font.small, { flex: 1 }, fromCalendar ? { color: colors.text } : null]}>{r}</Text>
            </Row>
          );
        })}
        <PlanCalendarLines analysis={a} />
      </Card>

      <Card>
        <CardTitle icon="alarm" title="Smart alarm" color={colors.energy} />
        <Text style={font.body}>
          {a.alarm.onBoundary
            ? `Set your alarm for ${formatTime(a.alarm.alarm)} — the end of your ${a.alarm.cycles}th predicted sleep cycle, inside the 30 minutes before ${formatTime(a.tonight.wake)}.`
            : `No cycle boundary lands in the 30 minutes before ${formatTime(a.tonight.wake)}, so keep your alarm at ${formatTime(a.alarm.alarm)}.`}
        </Text>
        <Text style={[font.small, { marginTop: space.sm }]}>
          Based on your {cyc}-minute cycle length and {Math.round(latency)} minutes to fall asleep. Turn on "Wake alarm" in Settings → Notifications to have eepy ring at
          this time (your watch's own alarm works too).
        </Text>
      </Card>

      <Section title="Bedtime calculator">
        <Card>
          <Segmented<CalcMode>
            value={mode}
            onChange={setMode}
            options={[
              { label: 'Wake up at', value: 'wake' },
              { label: 'Go to bed at', value: 'bed' },
              { label: 'Sleep now', value: 'now' },
            ]}
          />
          {mode === 'wake' ? (
            <Stepper label="I need to wake at" value={formatClock(wakeMin)} onDec={() => setWakeMin(normalizeMinutes(wakeMin - 15))} onInc={() => setWakeMin(normalizeMinutes(wakeMin + 15))} />
          ) : mode === 'bed' ? (
            <Stepper label="I'll go to bed at" value={formatClock(bedMin)} onDec={() => setBedMin(normalizeMinutes(bedMin - 15))} onInc={() => setBedMin(normalizeMinutes(bedMin + 15))} />
          ) : (
            <Text style={[font.small, { marginVertical: space.md }]}>If you lie down now ({formatTime(a.now)}), wake up at:</Text>
          )}
          {options.map((o) => (
            <Row key={o.cycles} gap={space.md} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={[font.h3, { width: 60, color: o.recommended ? colors.accent : colors.text }]}>{formatTime(mode === 'wake' ? o.bedtime : o.wake)}</Text>
              <Text style={[font.small, { flex: 1 }]}>
                {o.cycles} cycles · {formatDuration(o.sleepMin)} asleep
              </Text>
              {o.recommended ? <Text style={[font.tiny, { color: colors.accent }]}>BEST FIT</Text> : o.meetsNeed ? <Icon name="check" color={colors.good} size={16} /> : null}
            </Row>
          ))}
          <Text style={[font.tiny, { marginTop: space.sm }]}>
            Uses your personal cycle length ({cyc} min), {Math.round(latency)} min to fall asleep and {formatDuration(a.need.needMin)} sleep need.
          </Text>
        </Card>
      </Section>

      <Section title="Caffeine">
        <Card>
          <CardTitle icon="coffee-outline" title="Caffeine in your system" color={colors.caffeine} right={<Text style={font.h3}>{Math.round(a.caffeine.nowMg)} mg</Text>} />
          <LineChart
            values={curve.map((p) => p.mg)}
            labels={curve.map((p) => formatTime(p.t))}
            color={colors.caffeine}
            minY={0}
            reference={{ value: profile.caffeineBedtimeLimitMg, label: `bedtime limit ${profile.caffeineBedtimeLimitMg} mg` }}
            format={(v) => `${Math.round(v)}`}
          />
          <Text style={[font.small, { marginTop: space.sm }]}>
            {a.caffeine.cutoff.cutoff
              ? `Latest coffee (${a.caffeine.cutoff.doseMg} mg) that clears enough by ${formatTime(a.tonight.bedtime)}: ${formatTime(a.caffeine.cutoff.cutoff)}.`
              : a.caffeine.cutoff.overLimit
                ? `You'll have ~${Math.round(a.caffeine.cutoff.atBedtimeMg)} mg active in early sleep — no more caffeine today.`
                : 'Log drinks in the Journal to see your curve.'}{' '}
            Half-life {profile.caffeineHalfLifeH} h (change in Settings).
          </Text>
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button small kind="secondary" icon="plus" label="Log a drink" onPress={() => router.push('/journal')} />
          </View>
        </Card>
      </Section>

      <Section title="Shift your schedule">
        <Card>
          <Text style={font.small}>
            Want to wake earlier or later for good? Move gradually — your body clock can shift about 20 min/day earlier or 30 min/day later. Bright light timing does
            the heavy lifting.
          </Text>
          <Stepper
            label="Target wake time"
            sub={`Now about ${formatClock(habitualWake)}`}
            value={formatClock(target)}
            onDec={() => setTargetWake(normalizeMinutes(target - 15))}
            onInc={() => setTargetWake(normalizeMinutes(target + 15))}
          />
          {shift.direction === 'none' ? (
            <Text style={font.small}>That's already your schedule.</Text>
          ) : (
            shift.days.map((d) => (
              <View key={d.date} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Row>
                  <Text style={[font.h3, { flex: 1 }]}>{dayLabel(d.date)}</Text>
                  <Text style={font.small}>
                    bed {formatClock(d.bedtimeMin)} · wake {formatClock(d.wakeMin)}
                  </Text>
                </Row>
                <Text style={font.tiny}>
                  ☀️ seek light {formatClock(d.seekLight.startMin)}–{formatClock(d.seekLight.endMin)} · 🕶 avoid {formatClock(d.avoidLight.startMin)}–
                  {formatClock(d.avoidLight.endMin)}
                </Text>
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title="Travel">
        <Card>
          <ListRow icon="tune-variant" title="What if?" sub="Try a bedtime, nap or coffee and see how tomorrow changes" onPress={() => router.push('/simulate')} />
          <ListRow icon="airplane-clock" title="Jet lag planner" sub="Day-by-day sleep and light plan for crossing time zones" onPress={() => router.push('/jetlag')} />
        </Card>
      </Section>

      {a.chronotype.dlmoMin !== undefined ? (
        <Section title="Your body clock tonight">
          <Note tone="info" icon="clock-outline">
            Melatonin typically starts rising around {formatClock(a.chronotype.dlmoMin)} for you, and the hardest time to fall asleep (the "wake-maintenance zone") is about{' '}
            {formatClock(a.chronotype.wakeMaintenanceZone!.startMin)}–{formatClock(a.chronotype.wakeMaintenanceZone!.endMin)}. Your body temperature bottoms out near{' '}
            {formatClock(a.chronotype.cbtMinMin!)}.
          </Note>
        </Section>
      ) : null}
    </Screen>
  );
}
