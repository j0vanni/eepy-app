/**
 * "What's new / where things moved": shown once after the update that brought the new tabs
 * (seen flag in settings.marks), and any time from More → What's new.
 */
import { router } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '@/state/store';

import { Button, Icon, Row } from './components';
import { colors, font, radius, space } from './theme';

export const WHATS_NEW_MARK = 'whatsNew.seen';
/** Bump to show the sheet again after a future update. */
export const WHATS_NEW_ID = 'navigation-2026-11';

const TABS: { icon: string; title: string; text: string }[] = [
  { icon: 'home-variant-outline', title: 'Today', text: 'Big buttons at the top: log coffee, check in, nap, and adjust tonight (or wind down in the evening).' },
  { icon: 'calendar-clock', title: 'Planner', text: 'Your week at a glance — tap a day to change its wake-up. Tonight’s plan, your usual week and the planning tools are here too. New: two-step mornings (a routine alarm, back to bed, then your wake-up) under "Your usual week".' },
  { icon: 'sleep', title: 'Nap', text: 'Same as before: should you nap, when, and for how long.' },
  { icon: 'chart-timeline-variant', title: 'Sleep', text: 'Your history: trends, the month calendar and every night.' },
  { icon: 'dots-horizontal-circle-outline', title: 'More', text: 'Coach, body clock, wind-down, programmes, journal, reports — with a search box.' },
];

/** Smaller additions since this sheet was written. */
const NEW: { icon: string; title: string; text: string }[] = [
  {
    icon: 'brightness-6',
    title: 'Brightness at night',
    text: 'eepy still dims itself in the evening, but never too dark to read — and the Brightness button (bottom left) lets you set eepy\'s brightness or hand it back to your phone\'s.',
  },
  {
    icon: 'weather-sunny',
    title: "I'm up — before the alarm",
    text: 'Woke up early? From 3 AM Today has "I\'m up": it ends the night, turns off this morning\'s alarms and switches to the morning (Undo if you go back to sleep). Woke up before you tapped? "Change time" sets when you really woke up.',
  },
  {
    icon: 'sleep',
    title: 'Skip the routine',
    text: 'Not doing your face routine? Today shows "Skip the routine — sleep until 6:00" from an hour before the routine alarm (the watch buzz has "Skip routine" too). Forgot to tap? The morning check-in asks "Did it / Skipped it".',
  },
  {
    icon: 'format-list-checks',
    title: 'Bedtime rundown',
    text: 'Your evening step by step, from the caffeine cut-off to "I\'m in bed": phone down, teeth, reading time (on your e-reader if you use one) and more — each with what to do and why. Tap "Start my rundown" on Today in the evening for one step at a time, and make it yours in Settings → Wind-down & phone light.',
  },
  {
    icon: 'book-open-variant',
    title: 'E-ink reader',
    text: 'Read on a Kindle, Kobo or Boox? Turn on "I read on an e-ink reader" in Settings → Wind-down & phone light: your wind-down gets reading time after screens-off, with frontlight tips.',
  },
  {
    icon: 'source-branch',
    title: 'Options for tonight',
    text: 'Planner → Tonight weighs several ways to spend the night — eepy\'s plan, skipping the routine, the earliest you\'ll fall asleep, a nap tomorrow and more — highlights its pick and shows how it decided. Up past lights-out? Today shows "Still up?" with the best plan from now, one tap to use it.',
  },
  {
    icon: 'weather-sunset-up',
    title: 'Routine alarm, one morning at a time',
    text: 'Tap a day in the Planner → "Routine alarm this morning" to skip your two-step routine that morning, or add it to a morning that usually doesn\'t have it.',
  },
];

const MOVED: [string, string][] = [
  ['Plan tab', 'Planner tab'],
  ['Trends tab', 'Sleep tab → Trends'],
  ['Coach tab', 'More → Coach'],
  ['Calendar', 'Planner → Month view, and Sleep → Calendar'],
  ['Workdays & wake-up times', 'Planner → Your usual week'],
  ['Wake alarm, CMF Watch', 'Settings → Alarms & watch'],
  ['Wind-down, bedtime autopilot', 'Settings → Wind-down & phone light'],
  ['Caffeine half-life, your drinks', 'Settings → Caffeine & drinks'],
  ['Data sources, backup', 'Settings → Health Connect & data'],
  ['Self-checks', 'More → Self-checks'],
];

export function WhatsNewContent() {
  return (
    <View>
      <Text style={font.h2}>eepy is easier to find your way around</Text>
      <Text style={[font.small, { marginTop: 4 }]}>Nothing was removed — some things just moved. Five tabs at the bottom:</Text>
      <View style={{ marginTop: space.md, gap: space.md }}>
        {TABS.map((t) => (
          <Row key={t.title} gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View style={styles.icon}>
              <Icon name={t.icon} size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>{t.title}</Text>
              <Text style={font.small}>{t.text}</Text>
            </View>
          </Row>
        ))}
      </View>
      <Text style={[font.label, { marginTop: space.lg, marginBottom: space.sm }]}>ALSO NEW</Text>
      <View style={{ gap: space.md }}>
        {NEW.map((t) => (
          <Row key={t.title} gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View style={styles.icon}>
              <Icon name={t.icon} size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>{t.title}</Text>
              <Text style={font.small}>{t.text}</Text>
            </View>
          </Row>
        ))}
      </View>
      <Text style={[font.label, { marginTop: space.lg, marginBottom: space.sm }]}>WHERE THINGS MOVED</Text>
      <View style={styles.table}>
        {MOVED.map(([from, to], i) => (
          <Row key={from} gap={space.sm} style={[styles.moveRow, i ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
            <Text style={[font.small, { flex: 1 }]}>{from}</Text>
            <Icon name="arrow-right" size={14} color={colors.textFaint} />
            <Text style={[font.small, { flex: 1.3, color: colors.text }]}>{to}</Text>
          </Row>
        ))}
      </View>
      <Row gap={space.sm} style={{ marginTop: space.md, alignItems: 'flex-start' }}>
        <Icon name="magnify" size={18} color={colors.accent} />
        <Text style={[font.small, { flex: 1, color: colors.text }]}>Can't find something? Type it in the search box at the top of More or Settings — e.g. “alarm”, “coffee” or “wake-up”.</Text>
      </Row>
    </View>
  );
}

/** The one-time sheet over the tabs (only for people who used eepy before this update; onboarding marks it seen). */
export function WhatsNewSheet() {
  const onboarded = useStore((s) => s.profile.onboarded);
  const seen = useStore((s) => s.settings.marks[WHATS_NEW_MARK]);
  const setMark = useStore((s) => s.setMark);
  const insets = useSafeAreaInsets();
  if (!onboarded || seen === WHATS_NEW_ID) return null;
  const done = () => setMark(WHATS_NEW_MARK, WHATS_NEW_ID);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={done} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={done} accessibilityLabel="Close what's new" />
        <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}>
          <View style={styles.handle} />
          <ScrollView style={{ maxHeight: '100%' }} contentContainerStyle={{ paddingBottom: space.md }}>
            <WhatsNewContent />
          </ScrollView>
          <Button label="Got it" icon="check" onPress={done} />
          <Pressable
            onPress={() => {
              done();
              router.push('/more');
            }}
            style={{ alignItems: 'center', paddingTop: space.md }}
            accessibilityRole="button"
          >
            <Text style={[font.small, { color: colors.accent, fontWeight: '600' }]}>Show me the More tab</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Marks the sheet as seen (new installs: there's nothing "moved" for them). */
export function markWhatsNewSeen() {
  useStore.getState().setMark(WHATS_NEW_MARK, WHATS_NEW_ID);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,12,0.7)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.md },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  table: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: space.md },
  moveRow: { paddingVertical: 8, alignItems: 'flex-start' },
});
