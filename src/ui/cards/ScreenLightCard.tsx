/**
 * Phone light: what the screen should be like right now (brightness and blue-light filter), how
 * it compares with the phone's actual brightness, and shortcuts to Android's Night Light and
 * Extra dim. `full` adds the whole evening schedule and the Night Light times to set.
 */
import { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { judgeScreenBrightness, nightLightSchedule, ScreenPlanInput, screenLightSchedule, screenTargetAt } from '@/engine/screenLight';
import { formatTime } from '@/engine/time';
import { dimEepy, getScreenBrightness, openExtraDimSettings, openNightLightSettings, screenControlsSupported } from '@/integrations/screen';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Note, Row } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const FILTER_LABEL = { off: 'No filter needed', warm: 'Night Light on', warmest: 'Night Light warmest + Extra dim' } as const;

export function screenPlanFor(a: Analysis): ScreenPlanInput {
  return { wakeTime: a.wakeTime, windDownStart: a.tonight.windDownStart, bedtime: a.tonight.bedtime, nextWake: a.tonight.wake };
}

/** The phone's brightness, re-read every half minute and whenever eepy comes back to the front. */
function useScreenBrightness(): number | undefined {
  const [value, setValue] = useState<number>();
  useEffect(() => {
    let alive = true;
    const read = () => getScreenBrightness().then((v) => alive && setValue(v));
    read();
    const id = setInterval(read, 30_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => {
      alive = false;
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return value;
}

export function ScreenLightCard({ a, full }: { a: Analysis; full?: boolean }) {
  const now = useNow(30_000);
  const brightness = useScreenBrightness();
  const plan = screenPlanFor(a);
  const target = screenTargetAt(plan, now);
  const verdict = judgeScreenBrightness(brightness, target);
  const evening = target.phase === 'evening' || target.phase === 'winddown' || target.phase === 'night';
  const upcoming = screenLightSchedule(plan).filter((t) => t.until > now && (t.phase === 'evening' || t.phase === 'winddown' || t.phase === 'night'));
  const nl = nightLightSchedule(plan);
  const android = screenControlsSupported();

  return (
    <Card>
      <CardTitle
        icon={evening ? 'cellphone-cog' : 'cellphone'}
        title="Phone light"
        color={colors.light}
        right={<Text style={font.small}>{target.maxBrightness < 1 ? `≤ ${Math.round(target.maxBrightness * 100)}% · ${FILTER_LABEL[target.filter]}` : FILTER_LABEL.off}</Text>}
      />
      <Text style={font.h3}>{target.title}</Text>
      <Text style={[font.small, { marginTop: 2 }]}>{target.advice}</Text>
      {verdict ? (
        <View style={{ marginTop: space.sm }}>
          <Note tone={verdict.tone === 'good' ? 'good' : verdict.tone === 'warn' ? 'warn' : 'bad'} icon="brightness-6">
            {verdict.text}
          </Note>
        </View>
      ) : null}

      {full || !evening ? (
        <View style={{ marginTop: space.sm, gap: 4 }}>
          {upcoming.map((t) => (
            <Row key={t.phase} gap={space.sm}>
              <Text style={[font.small, { width: 84, color: t.phase === target.phase ? colors.text : colors.textDim, fontWeight: t.phase === target.phase ? '700' : '400' }]}>
                {t.phase === target.phase ? 'Now' : formatTime(t.from)}
              </Text>
              <Text style={[font.small, { flex: 1 }]}>
                {t.phase === 'night' ? 'Screen away' : `≤ ${Math.round(t.maxBrightness * 100)}% · ${FILTER_LABEL[t.filter]}`}
              </Text>
            </Row>
          ))}
        </View>
      ) : null}

      {full ? (
        <Text style={[font.tiny, { marginTop: space.sm }]}>
          Set Night Light to a custom schedule: on at {formatTime(nl.on)}, off at {formatTime(nl.off)} — then it happens by itself. Blue light matters, but brightness
          matters more: a warm filter cuts the blue, dimming cuts all of it.
        </Text>
      ) : null}

      {android ? (
        <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
          <Button small kind="secondary" icon="weather-night" label="Night Light" onPress={() => openNightLightSettings()} />
          {target.filter === 'warmest' ? <Button small kind="secondary" icon="brightness-4" label="Extra dim" onPress={() => openExtraDimSettings()} /> : null}
          {target.maxBrightness < 1 ? <Button small kind="ghost" icon="brightness-5" label="Dim eepy now" onPress={() => dimEepy(target.maxBrightness)} /> : null}
        </Row>
      ) : null}
    </Card>
  );
}
