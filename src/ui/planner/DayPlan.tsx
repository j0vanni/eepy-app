/**
 * Planning one morning — shared by the Plan tab's day panel and the month view: the wake-up
 * choice (usual / a set time / free day), the routine alarm on or off for that morning (two-step
 * mornings), the night before, and why a night is earlier, shorter or longer than usual.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { BODY_CLOCK, wakeTargetFor } from '@/engine/schedule';
import { formatClock, formatDuration, formatTime, normalizeMinutes, weekdayOfKey } from '@/engine/time';
import { checkTwoStep, twoStepByWeek, twoStepSetting } from '@/engine/twoStep';
import type { DayWakePlan } from '@/engine/types';
import type { UpcomingNight } from '@/engine/weekPlan';
import { setWakePlanFor } from '@/state/routineSkip';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Row, Segmented, Stat, Stepper } from '@/ui/components';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, space } from '@/ui/theme';

import { Bullet, Caption } from './parts';
import { DAY_NAMES, wakeChoiceHint } from './planText';

/** How far ahead mornings can be planned. */
export const PLAN_AHEAD_DAYS = 90;

/** Saves (or clears) one morning's wake plan (state/routineSkip.setWakePlanFor). */
export function useSetWakePlan(): (date: string, plan: DayWakePlan | undefined) => void {
  return (date, plan) => setWakePlanFor(date, plan);
}

/** The weekly-pattern wake-up for a date, ignoring anything set for that day. */
export function useUsualWake(date: string): { wakeMin: number; isWorkday: boolean } {
  const profile = useStore((s) => s.profile);
  return wakeTargetFor({ ...profile, wakePlan: undefined }, date);
}

/** Usual / Set a time / Free day for one morning, with a one-line explanation of the choice. */
export function WakePlanPicker({ date }: { date: string }) {
  const plan = useStore((s) => s.profile.wakePlan?.[date]);
  const freeWakeMin = useStore((s) => s.profile.freeWakeMin ?? s.profile.workWakeMin + 60);
  const usual = useUsualWake(date);
  const setPlan = useSetWakePlan();
  const mode: 'usual' | 'custom' | 'free' = plan?.free ? 'free' : plan?.wakeMin !== undefined ? 'custom' : 'usual';
  const customMin = plan?.wakeMin ?? usual.wakeMin;
  // The routine-alarm choice for this date survives changing the wake-up (a free day has no alarms, so it drops it).
  const save = (next: DayWakePlan) => {
    const merged: DayWakePlan = next.free ? next : { ...(plan?.twoStep !== undefined ? { twoStep: plan.twoStep } : {}), ...next };
    setPlan(date, Object.keys(merged).length ? merged : undefined);
  };
  return (
    <View>
      <Segmented
        value={mode}
        onChange={(m) => save(m === 'usual' ? {} : m === 'free' ? { free: true } : { wakeMin: customMin })}
        options={[
          { label: `Usual · ${formatClock(usual.wakeMin)}`, value: 'usual' },
          { label: 'Set a time', value: 'custom' },
          { label: 'Free day', value: 'free' },
        ]}
      />
      <Text style={[font.small, { marginTop: space.sm }]}>{wakeChoiceHint(mode, usual, formatClock(usual.wakeMin), formatClock(freeWakeMin))}</Text>
      {mode === 'custom' ? (
        <Stepper
          label="Up by"
          sub="15-minute steps"
          value={formatClock(customMin)}
          onDec={() => save({ wakeMin: normalizeMinutes(customMin - 15) })}
          onInc={() => save({ wakeMin: normalizeMinutes(customMin + 15) })}
        />
      ) : null}
      <RoutineChoice date={date} />
    </View>
  );
}

/**
 * Two-step mornings for one date: the routine alarm on or off for just that morning. Undefined
 * when there is nothing to choose: two-step mornings were never set up, the morning has no alarm,
 * or the times don't work (the weekly setting explains why).
 */
export function useRoutineChoice(date: string): { on: boolean; sub: string; change: (v: boolean) => void } | undefined {
  const profile = useStore((s) => s.profile);
  const setPlan = useSetWakePlan();
  if (!profile.twoStepMorning) return undefined;
  const target = wakeTargetFor(profile, date);
  if (target.noAlarm) return undefined;
  const setting = twoStepSetting(profile);
  const check = checkTwoStep({ ...profile, twoStepMorning: { ...setting, enabled: true } });
  if (!check.ok) return undefined;
  const plan = profile.wakePlan?.[date];
  const choice = plan?.twoStep;
  const byWeek = twoStepByWeek(profile, date, target);
  const on = choice ?? byWeek;
  const first = normalizeMinutes(target.wakeMin - check.config.gapMin);
  const why =
    choice === undefined
      ? setting.enabled
        ? `as usual for ${DAY_NAMES[weekdayOfKey(date)]}s`
        : 'two-step mornings are off, this turns it on for just this morning'
      : 'just this morning';
  const sub = on
    ? `Up ${formatClock(first)} for your ${check.config.routineMin}-min routine, back to sleep until ${formatClock(target.wakeMin)} · ${why}`
    : `One alarm at ${formatClock(target.wakeMin)} · ${why}`;
  const change = (v: boolean) => {
    const next: DayWakePlan = { ...plan };
    // Back to what the week says: forget the choice so later changes to the weekly setting apply.
    if (v === byWeek) delete next.twoStep;
    else next.twoStep = v;
    setPlan(date, Object.keys(next).length ? next : undefined);
  };
  return { on, sub, change };
}

/** The routine-alarm switch for one morning (nothing when there is no choice to make). */
export function RoutineChoice({ date }: { date: string }) {
  const c = useRoutineChoice(date);
  if (!c) return null;
  return <Toggle label="Routine alarm this morning" sub={c.sub} value={c.on} onChange={c.change} />;
}

interface NightNote {
  key: 'held' | 'ease' | 'debt';
  icon: string;
  color: string;
  text: string;
}

/** Why a night is earlier, shorter or longer than usual: held back by the body clock, easing into an early start, paying back debt. */
export function nightNotes(night: UpcomingNight, needMin: number, rampMinPerNight: number): NightNote[] {
  const notes: NightNote[] = [];
  const heldShort = night.heldBack && night.sleepMin < needMin - 30;
  if (heldShort) {
    notes.push({
      key: 'held',
      icon: 'clock-alert-outline',
      color: colors.warn,
      text: `Your body clock isn't ready for a much earlier lights-out yet, so this night is ${formatDuration(needMin - night.sleepMin)} short. eepy moves lights-out about ${rampMinPerNight} min earlier each night. Bright light soon after waking speeds that up, and a 20-min nap before 2 PM takes the edge off.`,
    });
  }
  if (night.preShiftMin > 0 && night.preShiftFor) {
    notes.push({
      key: 'ease',
      icon: 'arrow-collapse-left',
      color: colors.textDim,
      text: `${formatDuration(night.preShiftMin)} earlier than usual, to ease into ${DAY_NAMES[weekdayOfKey(night.preShiftFor)]}'s early start. The body clock only moves earlier a little at a time.`,
    });
  }
  if (night.extraForDebtMin > 0 && !heldShort) {
    notes.push({ key: 'debt', icon: 'battery-charging-medium', color: colors.good, text: `+${night.extraForDebtMin} min in bed to pay back some sleep debt.` });
  }
  return notes;
}

/** The notes for a night, with "Skip the routine" on a short two-step night. Renders nothing when there is nothing to say. */
export function NightNotes({ night, needMin }: { night: UpcomingNight; needMin: number }) {
  // The pace coming nights are planned at: what your sleep onset has actually kept up lately.
  const ramp = useAnalysis()?.advance?.rampMinPerNight ?? BODY_CLOCK.rampMinPerNight;
  const notes = nightNotes(night, needMin, ramp);
  if (!notes.length) return null;
  return (
    <View style={{ gap: space.sm, marginTop: space.md }}>
      {notes.map((n) => (
        <View key={n.key}>
          <Bullet icon={n.icon} color={n.color} strong>
            {n.text}
          </Bullet>
          {n.key === 'held' && night.twoStep ? <SkipRoutineForShortNight night={night} /> : null}
        </View>
      ))}
    </View>
  );
}

/** On a short two-step night, the routine comes out of sleep you don't have: offer to skip it that morning. */
function SkipRoutineForShortNight({ night }: { night: UpcomingNight }) {
  const plan = useStore((s) => s.profile.wakePlan?.[night.wakeDate]);
  const setPlan = useSetWakePlan();
  if (!night.twoStep || plan?.twoStep === false) return null;
  return (
    <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
      <Button
        small
        kind="secondary"
        icon="alarm-off"
        label={`Skip the routine that morning · +${night.twoStep.awakeMin} min sleep`}
        onPress={() => setPlan(night.wakeDate, { ...plan, twoStep: false })}
      />
    </View>
  );
}

/** The night before a morning: wind-down, lights-out and alarm, expected sleep and notes. */
export function NightBeforeStats({ night, needMin, isTonight }: { night: UpcomingNight; needMin: number; isTonight: boolean }) {
  return (
    <View style={{ marginTop: space.lg }}>
      <Caption>{isTonight ? 'Tonight' : 'The night before'}</Caption>
      <Row style={{ marginTop: space.sm }}>
        <Stat label="Wind down" value={formatTime(night.windDownStart)} />
        <Stat label="Lights out" value={formatTime(night.bedtime)} color={colors.sleep} />
        <Stat
          label={night.noAlarm ? 'Wake up' : night.twoStep ? 'Routine alarm' : 'Alarm'}
          value={night.alarm ? formatTime(night.alarm) : formatTime(night.wake)}
          sub={night.noAlarm ? 'no alarm' : night.twoStep ? `then up ${formatTime(night.wake)}` : night.cycles ? `${night.cycles} sleep cycles` : undefined}
        />
      </Row>
      <Text style={[font.small, { marginTop: space.sm }]}>
        {formatDuration(night.sleepMin)} of sleep · you need {formatDuration(needMin)}
      </Text>
      <NightNotes night={night} needMin={needMin} />
      {isTonight ? <AdjustTonightButton /> : null}
    </View>
  );
}

/** Opens "Adjust tonight". `primary` is the Plan tab's one main action; elsewhere it is a small secondary button. */
export function AdjustTonightButton({ primary }: { primary?: boolean }) {
  const a = useAnalysis();
  // Only tonight's own times count (an earlier night's override — e.g. from "I'm in bed" — is ignored by the plan).
  const adjusted = useStore((s) => !!s.settings.tonight && (!a || s.settings.tonight.wakeDate === a.tonight.wakeDate));
  const label = adjusted ? 'Change tonight’s times' : 'Adjust tonight';
  if (primary) return <Button icon="clock-edit-outline" label={label} onPress={() => router.push('/tonight')} />;
  return (
    <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
      <Button small kind="secondary" icon="clock-edit-outline" label={label} onPress={() => router.push('/tonight')} />
    </View>
  );
}
