/**
 * The Plan tab's occasional tools, each the content of a folded row: the bedtime calculator, moving
 * your schedule for good, caffeine in your system, and your body clock tonight.
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
import { Button, Icon, KeyValue, styles as kit, Row, Segmented, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, iconSize, space } from '@/ui/theme';

import { Bullet, Caption } from './parts';

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
      <Caption>{mode === 'wake' ? 'Go to bed at' : 'Wake up at'}</Caption>
      <View style={{ marginTop: space.xs }}>
        {options.map((o, i) => (
          <View key={o.cycles}>
            {i ? <View style={kit.listSep} /> : null}
            <Row gap={space.md} style={{ paddingVertical: space.sm }}>
              <Text style={[font.h3, { minWidth: 84, fontVariant: ['tabular-nums'], color: o.recommended ? colors.sleep : colors.text }]}>{formatTime(mode === 'wake' ? o.bedtime : o.wake)}</Text>
              <Text style={[font.small, { flex: 1 }]}>
                {o.cycles} cycles · {formatDuration(o.sleepMin)} asleep
              </Text>
              {o.recommended ? <Caption color={colors.sleep}>Best fit</Caption> : o.meetsNeed ? <Icon name="check" color={colors.good} size={iconSize.sm} /> : null}
            </Row>
          </View>
        ))}
      </View>
      <Text style={[font.tiny, { marginTop: space.sm }]}>
        Waking at the end of a sleep cycle feels less groggy. Uses your own cycle ({cyc} min), {Math.round(latency)} min to fall asleep and your {formatDuration(a.need.needMin)} sleep need. A
        tick means enough sleep.
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
        shift.days.map((d, i) => (
          <View key={d.date}>
            {i ? <View style={kit.listSep} /> : null}
            <View style={{ paddingVertical: space.sm, gap: space.xs }}>
              <Row>
                <Text style={[font.body, { flex: 1 }]}>{dayLabel(d.date)}</Text>
                <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>
                  bed {formatClock(d.bedtimeMin)} · wake {formatClock(d.wakeMin)}
                </Text>
              </Row>
              <Bullet icon="white-balance-sunny" color={colors.energy}>
                Bright light {formatClock(d.seekLight.startMin)}–{formatClock(d.seekLight.endMin)}
              </Bullet>
              <Bullet icon="sunglasses">
                Avoid it {formatClock(d.avoidLight.startMin)}–{formatClock(d.avoidLight.endMin)}
              </Bullet>
            </View>
          </View>
        ))
      )}
      <Text style={[font.tiny, { marginTop: space.sm }]}>Your body clock moves about 20 min a day earlier or 30 min a day later. Light at the right time does most of the work.</Text>
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
      <KeyValue label="Active now" value={`${Math.round(a.caffeine.nowMg)} mg`} color={colors.caffeine} />
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
          ? `Last coffee (${a.caffeine.cutoff.doseMg} mg) by ${formatTime(a.caffeine.cutoff.cutoff)}, so enough has worn off by lights-out at ${formatTime(a.tonight.bedtime)}.`
          : a.caffeine.cutoff.overLimit
            ? `About ${Math.round(a.caffeine.cutoff.atBedtimeMg)} mg will still be active in early sleep. No more caffeine today.`
            : 'Log your drinks to see your curve.'}
      </Text>
      <Text style={[font.tiny, { marginTop: space.xs }]}>Half of the caffeine wears off every {halfLife} h for you.</Text>
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        <Button small kind="secondary" icon="plus" label="Log a drink" onPress={() => router.push('/caffeine')} />
        <Button small kind="ghost" label="Caffeine settings" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'caffeine' } })} />
      </Row>
    </View>
  );
}

/** Whether eepy knows enough about your body clock for `BodyClockRows`. */
export function hasBodyClock(a: Analysis): boolean {
  const c = a.chronotype;
  return c.dlmoMin !== undefined && !!c.wakeMaintenanceZone && c.cbtMinMin !== undefined;
}

/** When melatonin rises, when it is hardest to fall asleep and when your body is coolest. */
export function BodyClockRows({ a }: { a: Analysis }) {
  const c = a.chronotype;
  if (c.dlmoMin === undefined || !c.wakeMaintenanceZone || c.cbtMinMin === undefined) return null;
  return (
    <View>
      <KeyValue label="Melatonin starts rising" sub="The sleep hormone" value={formatClock(c.dlmoMin)} />
      <KeyValue label="Hardest time to fall asleep" value={`${formatClock(c.wakeMaintenanceZone.startMin)}–${formatClock(c.wakeMaintenanceZone.endMin)}`} />
      <KeyValue label="Body coolest" sub="Deepest point of the night" value={formatClock(c.cbtMinMin)} />
    </View>
  );
}
