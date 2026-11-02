/**
 * Planning one morning — shared by the Planner's day card and the month calendar: the wake-up
 * choice (usual / a set time / free day), the optimal night before, and its notes.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { wakeTargetFor } from '@/engine/schedule';
import { addDays, dateKey, formatClock, formatDuration, formatTime, normalizeMinutes, weekdayOfKey } from '@/engine/time';
import type { DayWakePlan } from '@/engine/types';
import type { UpcomingNight } from '@/engine/weekPlan';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Note, Row, Segmented, Stat, Stepper } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

import { DAY_NAMES, wakeChoiceHint } from './planText';

/** How far ahead mornings can be planned. */
export const PLAN_AHEAD_DAYS = 90;

/** Saves (or clears) one morning's wake plan; mornings older than a month are dropped to keep the store small. */
export function useSetWakePlan(): (date: string, plan: DayWakePlan | undefined) => void {
  const setProfile = useStore((s) => s.setProfile);
  return (date, plan) => {
    const today = dateKey(Date.now());
    const next: Record<string, DayWakePlan> = { ...(useStore.getState().profile.wakePlan ?? {}) };
    if (plan) next[date] = plan;
    else delete next[date];
    for (const k of Object.keys(next)) if (k < addDays(today, -30)) delete next[k];
    setProfile({ wakePlan: next });
  };
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
  return (
    <View>
      <Segmented
        value={mode}
        onChange={(m) => setPlan(date, m === 'usual' ? undefined : m === 'free' ? { free: true } : { wakeMin: customMin })}
        options={[
          { label: `Usual · ${formatClock(usual.wakeMin)}`, value: 'usual' },
          { label: 'Set a time', value: 'custom' },
          { label: 'Free day', value: 'free' },
        ]}
      />
      <Text style={[font.small, { marginTop: 6 }]}>{wakeChoiceHint(mode, usual, formatClock(usual.wakeMin), formatClock(freeWakeMin))}</Text>
      {mode === 'custom' ? (
        <Stepper
          label="Up by"
          sub="15-minute steps"
          value={formatClock(customMin)}
          onDec={() => setPlan(date, { wakeMin: normalizeMinutes(customMin - 15) })}
          onInc={() => setPlan(date, { wakeMin: normalizeMinutes(customMin + 15) })}
        />
      ) : null}
    </View>
  );
}

/** Why a night is earlier, shorter or longer than usual (held back by the body clock, easing into an early start, paying back debt). */
export function NightNotes({ night, needMin }: { night: UpcomingNight; needMin: number }) {
  const heldShort = night.heldBack && night.sleepMin < needMin - 30;
  return (
    <>
      {heldShort ? (
        <Note tone="warn" icon="clock-alert-outline">
          {`Lights-out can't move much earlier than your body clock allows — you'd mostly lie awake — so this night runs ${formatDuration(needMin - night.sleepMin)} short. A short nap that afternoon helps; eepy eases the nights before where it can.`}
        </Note>
      ) : null}
      {night.preShiftMin > 0 && night.preShiftFor ? (
        <Note icon="arrow-collapse-left">
          {`${formatDuration(night.preShiftMin)} earlier than usual to ease into ${DAY_NAMES[weekdayOfKey(night.preShiftFor)]}'s early start — the body clock only moves earlier gradually.`}
        </Note>
      ) : null}
      {night.extraForDebtMin > 0 && !heldShort ? (
        <Note tone="good" icon="battery-charging-medium">
          {`+${night.extraForDebtMin} min in bed to pay back some sleep debt.`}
        </Note>
      ) : null}
    </>
  );
}

/** The optimal night before a morning: wind-down, lights-out and alarm, expected sleep and notes. */
export function NightBeforeStats({ night, needMin, isTonight }: { night: UpcomingNight; needMin: number; isTonight: boolean }) {
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={font.label}>BEST PLAN FOR THE NIGHT BEFORE</Text>
      <Row style={{ marginTop: 4 }}>
        <Stat label="Wind down" value={formatTime(night.windDownStart)} />
        <Stat label="Lights out" value={formatTime(night.bedtime)} color={colors.accent} />
        <Stat
          label={night.noAlarm ? 'Wake (free)' : night.twoStep ? 'Routine alarm' : 'Alarm'}
          value={night.alarm ? formatTime(night.alarm) : formatTime(night.wake)}
          sub={night.noAlarm ? 'no alarm' : night.twoStep ? `then up ${formatTime(night.wake)}` : night.cycles ? `${night.cycles} sleep cycles` : undefined}
        />
      </Row>
      <Text style={[font.small, { marginTop: space.sm }]}>
        Expected sleep {formatDuration(night.sleepMin)} (you need {formatDuration(needMin)}).
      </Text>
      <View style={{ marginTop: space.sm }}>
        <NightNotes night={night} needMin={needMin} />
      </View>
      {isTonight ? <AdjustTonightButton /> : null}
    </View>
  );
}

export function AdjustTonightButton({ primary }: { primary?: boolean }) {
  const a = useAnalysis();
  // Only tonight's own times count (an earlier night's override — e.g. from "I'm in bed" — is ignored by the plan).
  const adjusted = useStore((s) => !!s.settings.tonight && (!a || s.settings.tonight.wakeDate === a.tonight.wakeDate));
  return (
    <View style={{ marginTop: space.sm, alignItems: primary ? 'stretch' : 'flex-start' }}>
      <Button
        small={!primary}
        kind={primary ? 'primary' : 'secondary'}
        icon="clock-edit-outline"
        label={adjusted ? 'Change tonight’s times' : 'Can’t make it? Adjust tonight'}
        onPress={() => router.push('/tonight')}
      />
    </View>
  );
}
