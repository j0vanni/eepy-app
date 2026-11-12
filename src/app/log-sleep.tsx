/**
 * Log a night (or a nap) yourself, for sleep the watch didn't record: what it was, when, how it
 * went, then Save. Param `date` preselects the morning you woke up.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text } from 'react-native';

import { addDays, atMinutes, dateKey, formatClock, formatDuration, MINUTE, normalizeMinutes } from '@/engine/time';
import type { SleepSession } from '@/engine/types';
import { writeSleepToHealthConnect } from '@/integrations/healthConnect';
import { useStore } from '@/state/store';
import { Button, Card, Chip, Row, Screen, Section, Segmented, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { Toggle } from '@/ui/settings/Toggle';
import { Question, RatingFaces } from '@/ui/sleep/parts';
import { colors, font, space } from '@/ui/theme';

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

  const step = (value: number, set: (v: number) => void, by: number) => () => set(normalizeMinutes(value + by));

  return (
    <Screen subtitle="For sleep your watch didn't record.">
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { label: 'A night', value: 'main' },
          { label: 'A nap', value: 'nap' },
        ]}
      />

      <Section title="When">
        <Card>
          <Stepper
            label={kind === 'main' ? 'Woke up on' : 'Day'}
            value={dayLabel(wakeDate)}
            onDec={() => setWakeDate(addDays(wakeDate, -1))}
            onInc={() => wakeDate < dateKey(Date.now()) && setWakeDate(addDays(wakeDate, 1))}
          />
          {kind === 'main' ? (
            <>
              <Stepper label="Went to bed" value={formatClock(bedMin)} onDec={step(bedMin, setBedMin, -15)} onInc={step(bedMin, setBedMin, 15)} />
              <Stepper label="Got up" value={formatClock(wakeMin)} onDec={step(wakeMin, setWakeMin, -15)} onInc={step(wakeMin, setWakeMin, 15)} />
            </>
          ) : (
            <>
              <Stepper label="Lay down at" value={formatClock(napStart)} onDec={step(napStart, setNapStart, -15)} onInc={step(napStart, setNapStart, 15)} />
              <Stepper label="For how long" value={`${napLen} min`} onDec={() => setNapLen(Math.max(10, napLen - 5))} onInc={() => setNapLen(Math.min(180, napLen + 5))} />
            </>
          )}
          <Stepper label="Time to fall asleep" value={`${latency} min`} onDec={() => setLatency(Math.max(0, latency - 5))} onInc={() => setLatency(Math.min(120, latency + 5))} />
          <Text style={[valid ? font.h3 : font.small, { marginTop: space.sm, color: valid ? colors.text : colors.warn }]}>
            {valid ? `About ${formatDuration((end - start) / MINUTE - lat)} asleep` : 'Check the times: that does not look like a sleep period.'}
          </Text>
        </Card>
      </Section>

      {kind === 'main' ? (
        <Section title="How it went">
          <Card>
            <Question first>How did you sleep?</Question>
            <RatingFaces value={rating} onChange={setRating} />
            <Question>Did you wake up on your own?</Question>
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              {/* Tapping the chosen answer again clears it ("not sure"). */}
              <Chip label="Yes" icon="weather-sunny" selected={natural === true} onPress={() => setNatural(natural === true ? undefined : true)} />
              <Chip label="No, alarm or woken" icon="alarm" selected={natural === false} onPress={() => setNatural(natural === false ? undefined : false)} />
            </Row>
            <Text style={[font.tiny, { marginTop: space.sm }]}>Leave it empty if you're not sure.</Text>
          </Card>
        </Section>
      ) : null}

      {Platform.OS === 'android' ? (
        <Section title="Also">
          <Card style={{ paddingVertical: space.xs }}>
            <Toggle label="Save to Health Connect too" sub="So other health apps see it." value={toHc} onChange={setToHc} />
          </Card>
        </Section>
      ) : null}

      <Button label={kind === 'main' ? 'Save night' : 'Save nap'} icon="check" disabled={!valid} onPress={save} style={{ marginTop: space.md }} />
    </Screen>
  );
}
