import { LightSensor } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Card, CardTitle, Note, Segmented } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

import { formatLux, LightContext, lightAdvice, LUX, luxMeterPosition, smoothLux } from '../light';

type Availability = 'checking' | 'yes' | 'no';

/**
 * Live ambient light from the phone's sensor (Android). Subscribes only while mounted and renders
 * nothing where there's no light sensor (web, iOS, some phones).
 */
export function LightCheckCard({ context }: { context: LightContext }) {
  const [available, setAvailable] = useState<Availability>(Platform.OS === 'android' ? 'checking' : 'no');
  const [lux, setLux] = useState<number | undefined>(undefined);
  const [mode, setMode] = useState<'evening' | 'morning'>(context === 'morning' ? 'morning' : 'evening');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    let sub: { remove(): void } | undefined;
    LightSensor.isAvailableAsync()
      .then((ok) => {
        if (cancelled) return;
        setAvailable(ok ? 'yes' : 'no');
        if (!ok) return;
        LightSensor.setUpdateInterval(500);
        sub = LightSensor.addListener(({ illuminance }) => setLux((prev) => smoothLux(prev, illuminance)));
      })
      .catch(() => {
        if (!cancelled) setAvailable('no');
      });
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  if (available !== 'yes') return null;

  const advice = lux === undefined ? undefined : lightAdvice(lux, mode);
  const markers = mode === 'evening' ? [LUX.eveningIdeal, LUX.eveningBright] : [LUX.indoorBright, LUX.outdoor];

  return (
    <Card>
      <CardTitle icon="brightness-6" title="Light check" color={colors.energy} />
      <Segmented
        options={[
          { label: 'Before bed', value: 'evening' as const },
          { label: 'Morning light', value: 'morning' as const },
        ]}
        value={mode}
        onChange={setMode}
      />
      <View style={styles.reading}>
        <Text style={styles.lux}>{lux === undefined ? '—' : formatLux(lux)}</Text>
        <Text style={[font.small, { marginLeft: 6, marginBottom: 8 }]}>lux</Text>
      </View>
      <View style={styles.meter}>
        <View style={[styles.meterFill, { width: `${luxMeterPosition(lux ?? 0) * 100}%`, backgroundColor: advice ? toneColor(advice.tone) : colors.border }]} />
        {markers.map((m) => (
          <View key={m} style={[styles.marker, { left: `${luxMeterPosition(m) * 100}%` }]} />
        ))}
      </View>
      <View style={styles.scale}>
        {[1, 10, 100, 1000, 10000].map((v) => (
          <Text key={v} style={font.tiny}>
            {formatLux(v)}
          </Text>
        ))}
      </View>
      {advice ? (
        <Note tone={advice.tone} icon={advice.tone === 'good' ? 'check-circle-outline' : mode === 'evening' ? 'lightbulb-on-outline' : 'white-balance-sunny'}>
          <Text style={{ fontWeight: '700' }}>{advice.title}. </Text>
          {advice.body}
        </Note>
      ) : (
        <Text style={font.small}>Reading the light sensor…</Text>
      )}
      <Text style={[font.tiny, { marginTop: space.xs }]}>
        {mode === 'evening'
          ? 'Hold the phone at eye level, screen facing you, where you sit. The sensor is near the front camera.'
          : 'Step outside or face a window, holding the phone at eye level.'}
      </Text>
    </Card>
  );
}

function toneColor(tone: 'good' | 'info' | 'warn' | 'bad'): string {
  return { good: colors.good, info: colors.info, warn: colors.warn, bad: colors.bad }[tone];
}

const styles = StyleSheet.create({
  reading: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.lg },
  lux: { fontSize: 44, fontWeight: '300', color: colors.text, fontVariant: ['tabular-nums'] },
  meter: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, marginTop: space.sm, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: radius.pill },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: colors.textFaint },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: space.md },
});
