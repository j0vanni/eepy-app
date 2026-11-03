/**
 * Settings → Wind-down & phone light → E-ink reader: "I read on an e-ink reader" (Kindle, Kobo,
 * Boox…) and whether it has a warm light. When on, the wind-down timeline gets reading time from
 * screens-off to lights-out, the Phone light card an e-reader frontlight target, and the
 * screens-off reminder and "can't sleep? get up and read" advice mention it (engine/eReader.ts).
 */
import { Text, View } from 'react-native';

import { formatTime } from '../../engine/time';
import { usePhoneDown } from '../../state/rundown';
import { EReaderSettings, useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { Card, CardTitle, Icon, Row, Section } from '../components';
import { colors, font, space } from '../theme';
import { Toggle } from './Toggle';

export function EReaderSection() {
  const eReader = useStore((s) => s.settings.eReader);
  const rundown = useStore((s) => s.settings.rundown);
  const setSettings = useStore((s) => s.setSettings);
  const analysis = useAnalysis();
  const set = (patch: Partial<EReaderSettings>) => setSettings({ eReader: { ...eReader, ...patch } });
  const tonight = analysis?.tonight;
  const off = usePhoneDown(analysis);
  // With the bedtime rundown, reading time is its own step (and can be none).
  const reading = !rundown.enabled || rundown.readingMin > 0;

  return (
    <Section title="E-ink reader">
      <Card>
        <CardTitle icon="book-open-variant" title="Reading before bed" color={colors.light} />
        <Text style={font.small}>
          Kindle, Kobo, Boox… E-ink reflects light like paper instead of shining it at you, so with the frontlight low (and warm) an e-reader is fine after screens-off —
          unlike your phone or a tablet.
        </Text>
        <Toggle
          label="I read on an e-ink reader"
          sub={eReader.enabled ? 'Your wind-down has reading time until lights-out, with frontlight tips' : 'Off — screens-off means every screen'}
          value={eReader.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        {eReader.enabled ? (
          <>
            <Toggle
              label="It has a warm / amber light"
              sub={eReader.warmLight ? 'Warmth up in the evening, all the way at bedtime' : 'No warm light: keep it low — a bedside lamp on the page beats the frontlight'}
              value={eReader.warmLight}
              onChange={(warmLight) => set({ warmLight })}
            />
            {tonight && off !== undefined && off < tonight.bedtime ? (
              <Row gap={space.sm} style={{ marginTop: space.xs, alignItems: 'flex-start' }}>
                <Icon name="clock-outline" size={18} color={colors.textDim} />
                <Text style={[font.small, { flex: 1 }]}>
                  {reading
                    ? `Tonight: phone away at ${formatTime(off)}, then read until lights-out at ${formatTime(tonight.bedtime)}.`
                    : `Tonight: phone away at ${formatTime(off)}. Reading time is off in your bedtime rundown.`}
                </Text>
              </Row>
            ) : null}
            <View style={{ marginTop: space.sm }}>
              <Text style={font.tiny}>
                Keep it to reading: on Android readers like Boox, leave the browser and other apps closed, and turn notifications off at night. Woken up and can't get
                back to sleep? Read in a chair in another room with the frontlight at its lowest until you're sleepy.
              </Text>
            </View>
          </>
        ) : null}
      </Card>
    </Section>
  );
}
