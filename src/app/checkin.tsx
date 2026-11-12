/**
 * Quick check-in: "How alert are you right now?" answered with one tap — the rating eepy's energy
 * forecast is fitted to. Saving is the tap itself (Undo takes it back). Under it, the other things
 * worth logging in passing: a coffee, the day's energy, a nap, tags — each a row that opens in
 * place — and the reaction test, the journal and Log sleep.
 *
 * Param `up`: opened by the wake alarm's "I'm up" (alarm = the full-screen alarm, watch = the
 * watch buzz), which also ends the night's sleep session.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { caffeineAt } from '@/engine/caffeine';
import { drinkOptions, frequentDrinks, relativeTimeOptions, usualCaffeine, usualDose } from '@/engine/caffeineHabits';
import { TAG_BY_ID } from '@/engine/tags';
import { addDays, dateKey, formatClock, formatTime, HOUR, MINUTE, minutesOfDay } from '@/engine/time';
import { endInBedSession } from '@/state/inBed';
import { napsOn } from '@/state/napLog';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { Button, Chip, Fold, Hero, Icon, Link, ListCard, ListRow, Row, Screen, Section } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { AlertnessPicker, ChoiceTile } from '@/ui/learning/QuickCheckIn';
import { EnterView } from '@/ui/motion';
import { NapLogCard } from '@/ui/NapLog';
import { colors, font, radius, space, touch } from '@/ui/theme';

const ENERGY = ['Exhausted', 'Tired', 'OK', 'Good', 'Energised'];
const QUICK_TAGS = ['alcohol', 'late-meal', 'exercise', 'stress', 'nap', 'outdoor-light', 'screens', 'late-caffeine'];
/** The "Saved" message fades after this; the screen itself stays open until you tap Done. */
const TOAST_MS = 4000;

const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '').replace('Espresso shot', 'Espresso');

interface Toast {
  text: string;
  undo?: () => void;
  /** e.g. "Change" for a drink just logged. */
  edit?: { label: string; run: () => void };
  n: number;
}

export default function CheckInScreen() {
  const { up } = useLocalSearchParams<{ up?: string }>();
  const analysis = useAnalysis();
  const now = useNow(5000);
  // The "living" day: before 4am still counts as yesterday.
  const day = minutesOfDay(now) < 240 ? addDays(dateKey(now), -1) : dateKey(now);
  const log = useStore((s) => s.dayLogs[day]);
  const checkins = useStore((s) => s.checkins);
  const doses = useStore((s) => s.caffeine);
  const sessions = useStore((s) => s.sessions);
  const halfLife = useStore((s) => s.profile.caffeineHalfLifeH);
  const customDrinks = useStore((s) => s.settings.customDrinks);
  const addCheckIn = useStore((s) => s.addCheckIn);
  const removeCheckIn = useStore((s) => s.removeCheckIn);
  const logDay = useStore((s) => s.logDay);
  const addCaffeine = useStore((s) => s.addCaffeine);
  const removeCaffeine = useStore((s) => s.removeCaffeine);
  const toggleTag = useStore((s) => s.toggleTag);
  const insets = useSafeAreaInsets();

  /** The rating given on this visit: tapping another answer replaces it instead of adding one. */
  const [kssId, setKssId] = useState<string>();
  const [toast, setToast] = useState<Toast>();
  const [moreDrinks, setMoreDrinks] = useState(false);
  /** Minutes ago the drink was had (forgot to log it straight away?). */
  const [agoMin, setAgoMin] = useState(0);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // "I'm up" on the wake alarm ends tonight's sleep session (sleep mode and sounds off) — once.
  useEffect(() => {
    if (up === 'alarm' || up === 'watch') endInBedSession(up, analysis).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [up]);

  // Log several things in one go: only the message goes away, the screen stays until Done.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const logged = (text: string, undo?: () => void, edit?: Toast['edit']) => {
    confirmHaptic();
    setToast({ text, undo, edit, n: (toast?.n ?? 0) + 1 });
  };

  const recent = checkins.filter((c) => c.time <= now && now - c.time < 3 * HOUR);
  const lastKss = kssId ? checkins.find((c) => c.id === kssId) : recent[recent.length - 1];
  const caffeineNow = caffeineAt(
    doses.filter((d) => d.time > now - 36 * HOUR && d.time <= now),
    now,
    halfLife,
  );

  const pickKss = (kss: number) => {
    const id = kssId ?? `ci-${Date.now()}`;
    setKssId(id);
    addCheckIn({ id, time: Date.now(), kss, source: 'manual' });
    confirmHaptic();
  };
  const undoKss = () => {
    if (kssId) removeCheckIn(kssId);
    setKssId(undefined);
  };
  const pickEnergy = (energy: number) => {
    const prev = log?.energy;
    logDay(day, { energy });
    logged(`Energy today: ${ENERGY[energy - 1].toLowerCase()}`, () => logDay(day, { energy: prev }));
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

  // What you drink most comes first; "More" shows everything, your own drinks included.
  const options = drinkOptions(customDrinks);
  const drinks = moreDrinks ? options : frequentDrinks(doses, now, options);
  const napCount = napsOn(sessions, dateKey(now)).length;
  const tagCount = QUICK_TAGS.filter((id) => log?.tags.includes(id)).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Screen>
        <Hero
          value="How alert are you right now?"
          caption={
            lastKss && !kssId
              ? `Your last answer was ${lastKss.kss} of 9, at ${formatTime(lastKss.time)}. One tap saves a new one.`
              : 'One tap saves it. Your energy forecast is fitted to these answers.'
          }
        />
        <AlertnessPicker value={lastKss?.kss} onPick={pickKss} />
        {kssId ? (
          <Row gap={space.sm} style={styles.saved}>
            <Icon name="check-circle" color={colors.good} />
            <Text style={[font.small, { flex: 1, color: colors.text }]}>Saved. Tap another answer to change it.</Text>
            <Link label="Undo" onPress={undoKss} />
          </Row>
        ) : null}

        <Section title="Also log">
          <ListCard>
            {usual && !hadToday && minutesOfDay(now) >= usual.timeMin ? (
              <ListRow
                icon="coffee"
                iconColor={colors.caffeine}
                title="Had your usual?"
                sub={`${shortDrink(usual.label)} · ${usual.mg} mg at ${formatClock(usual.timeMin)}`}
                onPress={logUsual}
                right={<Text style={styles.rowAction}>Log it</Text>}
              />
            ) : null}
            <Fold bare icon="coffee-outline" title="Coffee" sub="Tap a drink to log it" value={caffeineNow >= 1 ? `${Math.round(caffeineNow)} mg active` : undefined}>
              <View style={styles.wrap}>
                {relativeTimeOptions(now).map((o) => {
                  const min = Math.round((now - o.time) / MINUTE);
                  return <Chip key={o.label} label={o.label} selected={agoMin === min} onPress={() => setAgoMin(min)} />;
                })}
              </View>
              <View style={[styles.wrap, { marginTop: space.md }]}>
                {drinks.map((p) => (
                  <Chip key={p.label} icon="coffee-outline" label={`${shortDrink(p.label)} · ${p.mg}`} color={colors.caffeine} onPress={() => drink(p.label, p.mg)} />
                ))}
                <Chip label={moreDrinks ? 'Fewer' : 'More'} onPress={() => setMoreDrinks(!moreDrinks)} />
              </View>
            </Fold>
            <Fold bare icon="lightning-bolt-outline" title="Energy today" sub="The day as a whole, 1 to 5" value={log?.energy ? ENERGY[log.energy - 1] : undefined}>
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                {ENERGY.map((label, i) => (
                  <ChoiceTile key={label} small onPanel top={String(i + 1)} label={label} selected={log?.energy === i + 1} onPress={() => pickEnergy(i + 1)} hint={`Energy ${i + 1}: ${label}`} />
                ))}
              </View>
            </Fold>
            <Fold bare icon="sleep" title="A nap you took" sub="The watch can miss short ones" value={napCount ? `${napCount} today` : undefined}>
              <NapLogCard bare />
            </Fold>
            <Fold bare icon="tag-outline" title="Tags for today" sub="Things that may affect tonight" value={tagCount ? `${tagCount} on` : undefined}>
              <View style={styles.wrap}>
                {QUICK_TAGS.map((id) => (
                  <Chip key={id} icon={TAG_BY_ID[id].icon} label={TAG_BY_ID[id].label} selected={log?.tags.includes(id)} onPress={() => tag(id)} />
                ))}
              </View>
            </Fold>
          </ListCard>
        </Section>

        <Section title="More">
          <ListCard>
            <ListRow icon="gesture-tap" title="Reaction test" sub="One minute, objective" onPress={() => router.replace('/reaction')} />
            <ListRow icon="notebook-edit-outline" title="Journal" sub="Notes and every tag for the day" onPress={() => router.replace('/journal')} />
            <ListRow icon="bed-clock" title="Log sleep" sub="A night or nap the watch missed" onPress={() => router.replace('/log-sleep')} />
          </ListCard>
        </Section>

        <Button kind="ghost" label="Done" onPress={close} />
        {/* Room for the "Saved" message, which floats over the end of the page. */}
        <View style={{ height: space.xxl * 2 }} />
      </Screen>

      {toast ? (
        <EnterView key={toast.n} style={[styles.toast, { bottom: insets.bottom + space.lg }]}>
          <Icon name="check-circle" color={colors.good} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '600' }]} numberOfLines={toast.edit ? 2 : 1}>
              {toast.text}
            </Text>
            <Text style={font.tiny}>Saved · log more or tap Done</Text>
          </View>
          {toast.edit ? <Link label={toast.edit.label} onPress={toast.edit.run} /> : null}
          {toast.undo ? (
            <Link
              label="Undo"
              onPress={() => {
                toast.undo?.();
                setToast(undefined);
              }}
            />
          ) : null}
        </EnterView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  saved: { minHeight: touch.min, marginTop: space.xs, paddingHorizontal: space.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rowAction: { color: colors.accent, fontWeight: '700', fontSize: font.small.fontSize },
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    elevation: 10,
  },
});
