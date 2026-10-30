import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { caffeineAt } from '@/engine/caffeine';
import { drinkOptions, frequentDrinks, relativeTimeOptions, usualCaffeine, usualDose } from '@/engine/caffeineHabits';
import { TAG_BY_ID } from '@/engine/tags';
import { addDays, dateKey, formatClock, formatTime, HOUR, MINUTE, minutesOfDay } from '@/engine/time';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Chip, Icon, Row, Screen, Section } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { EnterView } from '@/ui/motion';
import { colors, font, radius, space } from '@/ui/theme';

/** Karolinska Sleepiness Scale. */
const KSS = [
  'Extremely alert',
  'Very alert',
  'Alert',
  'Rather alert',
  'Neither alert nor sleepy',
  'Some signs of sleepiness',
  'Sleepy, easy to stay awake',
  'Sleepy, effort to stay awake',
  'Fighting sleep',
];
const KSS_COLOR = ['#5FD3A5', '#5FD3A5', '#7FD0B8', '#6CC6FF', '#9B8CFF', '#B48CF0', '#FFB86B', '#FF9E7A', '#FF7A90'];
const ENERGY = ['Exhausted', 'Tired', 'OK', 'Good', 'Energised'];
const QUICK_TAGS = ['alcohol', 'late-meal', 'exercise', 'stress', 'nap', 'outdoor-light', 'screens', 'late-caffeine'];
const CLOSE_AFTER_MS = 2200;

const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '').replace('Espresso shot', 'Espresso');

interface Toast {
  text: string;
  undo?: () => void;
  /** e.g. "Change time" for a drink just logged. */
  edit?: { label: string; run: () => void };
  n: number;
}

export default function CheckInSheet() {
  const now = useNow(5000);
  // The "living" day: before 4am still counts as yesterday.
  const day = minutesOfDay(now) < 240 ? addDays(dateKey(now), -1) : dateKey(now);
  const log = useStore((s) => s.dayLogs[day]);
  const checkins = useStore((s) => s.checkins);
  const doses = useStore((s) => s.caffeine);
  const halfLife = useStore((s) => s.profile.caffeineHalfLifeH);
  const customDrinks = useStore((s) => s.settings.customDrinks);
  const addCheckIn = useStore((s) => s.addCheckIn);
  const removeCheckIn = useStore((s) => s.removeCheckIn);
  const logDay = useStore((s) => s.logDay);
  const addCaffeine = useStore((s) => s.addCaffeine);
  const removeCaffeine = useStore((s) => s.removeCaffeine);
  const toggleTag = useStore((s) => s.toggleTag);
  const insets = useSafeAreaInsets();

  const [kssId, setKssId] = useState<string>();
  const [toast, setToast] = useState<Toast>();
  const [keepOpen, setKeepOpen] = useState(false);
  const [moreDrinks, setMoreDrinks] = useState(false);
  /** Minutes ago the drink was had (forgot to log it straight away?). */
  const [agoMin, setAgoMin] = useState(0);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // Dismiss shortly after the last thing logged, unless asked to stay.
  useEffect(() => {
    if (!toast || keepOpen) return;
    const id = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), CLOSE_AFTER_MS);
    return () => clearTimeout(id);
  }, [toast, keepOpen]);

  const logged = (text: string, undo?: () => void, edit?: Toast['edit']) => {
    confirmHaptic();
    setToast({ text, undo, edit, n: (toast?.n ?? 0) + 1 });
  };

  const recent = checkins.filter((c) => c.time <= now && now - c.time < 3 * HOUR);
  const lastKss = kssId ? checkins.find((c) => c.id === kssId) : recent[recent.length - 1];
  const caffeineNow = caffeineAt(doses.filter((d) => d.time > now - 36 * HOUR && d.time <= now), now, halfLife);

  const pickKss = (kss: number) => {
    // Changing your mind in the same sheet replaces the rating instead of adding another.
    const id = kssId ?? `ci-${Date.now()}`;
    setKssId(id);
    addCheckIn({ id, time: Date.now(), kss, source: 'manual' });
    logged(`Sleepiness ${kss} logged`, () => {
      removeCheckIn(id);
      setKssId(undefined);
    });
  };
  const pickEnergy = (energy: number) => {
    const prev = log?.energy;
    logDay(day, { energy });
    logged(`Energy ${energy} (${ENERGY[energy - 1].toLowerCase()}) logged`, () => logDay(day, { energy: prev }));
  };
  const editDrink = (id: string) => ({ label: 'Change', run: () => router.replace({ pathname: '/caffeine', params: { id } }) });
  const drink = (label: string, mg: number) => {
    const time = Date.now() - agoMin * MINUTE;
    const id = `c-${Date.now()}-${mg}`;
    addCaffeine({ id, time, mg, label });
    logged(`${shortDrink(label)} · ${mg} mg at ${formatTime(time)}`, () => removeCaffeine(id), editDrink(id));
  };
  const usual = usualCaffeine(doses, now);
  const hadToday = doses.some((d) => dateKey(d.time) === dateKey(now));
  const logUsual = () => {
    if (!usual) return;
    const dose = usualDose(usual, Date.now());
    if (doses.some((d) => d.id === dose.id)) return;
    addCaffeine(dose);
    logged(`${shortDrink(dose.label)} · ${dose.mg} mg at ${formatTime(dose.time)}`, () => removeCaffeine(dose.id), editDrink(dose.id));
  };
  const tag = (id: string) => {
    const on = !(log?.tags.includes(id) ?? false);
    toggleTag(day, id);
    logged(`${TAG_BY_ID[id].label} ${on ? 'added' : 'removed'}`, () => toggleTag(day, id));
  };
  const go = (path: '/journal' | '/log-sleep') => router.replace(path);

  // What you drink most comes first; "More…" shows everything, your own drinks included.
  const options = drinkOptions(customDrinks);
  const drinks = moreDrinks ? options : frequentDrinks(doses, now, options);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Screen>
        <Section title="How sleepy are you right now?">
          <View style={styles.grid}>
            {KSS.map((label, i) => {
              const v = i + 1;
              const selected = lastKss?.kss === v;
              const c = KSS_COLOR[i];
              return (
                <Pressable
                  key={v}
                  onPress={() => pickKss(v)}
                  style={({ pressed }) => [styles.kss, { borderColor: selected ? c : colors.border, backgroundColor: selected ? c : pressed ? colors.surfaceAlt : colors.surface }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${v}: ${label}`}
                >
                  <Text style={[styles.kssNum, { color: selected ? '#140F33' : c }]}>{v}</Text>
                  <Text style={[styles.kssLabel, { color: selected ? '#140F33' : colors.textDim }]} numberOfLines={2}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[font.tiny, { marginTop: 6 }]}>
            {lastKss && !kssId ? `Last rating ${lastKss.kss} at ${formatTime(lastKss.time)}. ` : ''}Each rating teaches eepy your body clock and counts for nap advice for 3 hours.
          </Text>
        </Section>

        <Section title="Energy today">
          <Row gap={space.sm}>
            {ENERGY.map((label, i) => {
              const v = i + 1;
              const selected = log?.energy === v;
              return (
                <Pressable
                  key={v}
                  onPress={() => pickEnergy(v)}
                  style={({ pressed }) => [styles.energy, selected ? { backgroundColor: colors.energy, borderColor: colors.energy } : pressed ? { backgroundColor: colors.surfaceAlt } : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Energy ${v}: ${label}`}
                >
                  <Text style={[font.h2, { color: selected ? '#140F33' : colors.text }]}>{v}</Text>
                  <Text style={[font.tiny, { color: selected ? '#140F33' : colors.textDim }]} numberOfLines={1}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </Section>

        <Section title="Coffee & caffeine" action={<Text style={font.small}>{caffeineNow >= 1 ? `${Math.round(caffeineNow)} mg active` : ''}</Text>}>
          {usual && !hadToday && minutesOfDay(now) >= usual.timeMin ? (
            <Pressable onPress={logUsual} style={({ pressed }) => [styles.usual, pressed ? { opacity: 0.7 } : null]} accessibilityRole="button">
              <Icon name="coffee" size={20} color={colors.caffeine} />
              <View style={{ flex: 1 }}>
                <Text style={[font.body, { fontWeight: '600' }]}>Had your usual?</Text>
                <Text style={font.small}>
                  {shortDrink(usual.label)} · {usual.mg} mg at {formatClock(usual.timeMin)} — tap to log it at that time
                </Text>
              </View>
            </Pressable>
          ) : null}
          <Text style={[font.tiny, { marginBottom: 6 }]}>When?</Text>
          <View style={[styles.wrap, { marginBottom: space.sm }]}>
            {relativeTimeOptions(now).map((o) => {
              const min = Math.round((now - o.time) / MINUTE);
              return <Chip key={o.label} label={o.label} selected={agoMin === min} onPress={() => setAgoMin(min)} />;
            })}
          </View>
          <View style={styles.wrap}>
            {drinks.map((p) => (
              <Chip key={p.label} icon="coffee-outline" label={`${shortDrink(p.label)} · ${p.mg}`} color={colors.caffeine} onPress={() => drink(p.label, p.mg)} />
            ))}
            <Chip label={moreDrinks ? 'Fewer' : 'More…'} onPress={() => setMoreDrinks(!moreDrinks)} />
          </View>
        </Section>

        <Section title="Tag today">
          <View style={styles.wrap}>
            {QUICK_TAGS.map((id) => (
              <Chip key={id} icon={TAG_BY_ID[id].icon} label={TAG_BY_ID[id].label} selected={log?.tags.includes(id)} onPress={() => tag(id)} />
            ))}
          </View>
        </Section>

        <Row gap={space.sm} style={{ marginTop: space.xl }}>
          <View style={{ flex: 1 }}>
            <Button kind="secondary" icon="notebook-edit-outline" label="Journal" onPress={() => go('/journal')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button kind="secondary" icon="bed-clock" label="Log sleep" onPress={() => go('/log-sleep')} />
          </View>
        </Row>
        <View style={{ marginTop: space.sm }}>
          <Button kind="ghost" label="Done" onPress={close} />
        </View>
        <View style={{ height: 72 }} />
      </Screen>

      {toast ? (
        <EnterView key={toast.n} style={[styles.toast, { bottom: insets.bottom + 16 }]}>
          <Icon name="check-circle" size={20} color={colors.good} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '600' }]} numberOfLines={toast.edit ? 2 : 1}>
              {toast.text}
            </Text>
            <Text style={font.tiny}>{keepOpen ? 'Saved' : 'Saved · closing…'}</Text>
          </View>
          {toast.edit ? (
            <Pressable onPress={toast.edit.run} hitSlop={8} accessibilityRole="button">
              <Text style={[font.small, { color: colors.accent, fontWeight: '700' }]}>{toast.edit.label}</Text>
            </Pressable>
          ) : null}
          {toast.undo ? (
            <Pressable
              onPress={() => {
                toast.undo?.();
                setToast(undefined);
                setKeepOpen(true);
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={[font.small, { color: colors.accent, fontWeight: '700' }]}>Undo</Text>
            </Pressable>
          ) : null}
          {!keepOpen ? (
            <Pressable onPress={() => setKeepOpen(true)} hitSlop={8} accessibilityRole="button">
              <Text style={[font.small, { color: colors.textDim, fontWeight: '700' }]}>Keep open</Text>
            </Pressable>
          ) : null}
        </EnterView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kss: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 76,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'space-between',
  },
  kssNum: { fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  kssLabel: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  energy: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  usual: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    marginBottom: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.caffeine,
    backgroundColor: colors.surface,
  },
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
