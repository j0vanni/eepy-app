import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';

import { addDays, atMinutes, dateKey, formatClock, formatDuration, MINUTE, normalizeMinutes } from '@/engine/time';
import type { SleepSession } from '@/engine/types';
import { writeSleepToHealthConnect } from '@/integrations/healthConnect';
import { useStore } from '@/state/store';
import { Button, Card, Row, Screen, Segmented, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

const RATINGS = ['😫', '😕', '😐', '🙂', '😄'];

export default function LogSleepScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const addManualSession = useStore((s) => s.addManualSession);
  const logDay = useStore((s) => s.logDay);
  const profile = useStore((s) => s.profile);
  const [kind, setKind] = useState<'main' | 'nap'>('main');
  const [wakeDate, setWakeDate] = useState(params.date ?? dateKey(Date.now()));
  const [bedMin, setBedMin] = useState(23 * 60);
  const [wakeMin, setWakeMin] = useState(profile.workWakeMin);
  const [napStart, setNapStart] = useState(14 * 60);
  const [napLen, setNapLen] = useState(25);
  const [latency, setLatency] = useState(15);
  const [rating, setRating] = useState<number>();
  const [natural, setNatural] = useState<boolean>();
  const [toHc, setToHc] = useState(Platform.OS === 'android');

  let start: number;
  let end: number;
  if (kind === 'main') {
    end = atMinutes(wakeDate, wakeMin);
    start = atMinutes(bedMin >= 12 * 60 ? addDays(wakeDate, -1) : wakeDate, bedMin);
  } else {
    start = atMinutes(wakeDate, napStart);
    end = start + napLen * MINUTE;
  }
  const valid = end - start > 10 * MINUTE && end - start < 16 * 60 * MINUTE;
  const lat = Math.min(latency, (end - start) / MINUTE - 5);

  const save = async () => {
    const onset = start + lat * MINUTE;
    const s: SleepSession = {
      id: `manual-${start}`,
      source: 'manual',
      start,
      end,
      kind,
      stages: [
        { stage: 'awake', start, end: onset },
        { stage: 'asleep', start: onset, end },
      ],
    };
    addManualSession(s);
    if (kind === 'main') logDay(wakeDate, { ...(rating ? { sleepRating: rating } : {}), ...(natural !== undefined ? { wokeNaturally: natural } : {}) });
    if (toHc) await writeSleepToHealthConnect(s).catch(() => false);
    router.back();
  };

  return (
    <Screen>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { label: 'Night sleep', value: 'main' },
          { label: 'Nap', value: 'nap' },
        ]}
      />
      <Card style={{ marginTop: space.md }}>
        <Stepper
          label={kind === 'main' ? 'Woke up on' : 'Date'}
          value={dayLabel(wakeDate)}
          onDec={() => setWakeDate(addDays(wakeDate, -1))}
          onInc={() => wakeDate < dateKey(Date.now()) && setWakeDate(addDays(wakeDate, 1))}
        />
        {kind === 'main' ? (
          <>
            <Stepper label="Went to bed" value={formatClock(bedMin)} onDec={() => setBedMin(normalizeMinutes(bedMin - 15))} onInc={() => setBedMin(normalizeMinutes(bedMin + 15))} />
            <Stepper label="Got up" value={formatClock(wakeMin)} onDec={() => setWakeMin(normalizeMinutes(wakeMin - 15))} onInc={() => setWakeMin(normalizeMinutes(wakeMin + 15))} />
          </>
        ) : (
          <>
            <Stepper label="Lay down at" value={formatClock(napStart)} onDec={() => setNapStart(normalizeMinutes(napStart - 15))} onInc={() => setNapStart(normalizeMinutes(napStart + 15))} />
            <Stepper label="Length" value={`${napLen} min`} onDec={() => setNapLen(Math.max(10, napLen - 5))} onInc={() => setNapLen(Math.min(180, napLen + 5))} />
          </>
        )}
        <Stepper label="Time to fall asleep" value={`${latency} min`} onDec={() => setLatency(Math.max(0, latency - 5))} onInc={() => setLatency(Math.min(120, latency + 5))} />
        <Text style={[font.small, { marginTop: space.sm }]}>
          {valid ? `≈ ${formatDuration((end - start) / MINUTE - lat)} asleep` : 'Check the times — that does not look like a sleep period.'}
        </Text>
      </Card>

      {kind === 'main' ? (
        <Card>
          <Text style={font.body}>How was it?</Text>
          <Row gap={space.sm} style={{ marginTop: 6 }}>
            {RATINGS.map((r, i) => (
              <Pressable key={r} onPress={() => setRating(i + 1)} style={{ padding: 8, borderRadius: 12, backgroundColor: rating === i + 1 ? colors.accentSoft : 'transparent' }}>
                <Text style={{ fontSize: 26 }}>{r}</Text>
              </Pressable>
            ))}
          </Row>
          <Segmented
            value={natural === undefined ? 'unset' : natural ? 'yes' : 'no'}
            onChange={(v) => setNatural(v === 'unset' ? undefined : v === 'yes')}
            options={[
              { label: 'Woke naturally', value: 'yes' },
              { label: 'Alarm', value: 'no' },
              { label: 'Not sure', value: 'unset' },
            ]}
          />
        </Card>
      ) : null}

      {Platform.OS === 'android' ? (
        <Card>
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={font.body}>Also save to Health Connect</Text>
              <Text style={font.small}>So other health apps see it too.</Text>
            </View>
            <Switch value={toHc} onValueChange={setToHc} trackColor={{ true: colors.accent, false: colors.border }} thumbColor={colors.text} />
          </Row>
        </Card>
      ) : null}

      <Button label="Save" icon="check" disabled={!valid} onPress={save} />
    </Screen>
  );
}
