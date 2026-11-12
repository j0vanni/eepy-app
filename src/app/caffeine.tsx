/**
 * Log a drink, or change one already logged: what it was, when you had it, and what that means for
 * tonight — then one button.
 *
 * Params: `id` edits that drink (and can delete it); `usual=1` starts from the usual morning drink
 * at its usual time; `date` starts a new drink on that day.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { caffeineAt, caffeineCutoff, CAFFEINE_PRESETS } from '@/engine/caffeine';
import { drinkOptions, relativeTimeOptions, usualCaffeine, usualDose, usualDoseId } from '@/engine/caffeineHabits';
import { addDays, atMinutes, dateKey, formatClock, formatTime, HOUR, MINUTE, minutesOfDay } from '@/engine/time';
import type { CaffeineDose } from '@/engine/types';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Chip, Empty, Note, Screen, Segmented, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { colors, font, radius, space, touch } from '@/ui/theme';

const DEFAULT_DRINK = CAFFEINE_PRESETS[1];
const round5 = (t: number) => Math.round(t / (5 * MINUTE)) * 5 * MINUTE;
const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '');

const SHIFTS = [
  { label: '−1 h', ms: -HOUR, say: 'One hour earlier' },
  { label: '−5 m', ms: -5 * MINUTE, say: 'Five minutes earlier' },
  { label: '+5 m', ms: 5 * MINUTE, say: 'Five minutes later' },
  { label: '+1 h', ms: HOUR, say: 'One hour later' },
];

/** The time in the middle, an hour and five minutes either way on each side. */
function TimeStepper({ time, day, onShift }: { time: number; day: string; onShift: (ms: number) => void }) {
  const button = (s: (typeof SHIFTS)[number]) => (
    <Pressable key={s.label} onPress={() => onShift(s.ms)} hitSlop={4} accessibilityRole="button" accessibilityLabel={s.say} style={({ pressed }) => [styles.shift, pressed ? { backgroundColor: colors.border } : null]}>
      <Text style={[font.small, { color: colors.text, fontWeight: '700' }]}>{s.label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.timeRow}>
      {SHIFTS.slice(0, 2).map(button)}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={[font.h2, { fontVariant: ['tabular-nums'] }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatTime(time)}
        </Text>
        <Text style={font.tiny}>{dayLabel(day)}</Text>
      </View>
      {SHIFTS.slice(2).map(button)}
    </View>
  );
}

export default function DrinkEditor() {
  const params = useLocalSearchParams<{ id?: string; date?: string; usual?: string }>();
  const doses = useStore((s) => s.caffeine);
  const addCaffeine = useStore((s) => s.addCaffeine);
  const updateCaffeine = useStore((s) => s.updateCaffeine);
  const removeCaffeine = useStore((s) => s.removeCaffeine);
  const halfLife = useStore((s) => s.profile.caffeineHalfLifeH);
  const limit = useStore((s) => s.profile.caffeineBedtimeLimitMg);
  const a = useAnalysis();
  const customDrinks = useStore((s) => s.settings.customDrinks);
  const setSettings = useStore((s) => s.setSettings);
  const [newName, setNewName] = useState<string>();

  const [now] = useState(() => Date.now());
  const existing = params.id ? doses.find((d) => d.id === params.id) : undefined;
  const usual = useMemo(() => usualCaffeine(doses, now), [doses, now]);
  const [initial] = useState<CaffeineDose>(() => {
    if (existing) return existing;
    if (params.usual && usual) return usualDose(usual, now);
    const date = params.date && params.date <= dateKey(now) ? params.date : dateKey(now);
    const time = date === dateKey(now) ? Math.min(now, round5(now)) : atMinutes(date, 9 * 60);
    return { id: `c-${now}-${DEFAULT_DRINK.mg}`, time, mg: DEFAULT_DRINK.mg, label: DEFAULT_DRINK.label };
  });
  const [time, setTimeRaw] = useState(initial.time);
  const [mg, setMg] = useState(initial.mg);
  const [label, setLabel] = useState(initial.label);
  /** "Earlier" shows the time controls; a drink that already has its own time starts there. */
  const [earlier, setEarlier] = useState(() => !!existing || now - initial.time > 5 * MINUTE);
  const [closing, setClosing] = useState(false);

  if (params.id && !existing && !closing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Edit drink' }} />
        <Empty icon="coffee-off-outline" title="Drink not found" body="It may have been deleted already." />
      </Screen>
    );
  }

  // Logged drinks are in the past: anything later than now snaps back to now.
  const setTime = (t: number) => setTimeRaw(Math.min(t, Date.now()));
  const day = dateKey(time);
  const shift = (ms: number) => {
    selectionTick();
    setTime(time + ms);
  };
  const usualToday = usual ? atMinutes(day, usual.timeMin) : undefined;
  const quick = [
    ...(day === dateKey(now) ? relativeTimeOptions(Date.now()).filter((o) => o.label !== 'Now') : []),
    ...(usual && usualToday !== undefined && usualToday <= Date.now() ? [{ label: `Usual · ${formatClock(usual.timeMin)}`, time: usualToday }] : []),
    ...(existing ? [{ label: `Was ${formatTime(existing.time)}`, time: existing.time }] : []),
  ];

  // What this drink means for tonight.
  const bedtime = a?.tonight.bedtime;
  const others = doses.filter((d) => d.id !== initial.id && bedtime !== undefined && d.time > bedtime - 36 * HOUR);
  const atBed = bedtime !== undefined ? caffeineAt([...others, { id: 'x', time, mg, label }], bedtime, halfLife) : undefined;
  const wasAtBed = existing && bedtime !== undefined ? caffeineAt([...others, existing], bedtime, halfLife) : undefined;
  // The latest a standard drink still fits under the limit, this one aside.
  const cutoff = bedtime !== undefined ? caffeineCutoff(others, bedtime, halfLife, limit).cutoff : undefined;

  const done = () => {
    setClosing(true);
    confirmHaptic();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const save = () => {
    if (existing) updateCaffeine(existing.id, { time, mg, label });
    else {
      // The usual drink gets a per-day id so the notification's "Yes" can't log it a second time.
      const id = params.usual && usual && label === usual.label ? usualDoseId(day) : `c-${Date.now()}-${mg}`;
      if (doses.some((d) => d.id === id)) updateCaffeine(id, { time, mg, label });
      else addCaffeine({ id, time, mg, label });
    }
    done();
  };
  const remove = () => {
    if (existing) removeCaffeine(existing.id);
    done();
  };
  const saveOwnDrink = () => {
    const name = newName?.trim();
    if (!name) return;
    setSettings({ customDrinks: [{ label: name, mg }, ...customDrinks.filter((c) => c.label !== name)] });
    setLabel(name);
    setNewName(undefined);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? 'Edit drink' : 'Log a drink' }} />

      <Card>
        <CardTitle title="What" right={<Text style={[font.h3, { color: colors.caffeine, fontVariant: ['tabular-nums'] }]}>{mg} mg</Text>} />
        <View style={styles.wrap}>
          {drinkOptions(customDrinks).map((p) => (
            <Chip
              key={p.label}
              icon={customDrinks.some((c) => c.label === p.label) ? 'star-outline' : undefined}
              label={`${shortDrink(p.label)} · ${p.mg}`}
              selected={p.label === label}
              color={colors.caffeine}
              onPress={() => {
                setLabel(p.label);
                setMg(p.mg);
              }}
            />
          ))}
          <Chip icon="plus" label="Your own" selected={newName !== undefined} onPress={() => setNewName(newName === undefined ? '' : undefined)} />
        </View>
        <View style={{ marginTop: space.sm }}>
          <Stepper label="Amount" sub="Stronger or weaker than usual?" value={`${mg} mg`} onDec={() => setMg(Math.max(5, mg - 5))} onInc={() => setMg(Math.min(600, mg + 5))} />
        </View>
        {newName !== undefined ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <TextInput
              autoFocus
              value={newName}
              onChangeText={setNewName}
              placeholder="Name it, e.g. Instant coffee, 2 tsp"
              placeholderTextColor={colors.textFaint}
              maxLength={40}
              accessibilityLabel="Name of your drink"
              style={styles.input}
            />
            <Button small kind="secondary" icon="star-plus-outline" label={`Save "${newName.trim() || '…'}" · ${mg} mg`} disabled={!newName.trim()} onPress={saveOwnDrink} />
            <Text style={font.tiny}>Your own drinks come first everywhere.</Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <CardTitle title="When" right={<Text style={[font.h3, { fontVariant: ['tabular-nums'] }]}>{earlier ? `${dayLabel(day)} ${formatTime(time)}` : formatTime(time)}</Text>} />
        <Segmented
          options={[
            { label: 'Now', value: 'now' },
            { label: 'Earlier', value: 'earlier' },
          ]}
          value={earlier ? 'earlier' : 'now'}
          onChange={(v) => {
            setEarlier(v === 'earlier');
            if (v === 'now') setTime(Date.now());
          }}
        />
        {earlier ? (
          <>
            {quick.length ? (
              <View style={[styles.wrap, { marginTop: space.md }]}>
                {quick.map((q) => (
                  <Chip key={q.label} label={q.label} selected={Math.abs(q.time - time) < MINUTE} onPress={() => setTime(q.time)} />
                ))}
              </View>
            ) : null}
            <TimeStepper time={time} day={day} onShift={shift} />
            <Stepper
              label="Day"
              value={dayLabel(day)}
              onDec={() => setTime(atMinutes(addDays(day, -1), minutesOfDay(time)))}
              onInc={() => day < dateKey(Date.now()) && setTime(atMinutes(addDays(day, 1), minutesOfDay(time)))}
            />
          </>
        ) : null}
      </Card>

      {atBed !== undefined && bedtime !== undefined ? (
        <Note tone={atBed > limit ? 'warn' : 'info'} icon="weather-night">
          {`Tonight: about ${Math.round(atBed)} mg still active at lights-out (${formatTime(bedtime)})`}
          {wasAtBed !== undefined && Math.round(wasAtBed) !== Math.round(atBed) ? `, was ${Math.round(wasAtBed)} mg` : ''}
          {atBed > limit ? `. Over your ${limit} mg limit.` : `. Your limit is ${limit} mg.`}
          {cutoff !== undefined ? ` Cut-off for a coffee: ${formatTime(cutoff)}.` : ''}
        </Note>
      ) : null}

      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Button icon="check" label={existing ? 'Save' : 'Log it'} onPress={save} />
        {existing ? <Button kind="danger" icon="delete-outline" label="Delete" onPress={remove} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: { color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: space.md, fontSize: font.body.fontSize },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.xs },
  shift: { width: touch.comfy, height: touch.min, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
});
