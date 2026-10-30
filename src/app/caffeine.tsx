import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { caffeineAt, CAFFEINE_PRESETS } from '@/engine/caffeine';
import { drinkOptions, relativeTimeOptions, usualCaffeine, usualDose, usualDoseId } from '@/engine/caffeineHabits';
import { addDays, atMinutes, dateKey, formatClock, formatTime, HOUR, MINUTE, minutesOfDay } from '@/engine/time';
import type { CaffeineDose } from '@/engine/types';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Chip, Empty, Note, Row, Screen, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

const DEFAULT_DRINK = CAFFEINE_PRESETS[1];
const round5 = (t: number) => Math.round(t / (5 * MINUTE)) * 5 * MINUTE;
const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '');
const SHIFTS = [
  { label: '−1 h', ms: -HOUR },
  { label: '−15 m', ms: -15 * MINUTE },
  { label: '+15 m', ms: 15 * MINUTE },
  { label: '+1 h', ms: HOUR },
];

/**
 * Log a drink after the fact, or change the time / amount of one already logged.
 * Params: `id` edits that drink; `usual=1` starts from the usual morning drink at its usual time;
 * `date` starts a new drink on that day.
 */
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
  const shift = (ms: number) => setTime(time + ms);
  const usualToday = usual ? atMinutes(day, usual.timeMin) : undefined;
  const quick = [
    ...(day === dateKey(now) ? relativeTimeOptions(Date.now()) : []),
    ...(usual && usualToday !== undefined && usualToday <= Date.now() ? [{ label: `Usual · ${formatClock(usual.timeMin)}`, time: usualToday }] : []),
    ...(existing ? [{ label: `Was ${formatTime(existing.time)}`, time: existing.time }] : []),
  ];

  // What this drink means for tonight.
  const bedtime = a?.tonight.bedtime;
  const others = doses.filter((d) => d.id !== initial.id && bedtime !== undefined && d.time > bedtime - 36 * HOUR);
  const atBed = bedtime !== undefined ? caffeineAt([...others, { id: 'x', time, mg, label }], bedtime, halfLife) : undefined;
  const wasAtBed = existing && bedtime !== undefined ? caffeineAt([...others, existing], bedtime, halfLife) : undefined;

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

  return (
    <Screen subtitle={existing ? 'Forgot to log it on time? Move it to when you actually drank it.' : 'Log a drink at the time you actually had it.'}>
      <Stack.Screen options={{ title: existing ? 'Edit drink' : 'Log a drink' }} />

      <Card>
        <CardTitle icon="clock-outline" title="When" color={colors.caffeine} />
        <View style={{ alignItems: 'center', marginBottom: space.sm }}>
          <Text style={[font.stat, { color: colors.caffeine, fontVariant: ['tabular-nums'] }]}>{formatTime(time)}</Text>
          <Text style={font.small}>{dayLabel(day)}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {quick.map((q) => (
            <Chip key={q.label} label={q.label} selected={Math.abs(q.time - time) < MINUTE} onPress={() => setTime(q.time)} />
          ))}
        </View>
        <Stepper label="Fine-tune" sub="5-minute steps" value={formatTime(time)} onDec={() => shift(-5 * MINUTE)} onInc={() => shift(5 * MINUTE)} />
        <Row gap={space.sm}>
          {SHIFTS.map((s) => (
            <View key={s.label} style={{ flex: 1 }}>
              <Button small kind="secondary" label={s.label} onPress={() => shift(s.ms)} />
            </View>
          ))}
        </Row>
        <Stepper
          label="Day"
          value={dayLabel(day)}
          onDec={() => setTime(atMinutes(addDays(day, -1), minutesOfDay(time)))}
          onInc={() => day < dateKey(Date.now()) && setTime(atMinutes(addDays(day, 1), minutesOfDay(time)))}
        />
      </Card>

      <Card>
        <CardTitle icon="coffee-outline" title="What" color={colors.caffeine} right={<Text style={font.h3}>{mg} mg</Text>} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
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
          <Chip icon="plus" label="Your own drink" selected={newName !== undefined} onPress={() => setNewName(newName === undefined ? '' : undefined)} />
        </View>
        <Stepper label="Amount" sub="Stronger or weaker than usual?" value={`${mg} mg`} onDec={() => setMg(Math.max(5, mg - 5))} onInc={() => setMg(Math.min(600, mg + 5))} />
        {newName !== undefined ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Text style={font.small}>Name it, set the amount above, and it's saved as one of your drinks (they show first everywhere).</Text>
            <TextInput
              autoFocus
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Instant coffee, 2 tsp"
              placeholderTextColor={colors.textFaint}
              maxLength={40}
              style={{ color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, fontSize: 15 }}
            />
            <Button
              small
              icon="star-plus-outline"
              label={`Save "${newName.trim() || '…'}" · ${mg} mg`}
              onPress={() => {
                const name = newName.trim();
                if (!name) return;
                setSettings({ customDrinks: [{ label: name, mg }, ...customDrinks.filter((c) => c.label !== name)] });
                setLabel(name);
                setNewName(undefined);
              }}
            />
          </View>
        ) : null}
      </Card>

      {atBed !== undefined && bedtime !== undefined ? (
        <Note tone={atBed > limit ? 'warn' : 'info'} icon="weather-night">
          {`At lights-out (${formatTime(bedtime)}) about ${Math.round(atBed)} mg will still be active`}
          {wasAtBed !== undefined && Math.round(wasAtBed) !== Math.round(atBed) ? ` (was ${Math.round(wasAtBed)} mg)` : ''}
          {atBed > limit ? ` — over your ${limit} mg bedtime limit.` : ` · your limit is ${limit} mg.`}
        </Note>
      ) : null}

      <Row gap={space.sm} style={{ marginTop: space.lg }}>
        {existing ? (
          <View style={{ flex: 1 }}>
            <Button kind="secondary" icon="delete-outline" label="Delete" onPress={remove} />
          </View>
        ) : null}
        <View style={{ flex: 2 }}>
          <Button icon="check" label={existing ? 'Save' : 'Log drink'} onPress={save} />
        </View>
      </Row>
    </Screen>
  );
}
