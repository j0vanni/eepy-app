/**
 * Today, during a two-step morning's routine (from the routine alarm until the final alarm):
 * "Back to bed by 5:20 — alarm at 6:05. Lights low, screens off." with "Staying up? Skip the 6:05
 * alarm" (and Undo). Renders nothing outside that window, so it can sit at the top of Today all the
 * time. The routine alarm's "I'm up" opens Today (fullScreenAlarm.ROUTINE_ALARM_LINK).
 *
 * Skipping uses WAKE_FINAL_SKIP_MARK: only the final alarm, and the morning isn't treated as a free
 * one. It re-plans the alarms right away and switches the phone's sleep mode off (on again on Undo),
 * and ends a running sleep session ("I'm up"; Undo opens it again).
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatTime } from '@/engine/time';
import { routineNow, syncWakeAlarm, WAKE_FINAL_SKIP_MARK } from '@/notifications/fullScreenAlarm';
import { replanNotifications } from '@/notifications/scheduler';
import { hasSleepMode, startSleepModeNow, stopSleepModeNow } from '@/notifications/sleepMode';
import { endInBedSession, undoEndInBedSession } from '@/state/inBed';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { Button, Card, Icon, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

/** Dim, like Today's night view: it's still dark and the point is to go back to sleep. */
const DIM_CARD = { backgroundColor: '#0A0E1C', borderColor: '#161C33' };

export function RoutineMorningNow({ a }: { a?: Analysis }) {
  const shared = useAnalysis();
  const analysis = a ?? shared;
  const now = useNow(30_000);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const setMark = useStore((s) => s.setMark);
  const [busy, setBusy] = useState(false);
  const r = analysis ? routineNow(analysis, settings, profile, now) : undefined;
  if (!analysis || !r) return null;

  const final = formatTime(r.finalAt);
  const watchFirst = r.finalPhoneAt !== r.finalAt;
  // The alarms (and the planner fallback) follow the new mark right away, not at the next re-plan.
  const replan = () => {
    const state = useStore.getState();
    replanNotifications(analysis, state).catch(() => undefined);
    syncWakeAlarm(analysis, state).catch(() => undefined);
  };
  const setSkipped = async (skip: boolean) => {
    setBusy(true);
    if (skip) confirmHaptic();
    setMark(WAKE_FINAL_SKIP_MARK, skip ? r.date : undefined);
    replan();
    // Staying up: that's "I'm up" for tonight's sleep session too.
    await (skip ? endInBedSession('routine', analysis) : undoEndInBedSession()).catch(() => undefined);
    // Up for the day: lights on. Back to bed: sleep mode again until the final alarm.
    if (hasSleepMode() && settings.sleepMode.enabled) {
      await (skip ? stopSleepModeNow(r.date) : startSleepModeNow(r.date, r.finalAt)).catch(() => false);
    }
    setBusy(false);
  };

  if (r.skipped) {
    return (
      <Card style={DIM_CARD}>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Icon name="weather-sunset-up" size={20} color={colors.energy} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>Staying up — the {final} alarm is off</Text>
            <Text style={[font.small, { marginTop: 2 }]}>Get some daylight soon. With no sleep after your routine, eepy counts it as your wake-up.</Text>
          </View>
        </Row>
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button small kind="ghost" icon="undo" label={`Undo — alarm at ${final}`} disabled={busy} onPress={() => setSkipped(false)} />
        </View>
      </Card>
    );
  }

  const backToBed = now < r.backToBedBy;
  return (
    <Card style={DIM_CARD} accent="#1F2647">
      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <Icon name="face-woman-shimmer-outline" size={20} color={colors.light} />
        <View style={{ flex: 1 }}>
          <Text style={font.label}>MORNING ROUTINE</Text>
          <Text style={[font.h2, { color: colors.textDim, marginTop: 2 }]}>
            {backToBed ? `Back to bed by ${formatTime(r.backToBedBy)}` : 'Back to bed'} — alarm at {final}.
          </Text>
          <Text style={[font.small, { marginTop: 4 }]}>
            Lights low, screens off.{watchFirst ? ` Your watch buzzes at ${final}, the phone at ${formatTime(r.finalPhoneAt)}.` : ''}
          </Text>
        </View>
      </Row>
      {r.eepyAlarm ? (
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="alarm-off" label={`Staying up? Skip the ${final} alarm`} disabled={busy} onPress={() => setSkipped(true)} />
        </View>
      ) : (
        <Text style={[font.tiny, { marginTop: space.sm }]}>From your two-step plan — your own alarm rings.</Text>
      )}
    </Card>
  );
}
