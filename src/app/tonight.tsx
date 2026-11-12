/**
 * Adjust tonight: pick tonight's own lights-out (and wake-up), see what it does to tomorrow, and
 * use it — reminders, the alarm, the caffeine cut-off and the forecast all follow. Only this night
 * changes; the plan returns tomorrow.
 */
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { smartAlarm } from '@/engine/schedule';
import { simulateTomorrow } from '@/engine/simulate';
import { formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Chip, Empty, Fold, Note, Row, Screen, Section, Stat, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { confirmHaptic } from '@/ui/haptics';
import { Bullet } from '@/ui/planner/parts';
import { ordinal } from '@/ui/planner/planText';
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
const versusPlan = (ms: number) => (ms ? `${signed(Math.round(ms / MINUTE))} vs the plan` : 'as planned');

export default function AdjustTonight() {
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
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
  if (shortBy >= 45 && mine.tomorrow.dip) tips.push(`Tomorrow, a 20-minute nap around ${formatTime(mine.tomorrow.dip.t)} takes the edge off without spoiling the next night.`);
  if (shortBy >= 45) tips.push('Keep coffee to the morning. Chasing the tiredness with a late one makes tomorrow night short too.');
  if (wake - plannedWake >= HOUR && a.tonight.isWorkday === false) tips.push('Sleeping in more than an hour shifts your body clock; tomorrow night may feel later than usual.');
  if (mine.sleep.latencyParts.earlyBedMin >= 15) tips.push(`That's earlier than your body is usually ready: expect about ${Math.round(mine.sleep.latencyParts.earlyBedMin)} extra minutes awake in bed.`);
  if (mine.debtMin - plan.debtMin >= 30) tips.push("eepy adds a little extra sleep to the next nights' plans to pay this back. No need to make it all up at once.");
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
    <Screen subtitle={`The plan is lights out ${formatTime(plannedBed)}, up ${formatTime(plannedWake)} ${dayLabel(a.tonight.wakeDate).toLowerCase()}. Pick what works: only tonight changes.`}>
      <Stack.Screen options={{ title: 'Adjust tonight' }} />

      <Card>
        <CardTitle title="Lights out" right={<Text style={font.small}>{versusPlan(bed - plannedBed)}</Text>} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {plannedBed >= minBed ? <Chip label={`Plan · ${formatTime(plannedBed)}`} selected={bed === plannedBed} onPress={() => setBedClamped(plannedBed)} /> : null}
          {LATER.map(({ min, label }) => {
            const t = Math.max(plannedBed, minBed) + min * MINUTE;
            return <Chip key={min} label={label} selected={bed === t} onPress={() => setBedClamped(t)} />;
          })}
          {now > plannedBed ? <Chip label="Now" selected={bed === minBed} onPress={() => setBedClamped(minBed)} /> : null}
        </View>
        <View style={{ marginTop: space.sm }}>
          <Stepper label="Fine-tune" sub="15-minute steps" value={formatTime(bed)} onDec={() => setBedClamped(bed - STEP)} onInc={() => setBedClamped(bed + STEP)} />
        </View>
      </Card>

      <Card>
        <CardTitle title="Wake-up" right={<Text style={font.small}>{versusPlan(wake - plannedWake)}</Text>} />
        <Stepper
          label={a.tonight.isWorkday ? 'Workday' : 'Free day'}
          sub={a.tonight.isWorkday ? 'Keep it if you can' : '15-minute steps'}
          value={formatTime(wake)}
          onDec={() => setWakeClamped(wake - STEP)}
          onInc={() => setWakeClamped(wake + STEP)}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs }}>
          <Chip label={`Keep ${formatTime(plannedWake)}`} selected={wake === plannedWake} onPress={() => setWakeClamped(plannedWake)} />
          {!mine.sleep.onBoundary ? (
            <>
              <Chip icon="sine-wave" label={formatTime(mine.sleep.boundaryWakes.earlier)} onPress={() => setWakeClamped(mine.sleep.boundaryWakes.earlier)} />
              <Chip icon="sine-wave" label={formatTime(mine.sleep.boundaryWakes.later)} onPress={() => setWakeClamped(mine.sleep.boundaryWakes.later)} />
            </>
          ) : null}
        </View>
        {!mine.sleep.onBoundary ? <Text style={[font.tiny, { marginTop: space.sm }]}>The two other times end a sleep cycle, so you wake less groggy.</Text> : null}
      </Card>

      <Section title="What it means">
        <Card>
          <Row>
            <Stat label="Sleep" value={formatDuration(mine.sleep.sleepMin)} sub={shortBy ? `${signed(-shortBy)} vs plan` : `need ${formatDuration(a.need.needMin)}`} color={shortBy >= 45 ? colors.warn : undefined} />
            <Stat label="Alarm" value={formatTime(alarm.alarm)} sub={alarm.onBoundary ? `end of ${ordinal(alarm.cycles)} cycle` : 'mid-cycle'} />
          </Row>
          <Row style={{ marginTop: space.md }}>
            <Stat label="Energy tomorrow" value={String(Math.round(mine.tomorrow.avgEnergy))} sub={`plan ${Math.round(plan.tomorrow.avgEnergy)}`} />
            <Stat label="Debt after" value={formatDuration(mine.debtMin)} sub={`plan ${formatDuration(plan.debtMin)}`} />
          </Row>
          <Text style={[font.tiny, { marginTop: space.md }]}>
            Energy is tomorrow's average. Focus time tomorrow {mine.tomorrow.focusHours.toFixed(1)} h (plan {plan.tomorrow.focusHours.toFixed(1)} h) · expected sleep score{' '}
            {Math.round(mine.score.total)}.
          </Text>
        </Card>
        {mine.caffeineMg > 20 ? <Note tone="warn">About {Math.round(mine.caffeineMg)} mg of caffeine will still be active when you lie down.</Note> : null}
        {tips.length ? (
          <Fold icon="lifebuoy" title="Making the most of it" sub={`${tips.length} tip${tips.length > 1 ? 's' : ''} for this night`}>
            <View style={{ gap: space.sm }}>
              {tips.map((t) => (
                <Bullet key={t} icon="circle-small" color={colors.textFaint}>
                  {t}
                </Bullet>
              ))}
            </View>
          </Fold>
        ) : null}
      </Section>

      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Button icon="check" label={changed ? 'Use this' : 'Keep the plan'} onPress={save} />
        {changed ? <Button kind="ghost" icon="restore" label="Back to the plan" onPress={reset} /> : null}
      </View>
      <Text style={[font.tiny, { marginTop: space.sm, textAlign: 'center' }]}>The wind-down and lights-out reminders, the alarm and the caffeine cut-off move with it.</Text>
    </Screen>
  );
}
