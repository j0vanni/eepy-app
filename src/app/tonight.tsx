import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { smartAlarm } from '@/engine/schedule';
import { simulateTomorrow } from '@/engine/simulate';
import { formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Chip, Empty, Note, Row, Screen, Stat, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

const STEP = 15 * MINUTE;
const LATER = [
  { min: 30, label: '+30 min' },
  { min: 60, label: '+1 h' },
  { min: 90, label: '+1½ h' },
  { min: 120, label: '+2 h' },
];
const roundUp5 = (t: number) => Math.ceil(t / (5 * MINUTE)) * 5 * MINUTE;
const signed = (min: number) => `${min >= 0 ? '+' : '−'}${formatDuration(Math.abs(min))}`;

/**
 * "Can't make it tonight": pick tonight's own lights-out (and wake-up), see what it does to
 * tomorrow, and use it — reminders, the alarm, the caffeine cut-off and the forecast all follow.
 * Only this night changes; the plan returns tomorrow.
 */
export default function AdjustTonight() {
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
  const override = useStore((s) => s.settings.tonight);
  const setSettings = useStore((s) => s.setSettings);
  const [now] = useState(() => Date.now());
  const minBed = roundUp5(now);
  const [bed, setBed] = useState(() => (a ? Math.max(a.tonight.bedtime, minBed) : minBed));
  const [wake, setWake] = useState(() => a?.tonight.wake ?? now + 8 * HOUR);

  const plannedBed = a ? (a.tonight.adjusted?.plannedBedtime ?? a.tonight.bedtime) : 0;
  const plannedWake = a ? (a.tonight.adjusted?.plannedWake ?? a.tonight.wake) : 0;
  const sims = useMemo(() => {
    if (!a) return undefined;
    return {
      plan: simulateTomorrow(a, data, { bedtime: Math.max(plannedBed, minBed), wake: plannedWake }).scenario,
      mine: simulateTomorrow(a, data, { bedtime: bed, wake }).scenario,
    };
  }, [a, data, plannedBed, plannedWake, minBed, bed, wake]);

  if (!a || !sims) {
    return (
      <Screen>
        <Empty icon="calendar-clock" title="Nothing to adjust yet" body="Once eepy has a night of data it plans tonight, and you can move it here." />
      </Screen>
    );
  }

  const { plan, mine } = sims;
  const alarm = smartAlarm(bed, wake, a.cycleMin, a.latencyMin);
  const changed = bed !== plannedBed || wake !== plannedWake;
  const shortBy = Math.round(plan.sleep.sleepMin - mine.sleep.sleepMin);
  const setBedClamped = (t: number) => setBed(Math.max(minBed, Math.min(t, wake - 90 * MINUTE)));
  const setWakeClamped = (t: number) => setWake(Math.max(bed + 90 * MINUTE, t));

  const tips: string[] = [];
  if (shortBy >= 45 && mine.tomorrow.dip) {
    tips.push(`Tomorrow, a 20-minute nap around ${formatTime(mine.tomorrow.dip.t)} takes the edge off without spoiling the next night.`);
  }
  if (shortBy >= 45) tips.push("Keep coffee to the morning — chasing the tiredness with a late one makes tomorrow night short too.");
  if (wake - plannedWake >= HOUR && a.tonight.isWorkday === false) tips.push('Sleeping in more than an hour shifts your body clock; tomorrow night may feel later than usual.');
  if (mine.sleep.latencyParts.earlyBedMin >= 15) tips.push(`That's earlier than your body is usually ready — expect ~${Math.round(mine.sleep.latencyParts.earlyBedMin)} extra minutes awake in bed.`);
  if (mine.debtMin - plan.debtMin >= 30) tips.push("eepy adds a little extra sleep to the next nights' plans to pay this back — no need to make it all up at once.");
  if (!mine.sleep.onBoundary) {
    tips.push(`Waking at ${formatTime(mine.sleep.boundaryWakes.earlier)} or ${formatTime(mine.sleep.boundaryWakes.later)} lands at the end of a sleep cycle (less groggy).`);
  }

  const done = () => {
    confirmHaptic();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const save = () => {
    setSettings({
      tonight: changed
        ? {
            wakeDate: a.tonight.wakeDate,
            ...(bed !== plannedBed ? { bedtime: bed } : {}),
            ...(wake !== plannedWake ? { wake } : {}),
          }
        : undefined,
    });
    done();
  };
  const reset = () => {
    setSettings({ tonight: undefined });
    done();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Adjust tonight' }} />
      <Text style={[font.small, { marginBottom: space.md }]}>
        eepy's plan: lights out {formatTime(plannedBed)}, up {formatTime(plannedWake)} {dayLabel(a.tonight.wakeDate).toLowerCase()}. Can't make it? Pick what works — only tonight changes.
      </Text>

      <Card>
        <CardTitle icon="bed-clock" title="Lights out" color={colors.accent} right={<Text style={font.small}>{bed !== plannedBed ? signed(Math.round((bed - plannedBed) / MINUTE)) : 'as planned'}</Text>} />
        <Text style={[font.stat, { color: colors.accent, textAlign: 'center' }]}>{formatTime(bed)}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
          {plannedBed >= minBed ? <Chip label={`Plan · ${formatTime(plannedBed)}`} selected={bed === plannedBed} onPress={() => setBedClamped(plannedBed)} /> : null}
          {LATER.map(({ min, label }) => {
            const t = Math.max(plannedBed, minBed) + min * MINUTE;
            return <Chip key={min} label={label} selected={bed === t} onPress={() => setBedClamped(t)} />;
          })}
          {now > plannedBed ? <Chip label="Now" selected={bed === minBed} onPress={() => setBedClamped(minBed)} /> : null}
        </View>
        <Stepper label="Fine-tune" sub="15-minute steps" value={formatTime(bed)} onDec={() => setBedClamped(bed - STEP)} onInc={() => setBedClamped(bed + STEP)} />
      </Card>

      <Card>
        <CardTitle icon="weather-sunset-up" title="Wake-up" color={colors.energy} right={<Text style={font.small}>{wake !== plannedWake ? signed(Math.round((wake - plannedWake) / MINUTE)) : 'as planned'}</Text>} />
        <Stepper label={a.tonight.isWorkday ? 'Workday — keep it if you can' : 'Free day'} value={formatTime(wake)} onDec={() => setWakeClamped(wake - STEP)} onInc={() => setWakeClamped(wake + STEP)} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip label={`Keep ${formatTime(plannedWake)}`} selected={wake === plannedWake} onPress={() => setWakeClamped(plannedWake)} />
          {!mine.sleep.onBoundary ? (
            <>
              <Chip icon="sine-wave" label={formatTime(mine.sleep.boundaryWakes.earlier)} onPress={() => setWakeClamped(mine.sleep.boundaryWakes.earlier)} />
              <Chip icon="sine-wave" label={formatTime(mine.sleep.boundaryWakes.later)} onPress={() => setWakeClamped(mine.sleep.boundaryWakes.later)} />
            </>
          ) : null}
        </View>
        <Text style={[font.small, { marginTop: space.sm }]}>
          Alarm {formatTime(alarm.alarm)}
          {alarm.onBoundary ? ` — the end of your ${alarm.cycles}${alarm.cycles === 1 ? 'st' : alarm.cycles === 2 ? 'nd' : alarm.cycles === 3 ? 'rd' : 'th'} sleep cycle` : ''}.
        </Text>
      </Card>

      <Card>
        <CardTitle icon="crystal-ball" title="What it means" />
        <Row>
          <Stat label="Sleep" value={formatDuration(mine.sleep.sleepMin)} sub={shortBy ? `${signed(-shortBy)} vs plan` : `need ${formatDuration(a.need.needMin)}`} color={shortBy >= 45 ? colors.warn : undefined} />
          <Stat label="Tomorrow's energy" value={String(Math.round(mine.tomorrow.avgEnergy))} sub={`plan ${Math.round(plan.tomorrow.avgEnergy)}`} />
          <Stat label="Debt after" value={formatDuration(mine.debtMin)} sub={`plan ${formatDuration(plan.debtMin)}`} />
        </Row>
        <Text style={[font.tiny, { marginTop: space.sm }]}>
          Focus time tomorrow: {mine.tomorrow.focusHours.toFixed(1)} h (plan {plan.tomorrow.focusHours.toFixed(1)} h). Expected sleep score {Math.round(mine.score.total)}.
        </Text>
      </Card>

      {tips.length ? (
        <Card>
          <CardTitle icon="lifebuoy" title="Making the most of it" />
          <View style={{ gap: 6 }}>
            {tips.map((t) => (
              <Text key={t} style={font.small}>
                • {t}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}

      {mine.caffeineMg > 20 ? <Note tone="warn">About {Math.round(mine.caffeineMg)} mg of caffeine will still be active when you lie down.</Note> : null}

      <Row gap={space.sm} style={{ marginTop: space.lg }}>
        {override ? (
          <View style={{ flex: 1 }}>
            <Button kind="secondary" icon="restore" label="Back to plan" onPress={reset} />
          </View>
        ) : null}
        <View style={{ flex: 2 }}>
          <Button icon="check" label={changed ? 'Use for tonight' : 'Keep the plan'} onPress={save} />
        </View>
      </Row>
      <Text style={[font.tiny, { marginTop: space.sm, textAlign: 'center' }]}>Wind-down and lights-out reminders, the alarm and the caffeine cut-off move with it.</Text>
    </Screen>
  );
}
