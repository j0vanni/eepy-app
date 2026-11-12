/**
 * What's new in this release: shown once as a sheet after updating (seen flag in settings.marks),
 * and any time from More → What's new.
 */
import { router } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '@/state/store';

import { Button, Icon } from './components';
import { colors, font, night, radius, space } from './theme';

export const WHATS_NEW_MARK = 'whatsNew.seen';
/** Bump to show the sheet again after a future update. */
export const WHATS_NEW_ID = 'look-and-energy-0.13';

const NEW: { icon: string; title: string; text: string }[] = [
  { icon: 'star-four-points-outline', title: 'A new, simpler look', text: 'Four tabs: Today, Sleep, Plan, More. Nap moved into Today’s buttons and More.' },
  { icon: 'white-balance-sunny', title: 'Today shows one thing at a time', text: 'Last night in the morning, your energy during the day, the countdown to lights-out in the evening.' },
  {
    icon: 'watch-variant',
    title: 'Energy now uses your watch',
    text: 'Last night’s HRV, sleeping heart rate, breathing and deep sleep; your heart rate during the day; your body clock from steps and sleep; and the caffeine you log. Tap the energy number to see what each one adds.',
  },
  { icon: 'check-decagram-outline', title: 'eepy tests itself', text: 'It checks its forecast against your check-ins, and only keeps a watch signal that makes the forecast more accurate for you.' },
  { icon: 'gesture-tap', title: 'New: reaction test', text: 'One minute, as an objective check on how alert you are.' },
  { icon: 'folder-download-outline', title: 'Save to a folder', text: 'Backups and reports can be saved straight to a folder.' },
];

/** The one thing to do after updating. */
const AFTER_UPDATE = 'After updating, open More → Watch and data → Re-read my whole history once.';

const openWatchAndData = () => router.push({ pathname: '/settings/[section]', params: { section: 'data' } });

export function WhatsNewContent() {
  return (
    <View>
      <Text style={font.h2}>New in eepy 0.13</Text>
      <View style={{ marginTop: space.lg, gap: space.lg }}>
        {NEW.map((t) => (
          <View key={t.title} style={styles.item}>
            <View style={styles.itemIcon}>
              <Icon name={t.icon} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>{t.title}</Text>
              <Text style={font.small}>{t.text}</Text>
            </View>
          </View>
        ))}
        <View style={styles.item}>
          <View style={styles.itemIcon}>
            <Icon name="history" color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>One thing to do</Text>
            <Text style={font.small}>{AFTER_UPDATE}</Text>
          </View>
        </View>
      </View>
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
        <View style={styles.dim} />
        <Pressable style={StyleSheet.absoluteFill} onPress={done} accessibilityLabel="Close what's new" />
        <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}>
          <View style={styles.handle} />
          <ScrollView style={{ maxHeight: '100%' }} contentContainerStyle={{ paddingBottom: space.lg }} showsVerticalScrollIndicator={false}>
            <WhatsNewContent />
          </ScrollView>
          <View style={{ gap: space.sm }}>
            <Button label="Got it" icon="check" onPress={done} />
            <Button
              kind="ghost"
              label="Open Watch and data"
              onPress={() => {
                done();
                openWatchAndData();
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Marks the sheet as seen (new installs: there is nothing "new" for them). */
export function markWhatsNewSeen() {
  useStore.getState().setMark(WHATS_NEW_MARK, WHATS_NEW_ID);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  dim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: night.bg, opacity: 0.7 },
  sheet: { maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: space.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, marginBottom: space.md },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  itemIcon: { width: 28, alignItems: 'center', paddingTop: 1 },
});
