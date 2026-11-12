/**
 * eepy://quick/<action> — one-tap actions from the long-press app-icon shortcuts, the "Log coffee"
 * Quick Settings tile, the sleep-mode "play sleep sounds?" notification and the "I'm in bed" button
 * on the wind-down / lights-out notifications. A bottom sheet over whatever was open (dimmed), with
 * one thing to read and large buttons (see src/shortcuts/quickActions.ts for what each action
 * decides):
 * - coffee: logs the usual drink at its usual time, with Undo and Change time, then closes itself
 * - nap: offers the recommended nap right away, or opens the Nap screen
 * - late → Adjust tonight, checkin → Quick check-in
 * - sounds: starts the default sleep sound with its timer
 * - inbed: starts the sleep session ("Sleep session started 11:42 PM"), with Undo
 */
import { Redirect, router, useCanGoBack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { soundPlayer } from '@/audio/player';
import { usePlayback } from '@/audio/useSoundPlayer';
import type { UsualCaffeine } from '@/engine/caffeineHabits';
import { isOpen, sessionDetails } from '@/engine/inBed';
import type { NapOption } from '@/engine/nap';
import { formatTime, MINUTE } from '@/engine/time';
import type { CaffeineDose } from '@/engine/types';
import { startNapTimer } from '@/notifications/alarms';
import { dismissSleepModePrompt, sleepSoundsLabel } from '@/notifications/sleepMode';
import { anotherDose, decideQuickAction, parseQuickAction, type QuickDecision } from '@/shortcuts/quickActions';
import { cancelInBedSession, inBedAvailable, sessionAlarm, sessionFor, startInBedSession } from '@/state/inBed';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Icon } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { EnterView } from '@/ui/motion';
import { colors, font, iconSize, radius, space } from '@/ui/theme';

const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '');

type Sheet =
  | { kind: 'logged'; dose: CaffeineDose; usual: UsualCaffeine; undone: boolean }
  | { kind: 'already'; dose: CaffeineDose; usual: UsualCaffeine }
  | { kind: 'nap'; option: NapOption; headline: string }
  | { kind: 'sounds' }
  /** `already`: the session was running before this tap (nothing started). */
  | { kind: 'inbed'; already: boolean; undone: boolean };

/** What a sheet shows: one thing to read, then up to two large buttons (the first may be the main one). */
interface Content {
  icon: string;
  iconColor?: string;
  title: string;
  sub?: string;
  note?: string;
  buttons?: { label: string; icon: string; onPress: () => void; primary?: boolean; disabled?: boolean }[];
}

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
  const drinkLine = (dose: CaffeineDose) => `${shortDrink(dose.label)} · ${dose.mg} mg at ${formatTime(dose.time)}`;

  let content: Content;
  if (sheet.kind === 'logged') {
    const { dose } = sheet;
    content = sheet.undone
      ? { icon: 'undo', title: 'Undone', sub: 'Nothing was logged.' }
      : {
          icon: 'check-circle',
          iconColor: colors.good,
          title: `${shortDrink(dose.label)} logged`,
          sub: `${dose.mg} mg at ${formatTime(dose.time)}`,
          note: stay ? 'Your usual.' : 'Your usual. Closing…',
          buttons: [
            {
              label: 'Undo',
              icon: 'undo',
              onPress: () => {
                removeCaffeine(dose.id);
                setSheet({ ...sheet, undone: true });
              },
            },
            { label: 'Change time', icon: 'clock-edit-outline', onPress: () => changeTime(dose.id) },
          ],
        };
  } else if (sheet.kind === 'already') {
    const { dose, usual } = sheet;
    content = {
      icon: 'coffee',
      iconColor: colors.caffeine,
      title: 'Already logged today',
      sub: drinkLine(dose),
      buttons: [
        {
          label: 'Log another now',
          icon: 'plus',
          primary: true,
          onPress: () => {
            const another = anotherDose(usual, Date.now());
            addCaffeine(another);
            confirmHaptic();
            setSheet({ kind: 'logged', dose: another, usual, undone: false });
          },
        },
        { label: 'Change time', icon: 'clock-edit-outline', onPress: () => changeTime(dose.id) },
      ],
    };
  } else if (sheet.kind === 'nap') {
    const { option } = sheet;
    content = {
      icon: 'sleep',
      title: `Start a ${option.alarmAfterMin}-min nap?`,
      sub: `${option.label}, alarm at ${formatTime(Date.now() + option.alarmAfterMin * MINUTE)}.`,
      note: sheet.headline || undefined,
      buttons: [
        {
          label: busy ? 'Starting…' : 'Start nap',
          icon: 'alarm',
          primary: true,
          disabled: busy,
          onPress: async () => {
            setBusy(true);
            await startNapTimer(useStore.getState(), option).catch((e) => console.warn('nap start failed', e));
            router.replace('/nap');
          },
        },
        { label: 'Other naps', icon: 'sleep', onPress: () => router.replace('/nap') },
      ],
    };
  } else if (sheet.kind === 'inbed') {
    const s = analysis ? sessionFor(settings.session, analysis) : undefined;
    const details = s && analysis ? sessionDetails(s, sessionAlarm(analysis, settings, s, Date.now()), { soundsPlaying: playback.status === 'playing' }) : '';
    const today = { label: 'Today', icon: 'home-variant-outline', onPress: () => router.replace('/') };
    content = sheet.undone
      ? { icon: 'undo', title: 'Undone', sub: "Tonight's plan is back." }
      : !s
        ? { icon: 'moon-waning-crescent', iconColor: colors.sleep, title: 'Starting your sleep session…' }
        : {
            icon: 'moon-waning-crescent',
            iconColor: colors.sleep,
            title: sheet.already ? `In bed since ${formatTime(s.inBedAt)}` : `Sleep session started ${formatTime(s.inBedAt)}`,
            sub: details ? details[0].toUpperCase() + details.slice(1) : undefined,
            note: sheet.already ? undefined : "Tonight's reminders are off. Sleep well.",
            buttons: [
              sheet.already
                ? { label: 'Wind-down', icon: 'weather-night', onPress: () => router.replace('/winddown') }
                : {
                    label: 'Undo',
                    icon: 'undo',
                    onPress: () => {
                      cancelInBedSession().catch(() => undefined);
                      setSheet({ ...sheet, undone: true });
                    },
                  },
              today,
            ],
          };
  } else {
    const playing = playback.status === 'playing';
    content = {
      icon: 'music-note',
      title: sleepSoundsLabel(audio),
      sub: playback.error ? `Couldn't play: ${playback.error}` : playing ? (playback.endsAt ? `Playing · stops at ${formatTime(playback.endsAt)}` : 'Playing') : 'Starting…',
      buttons: [
        { label: 'Wind-down', icon: 'weather-night', onPress: () => router.replace('/winddown') },
        {
          label: 'Stop',
          icon: 'stop',
          onPress: () => {
            soundPlayer.stop();
            close();
          },
        },
      ],
    };
  }

  const main = content.buttons?.find((b) => b.primary);
  const rest = content.buttons?.filter((b) => !b.primary) ?? [];

  return (
    <View style={styles.root}>
      {/* The dimmed page behind; a cold start has nothing underneath, so it is solid. */}
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop, standalone ? { opacity: 1 } : null]} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      <EnterView style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.grip} />
        <Pressable onPressIn={() => setStay(true)} accessible={false}>
          <Icon name={content.icon} size={iconSize.lg} color={content.iconColor ?? colors.textDim} />
          <Text style={[font.h2, { marginTop: space.sm }]} accessibilityRole="header">
            {content.title}
          </Text>
          {content.sub ? <Text style={[font.body, { color: colors.textDim, marginTop: space.xs }]}>{content.sub}</Text> : null}
          {content.note ? <Text style={[font.small, { marginTop: space.xs }]}>{content.note}</Text> : null}
          {main ? <Button big icon={main.icon} label={main.label} disabled={main.disabled} onPress={main.onPress} style={{ marginTop: space.lg }} /> : null}
          {rest.length ? (
            <View style={[styles.buttons, { marginTop: main ? space.sm : space.lg }]}>
              {rest.map((b) => (
                <Button key={b.label} kind="secondary" icon={b.icon} label={b.label} disabled={b.disabled} onPress={b.onPress} style={{ flex: 1 }} />
              ))}
            </View>
          ) : null}
        </Pressable>
        <Button kind="ghost" label={sheet.kind === 'nap' ? 'Not now' : 'Done'} onPress={close} style={{ marginTop: space.sm }} />
      </EnterView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: colors.bg, opacity: 0.6 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: space.sm, elevation: 12 },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, marginBottom: space.lg },
  buttons: { flexDirection: 'row', gap: space.sm },
});
