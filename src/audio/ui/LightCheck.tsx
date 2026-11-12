/**
 * Light check: live ambient light from the phone's sensor (Android), against what is good before
 * bed or in the morning. `useLightSensorAvailable` tells a screen whether to offer it at all (no
 * sensor on web, iOS and some phones); `LightCheck` reads the sensor only while it is on screen.
 */
import { LightSensor } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Note, Segmented } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

import { formatLux, LightContext, lightAdvice, LUX, luxMeterPosition, smoothLux } from '../light';

/** Whether this phone has a light sensor eepy can read. False until known. */
export function useLightSensorAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    LightSensor.isAvailableAsync()
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

/** The smoothed reading, while mounted. */
function useLux(): number | undefined {
  const [lux, setLux] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    LightSensor.setUpdateInterval(500);
    const sub = LightSensor.addListener(({ illuminance }) => setLux((prev) => smoothLux(prev, illuminance)));
    return () => sub.remove();
  }, []);
  return lux;
}

const TONE_COLOR = { good: colors.good, info: colors.info, warn: colors.warn, bad: colors.bad };

export function LightCheck({ context }: { context: LightContext }) {
  const lux = useLux();
  const [mode, setMode] = useState<'evening' | 'morning'>(context === 'morning' ? 'morning' : 'evening');
  const advice = lux === undefined ? undefined : lightAdvice(lux, mode);
  const markers = mode === 'evening' ? [LUX.eveningIdeal, LUX.eveningBright] : [LUX.indoorBright, LUX.outdoor];

  return (
    <View>
      <Segmented
        options={[
          { label: 'Before bed', value: 'evening' as const },
          { label: 'Morning light', value: 'morning' as const },
        ]}
        value={mode}
        onChange={setMode}
      />
      <View style={styles.reading}>
        <Text style={styles.lux}>{lux === undefined ? '–' : formatLux(lux)}</Text>
        <Text style={styles.unit}>lux</Text>
      </View>
      <View style={styles.meter}>
        <View style={[styles.meterFill, { width: `${luxMeterPosition(lux ?? 0) * 100}%`, backgroundColor: advice ? TONE_COLOR[advice.tone] : colors.border }]} />
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
        {mode === 'evening' ? 'Hold the phone at eye level where you sit, screen facing you. The sensor is near the front camera.' : 'Step outside or face a window, holding the phone at eye level.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  reading: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.lg },
  // The one number of the check: between h1 and display.
  lux: { ...font.display, fontSize: 44, lineHeight: 50, letterSpacing: -1 },
  unit: { ...font.small, marginLeft: space.sm, marginBottom: space.sm },
  meter: { height: 8, borderRadius: radius.pill, backgroundColor: colors.border, marginTop: space.sm, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: radius.pill },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: colors.textFaint },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs, marginBottom: space.md },
});
