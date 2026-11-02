/**
 * eepy://quick/<action> — one-tap actions from the long-press app-icon shortcuts, the "Log coffee"
 * Quick Settings tile, the sleep-mode "play sleep sounds?" notification and the "I'm in bed" button
 * on the wind-down / lights-out notifications. A small sheet over whatever was open (see
 * src/shortcuts/quickActions.ts for what each action decides):
 * - coffee: logs the usual drink at its usual time, with Undo and Change time, then closes itself
 * - nap: offers the recommended nap right away, or opens the Nap coach
 * - late → Adjust tonight, checkin → Quick check-in
 * - sounds: starts the default sleep sound with its timer
 * - inbed: starts the sleep session ("Sleep session started 11:42 PM · alarm 6:52 AM"), with Undo
 */
import { Redirect, router, useCanGoBack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { soundPlayer } from '@/audio/player';
import { usePlayback } from '@/audio/useSoundPlayer';
import type { UsualCaffeine } from '@/engine/caffeineHabits';
import type { NapOption } from '@/engine/nap';
import { isOpen, sessionDetails } from '@/engine/inBed';
import { formatTime, MINUTE } from '@/engine/time';
import type { CaffeineDose } from '@/engine/types';
import { startNapTimer } from '@/notifications/alarms';
import { dismissSleepModePrompt, sleepSoundsLabel } from '@/notifications/sleepMode';
import { anotherDose, decideQuickAction, parseQuickAction, type QuickDecision } from '@/shortcuts/quickActions';
import { cancelInBedSession, inBedAvailable, sessionAlarm, sessionFor, startInBedSession } from '@/state/inBed';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Icon, IconButton, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { EnterView } from '@/ui/motion';
import { colors, font, radius, space } from '@/ui/theme';

const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '');

type Sheet =
  | { kind: 'logged'; dose: CaffeineDose; usual: UsualCaffeine; undone: boolean }
  | { kind: 'already'; dose: CaffeineDose; usual: UsualCaffeine }
  | { kind: 'nap'; option: NapOption; headline: string }
  | { kind: 'sounds' }
  /** `already`: the session was running before this tap (nothing started). */
  | { kind: 'inbed'; already: boolean; undone: boolean };

function initialSheet(d: QuickDecision): Sheet | undefined {
  if ('redirect' in d) return undefined;
  switch (d.sheet) {
    case 'coffee-logged':
      return { kind: 'logged', dose: d.dose, usual: d.usual, undone: false };
    case 'coffee-already':
      return { kind: 'already', dose: d.dose, usual: d.usual };
    case 'nap':
      return { kind: 'nap', option: d.option, headline: d.headline };
    case 'sounds':
      return { kind: 'sounds' };
    case 'inbed':
    case 'inbed-open':
      return { kind: 'inbed', already: d.sheet === 'inbed-open', undone: false };
  }
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function QuickActionScreen() {
  const params = useLocalSearchParams<{ action?: string }>();
  const analysis = useAnalysis();
  const insets = useSafeAreaInsets();
  const addCaffeine = useStore((s) => s.addCaffeine);
  const removeCaffeine = useStore((s) => s.removeCaffeine);
  const audio = useStore((s) => s.settings.audio);
  const settings = useStore((s) => s.settings);
  const playback = usePlayback();

  // Decided once: re-renders (a new analysis, the logged drink) must not change what this tap meant.
  const [decision] = useState<QuickDecision>(() => {
    const s = useStore.getState();
    const now = Date.now();
    const inBed = analysis ? { open: isOpen(sessionFor(s.settings.session, analysis)), available: inBedAvailable(analysis, s.profile, now) } : undefined;
    return decideQuickAction(
      parseQuickAction(params.action),
      { onboarded: s.profile.onboarded, caffeine: s.caffeine, napRunning: !!s.settings.napTimer, nap: analysis?.nap, inBed },
      now,
    );
  });
  const [sheet, setSheet] = useState<Sheet | undefined>(() => initialSheet(decision));
  /** The user did something in the sheet: no more auto-close. */
  const [stay, setStay] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Opened cold from a shortcut or the tile: nothing underneath to show through the backdrop. */
  const standalone = !useCanGoBack();
  const done = useRef(false);

  // The action itself, exactly once.
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if ('redirect' in decision) return;
    if (decision.sheet === 'coffee-logged') {
      // Same per-day id as every "usual" button: a repeated tap can't log it twice.
      if (!useStore.getState().caffeine.some((d) => d.id === decision.dose.id)) addCaffeine(decision.dose);
      confirmHaptic();
    } else if (decision.sheet === 'sounds') {
      void soundPlayer.play(useStore.getState().settings.audio);
      dismissSleepModePrompt().catch(() => undefined);
      confirmHaptic();
    } else if (decision.sheet === 'inbed' && analysis) {
      startInBedSession(analysis).catch((e) => console.warn('in-bed start failed', e));
      confirmHaptic();
    }
    // Decided and done once, with the analysis of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision, addCaffeine]);

  // Confirmations close by themselves.
  useEffect(() => {
    if (!sheet || stay) return;
    const ms =
      sheet.kind === 'logged' || sheet.kind === 'inbed' ? (sheet.undone ? 1200 : sheet.kind === 'inbed' ? 4000 : 3200) : sheet.kind === 'sounds' ? 2600 : 0;
    if (!ms) return;
    const id = setTimeout(close, ms);
    return () => clearTimeout(id);
  }, [sheet, stay]);

  if ('redirect' in decision) return <Redirect href={decision.redirect} />;
  if (!sheet) return null;

  const changeTime = (id: string) => router.replace({ pathname: '/caffeine', params: { id } });

  let body: ReactNode;
  if (sheet.kind === 'logged') {
    const { dose } = sheet;
    body = sheet.undone ? (
      <Row gap={space.md} style={styles.head}>
        <Icon name="undo" size={22} color={colors.textDim} />
        <Text style={[font.body, { flex: 1 }]}>Undone — nothing logged.</Text>
      </Row>
    ) : (
      <>
        <Row gap={space.md} style={styles.head}>
          <Icon name="check-circle" size={22} color={colors.good} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '600' }]}>
              {shortDrink(dose.label)} · {dose.mg} mg at {formatTime(dose.time)}
            </Text>
            <Text style={font.tiny}>{stay ? 'Your usual coffee · logged' : 'Your usual coffee · logged · closing…'}</Text>
          </View>
        </Row>
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <Button
            small
            kind="secondary"
            icon="undo"
            label="Undo"
            style={{ flex: 1 }}
            onPress={() => {
              removeCaffeine(dose.id);
              setSheet({ ...sheet, undone: true });
            }}
          />
          <Button small kind="secondary" icon="clock-edit-outline" label="Change time" style={{ flex: 1 }} onPress={() => changeTime(dose.id)} />
        </Row>
      </>
    );
  } else if (sheet.kind === 'already') {
    const { dose, usual } = sheet;
    body = (
      <>
        <Row gap={space.md} style={styles.head}>
          <Icon name="coffee" size={22} color={colors.caffeine} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '600' }]}>Already logged today</Text>
            <Text style={font.small}>
              {shortDrink(dose.label)} · {dose.mg} mg at {formatTime(dose.time)}
            </Text>
          </View>
        </Row>
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <Button
            small
            icon="plus"
            label="Log another now"
            style={{ flex: 1 }}
            onPress={() => {
              const another = anotherDose(usual, Date.now());
              addCaffeine(another);
              confirmHaptic();
              setSheet({ kind: 'logged', dose: another, usual, undone: false });
            }}
          />
          <Button small kind="secondary" icon="clock-edit-outline" label="Change time" style={{ flex: 1 }} onPress={() => changeTime(dose.id)} />
        </Row>
      </>
    );
  } else if (sheet.kind === 'nap') {
    const { option } = sheet;
    body = (
      <>
        <Row gap={space.md} style={[styles.head, { alignItems: 'flex-start' }]}>
          <Icon name="sleep" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '600' }]}>
              {option.label} · {option.alarmAfterMin} min
            </Text>
            <Text style={font.small}>
              Alarm at {formatTime(Date.now() + option.alarmAfterMin * MINUTE)}
              {sheet.headline ? ` · ${sheet.headline}` : ''}
            </Text>
          </View>
        </Row>
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <Button
            small
            icon="alarm"
            label={busy ? 'Starting…' : 'Start nap'}
            disabled={busy}
            style={{ flex: 1 }}
            onPress={async () => {
              setBusy(true);
              await startNapTimer(useStore.getState(), option).catch((e) => console.warn('nap start failed', e));
              router.replace('/nap');
            }}
          />
          <Button small kind="secondary" icon="sleep" label="Nap coach" style={{ flex: 1 }} onPress={() => router.replace('/nap')} />
        </Row>
      </>
    );
  } else if (sheet.kind === 'inbed') {
    const s = analysis ? sessionFor(settings.session, analysis) : undefined;
    const details = s && analysis ? sessionDetails(s, sessionAlarm(analysis, settings, s, Date.now()), { soundsPlaying: playback.status === 'playing' }) : '';
    body = sheet.undone ? (
      <Row gap={space.md} style={styles.head}>
        <Icon name="undo" size={22} color={colors.textDim} />
        <Text style={[font.body, { flex: 1 }]}>Undone — tonight's plan is back.</Text>
      </Row>
    ) : !s ? (
      <Row gap={space.md} style={styles.head}>
        <Icon name="moon-waning-crescent" size={22} color={colors.light} />
        <Text style={[font.body, { flex: 1 }]}>Starting your sleep session…</Text>
      </Row>
    ) : (
      <>
        <Row gap={space.md} style={[styles.head, { alignItems: 'flex-start' }]}>
          <Icon name="moon-waning-crescent" size={22} color={colors.light} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '600' }]}>
              {sheet.already ? `In bed since ${formatTime(s.inBedAt)}` : `Sleep session started ${formatTime(s.inBedAt)}`}
            </Text>
            <Text style={font.small}>{details ? details[0].toUpperCase() + details.slice(1) : ''}</Text>
            {sheet.already ? null : <Text style={font.tiny}>Tonight's reminders are off. Sleep well.</Text>}
          </View>
        </Row>
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          {sheet.already ? (
            <Button small kind="secondary" icon="weather-night" label="Wind-down" style={{ flex: 1 }} onPress={() => router.replace('/winddown')} />
          ) : (
            <Button
              small
              kind="secondary"
              icon="undo"
              label="Undo"
              style={{ flex: 1 }}
              onPress={() => {
                cancelInBedSession().catch(() => undefined);
                setSheet({ ...sheet, undone: true });
              }}
            />
          )}
          <Button small kind="secondary" icon="home-variant-outline" label="Today" style={{ flex: 1 }} onPress={() => router.replace('/')} />
        </Row>
      </>
    );
  } else {
    const playing = playback.status === 'playing';
    body = (
      <>
        <Row gap={space.md} style={styles.head}>
          <Icon name="music-note" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '600' }]}>{sleepSoundsLabel(audio)}</Text>
            <Text style={font.tiny}>
              {playback.error ? `Couldn't play: ${playback.error}` : playing ? (playback.endsAt ? `Playing · stops at ${formatTime(playback.endsAt)}` : 'Playing') : 'Starting…'}
            </Text>
          </View>
        </Row>
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <Button small kind="secondary" icon="weather-night" label="Wind-down" style={{ flex: 1 }} onPress={() => router.replace('/winddown')} />
          <Button
            small
            kind="secondary"
            icon="stop"
            label="Stop"
            style={{ flex: 1 }}
            onPress={() => {
              soundPlayer.stop();
              close();
            }}
          />
        </Row>
      </>
    );
  }

  return (
    <View style={[styles.root, standalone ? { backgroundColor: colors.bg } : null]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      <EnterView style={[styles.sheet, { marginBottom: insets.bottom + space.lg }]}>
        <Pressable onPressIn={() => setStay(true)} accessible={false}>
          {body}
        </Pressable>
        <View style={styles.close}>
          <IconButton icon="close" label={sheet.kind === 'nap' ? 'Not now' : 'Done'} onPress={close} color={colors.textFaint} />
        </View>
      </EnterView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.lg, backgroundColor: 'rgba(5, 7, 15, 0.55)' },
  close: { position: 'absolute', top: 6, right: 6 },
  head: { paddingRight: 36 },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
