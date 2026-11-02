/**
 * The Planner's occasional tools (shown folded at the bottom): the bedtime calculator, moving your
 * schedule for good, and caffeine in your system. Each renders its content without a card so it
 * can sit inside a Disclosure.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { caffeineCurve } from '@/engine/caffeine';
import { bedtimesForWake, shiftSchedule, wakesForBedtime } from '@/engine/schedule';
import { addDays, atMinutes, formatClock, formatDuration, formatTime, HOUR, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { LineChart } from '@/ui/charts';
import { Button, Icon, Note, Row, Segmented, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

type CalcMode = 'wake' | 'bed' | 'now';

/** "I need to wake at…", "I'll go to bed at…", "If I sleep now…" — options on whole sleep cycles. */
export function BedtimeCalculator({ a }: { a: Analysis }) {
  const workWakeMin = useStore((s) => s.profile.workWakeMin);
  const [mode, setMode] = useState<CalcMode>('wake');
  const [wakeMin, setWakeMin] = useState(workWakeMin);
  const [bedMin, setBedMin] = useState(23 * 60);
  const latency = a.latencyMin;
  const cyc = a.cycleMin;

  let options;
  if (mode === 'wake') {
    let wake = atMinutes(addDays(a.day, 1), wakeMin);
    if (wake - a.now > 24 * HOUR) wake -= 24 * HOUR;
    options = bedtimesForWake(wake, cyc, latency, a.need.needMin);
  } else {
    let bed = a.now;
    if (mode === 'bed') {
      bed = atMinutes(a.day, bedMin);
      if (bed < a.now - 2 * HOUR) bed += 24 * HOUR;
    }
    options = wakesForBedtime(bed, cyc, latency, a.need.needMin);
  }

  return (
    <View>
      <Text style={[font.small, { marginBottom: space.sm }]}>Waking at the end of a sleep cycle feels less groggy. Pick what you know, and see the best times around it.</Text>
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
      <Text style={[font.tiny, { marginBottom: 4 }]}>{mode === 'wake' ? 'GO TO BED AT' : 'WAKE UP AT'}</Text>
      {options.map((o) => (
        <Row key={o.cycles} gap={space.md} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={[font.h3, { minWidth: 76, color: o.recommended ? colors.accent : colors.text }]}>{formatTime(mode === 'wake' ? o.bedtime : o.wake)}</Text>
          <Text style={[font.small, { flex: 1 }]}>
            {o.cycles} cycles · {formatDuration(o.sleepMin)} asleep
          </Text>
          {o.recommended ? <Text style={[font.label, { color: colors.accent }]}>BEST FIT</Text> : o.meetsNeed ? <Icon name="check" color={colors.good} size={16} /> : null}
        </Row>
      ))}
      <Text style={[font.tiny, { marginTop: space.sm }]}>
        Uses your own sleep cycle ({cyc} min), {Math.round(latency)} min to fall asleep and your {formatDuration(a.need.needMin)} sleep need. ✓ = enough sleep.
      </Text>
    </View>
  );
}

/** Move your wake-up for good, step by step, with when to seek and avoid bright light. */
export function ScheduleShift({ a }: { a: Analysis }) {
  const workWakeMin = useStore((s) => s.profile.workWakeMin);
  const [targetWake, setTargetWake] = useState<number | undefined>();
  const habitualWake = a.chronotype.habitual?.wakeMin ?? workWakeMin;
  const target = targetWake ?? normalizeMinutes(Math.round(habitualWake / 15) * 15 - 60);
  const shift = shiftSchedule(Math.round(habitualWake), target, a.tonight.inBedMin, a.day);
  return (
    <View>
      <Text style={font.small}>
        Want to wake earlier or later for good? Move gradually — your body clock shifts about 20 min a day earlier or 30 min a day later. Light at the right time does the
        heavy lifting.
      </Text>
      <Stepper
        label="New wake-up time"
        sub={`You usually wake around ${formatClock(habitualWake)}`}
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
              ☀️ get bright light {formatClock(d.seekLight.startMin)}–{formatClock(d.seekLight.endMin)} · 🕶 avoid it {formatClock(d.avoidLight.startMin)}–
              {formatClock(d.avoidLight.endMin)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

/** Caffeine in your system from this morning to after lights-out, against your bedtime limit. */
export function CaffeineCurve({ a }: { a: Analysis }) {
  const caffeine = useStore((s) => s.caffeine);
  const halfLife = useStore((s) => s.profile.caffeineHalfLifeH);
  const limit = useStore((s) => s.profile.caffeineBedtimeLimitMg);
  const curve = caffeineCurve(
    caffeine.filter((d) => d.time > a.now - 36 * HOUR),
    a.wakeTime,
    a.tonight.bedtime + 3 * HOUR,
    halfLife,
    30,
  );
  return (
    <View>
      <Row style={{ marginBottom: space.sm }}>
        <Text style={[font.small, { flex: 1 }]}>Active now</Text>
        <Text style={[font.h3, { color: colors.caffeine }]}>{Math.round(a.caffeine.nowMg)} mg</Text>
      </Row>
      <LineChart
        values={curve.map((p) => p.mg)}
        labels={curve.map((p) => formatTime(p.t))}
        color={colors.caffeine}
        minY={0}
        reference={{ value: limit, label: `bedtime limit ${limit} mg` }}
        format={(v) => `${Math.round(v)}`}
      />
      <Text style={[font.small, { marginTop: space.sm }]}>
        {a.caffeine.cutoff.cutoff
          ? `Latest coffee (${a.caffeine.cutoff.doseMg} mg) that wears off enough by lights-out (${formatTime(a.tonight.bedtime)}): ${formatTime(a.caffeine.cutoff.cutoff)}.`
          : a.caffeine.cutoff.overLimit
            ? `About ${Math.round(a.caffeine.cutoff.atBedtimeMg)} mg will still be active in early sleep — no more caffeine today.`
            : 'Log your drinks to see your curve.'}
      </Text>
      <Text style={[font.tiny, { marginTop: 4 }]}>Half of the caffeine wears off every {halfLife} h for you (change it in Settings → Caffeine & drinks).</Text>
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        <Button small kind="secondary" icon="plus" label="Log a drink" onPress={() => router.push('/caffeine')} />
        <Button small kind="ghost" label="Caffeine settings" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'caffeine' } })} />
      </Row>
    </View>
  );
}

/** When melatonin rises and the hardest time to fall asleep is, if eepy knows your body clock. */
export function BodyClockNote({ a }: { a: Analysis }) {
  const c = a.chronotype;
  if (c.dlmoMin === undefined || !c.wakeMaintenanceZone || c.cbtMinMin === undefined) return null;
  return (
    <Note tone="info" icon="clock-outline">
      Your body clock tonight: melatonin (the sleep hormone) usually starts rising around {formatClock(c.dlmoMin)}. The hardest time to fall asleep is about{' '}
      {formatClock(c.wakeMaintenanceZone.startMin)}–{formatClock(c.wakeMaintenanceZone.endMin)}, and your body is coolest near {formatClock(c.cbtMinMin)}.
    </Note>
  );
}
