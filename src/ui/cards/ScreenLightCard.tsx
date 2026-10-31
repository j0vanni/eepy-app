/**
 * Phone light: what the screen should be like right now (brightness and blue-light filter), how
 * it compares with the phone's actual brightness, and shortcuts to Android's Night Light and
 * Extra dim. `full` adds the whole evening schedule and the Night Light times to set.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, Switch, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { judgeScreenBrightness, nightLightSchedule, ScreenPlanInput, screenLightSchedule, screenTargetAt } from '@/engine/screenLight';
import { formatTime } from '@/engine/time';
import {
  askPhoneBrightnessPermission,
  canSetPhoneBrightness,
  dimEepy,
  getAutoBrightness,
  getScreenBrightness,
  openExtraDimSettings,
  openNightLightSettings,
  screenControlsSupported,
  setAutoBrightness,
  setPhoneBrightness,
} from '@/integrations/screen';
import { BrightnessSlider } from '@/ui/BrightnessSlider';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Note, Row } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const FILTER_LABEL = { off: 'No filter needed', warm: 'Night Light on', warmest: 'Night Light warmest + Extra dim' } as const;

export function screenPlanFor(a: Analysis): ScreenPlanInput {
  return { wakeTime: a.wakeTime, windDownStart: a.tonight.windDownStart, bedtime: a.tonight.bedtime, nextWake: a.tonight.wake };
}

interface PhoneScreen {
  brightness?: number;
  canSet: boolean;
  auto?: boolean;
}

/** The phone's brightness and control state, re-read every half minute and whenever eepy comes back to the front. */
function usePhoneScreen(): [PhoneScreen, (patch: Partial<PhoneScreen>) => void, () => void] {
  const [state, setState] = useState<PhoneScreen>({ canSet: false });
  const alive = useRef(true);
  const read = () => {
    Promise.all([getScreenBrightness(), canSetPhoneBrightness()]).then(async ([brightness, canSet]) => {
      const auto = canSet ? await getAutoBrightness() : undefined;
      if (alive.current) setState({ brightness, canSet, auto });
    });
  };
  useEffect(() => {
    alive.current = true;
    read();
    const id = setInterval(read, 30_000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && read());
    return () => {
      alive.current = false;
      clearInterval(id);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [state, (patch) => setState((cur) => ({ ...cur, ...patch })), read];
}

/** Drag to set the phone's brightness, after the one-time "Modify system settings" permission. */
function PhoneBrightness({ target, phone, patch, refresh }: { target?: number; phone: PhoneScreen; patch: (p: Partial<PhoneScreen>) => void; refresh: () => void }) {
  const lastSent = useRef(0);
  if (!screenControlsSupported() || phone.brightness === undefined) return null;

  const live = (v: number) => {
    // Apply while dragging, but not more than ~8 times a second.
    patch({ brightness: v });
    const now = Date.now();
    if (now - lastSent.current < 120) return;
    lastSent.current = now;
    setPhoneBrightness(v);
  };
  const commit = async (v: number) => {
    patch({ brightness: v, auto: false });
    await setPhoneBrightness(v);
  };
  return (
    <View style={{ marginTop: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={font.body}>Phone brightness</Text>
        {phone.canSet && phone.auto !== undefined ? (
          <Row gap={6}>
            <Text style={font.small}>Auto</Text>
            <Switch
              value={phone.auto}
              onValueChange={async (on) => {
                patch({ auto: on });
                await setAutoBrightness(on);
                refresh();
              }}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.text}
            />
          </Row>
        ) : null}
      </Row>
      <BrightnessSlider value={phone.brightness} target={target} onChange={live} onCommit={commit} disabled={!phone.canSet} />
      {phone.canSet ? (
        <Row gap={space.sm} style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {target !== undefined && target < 1 && phone.brightness > target + 0.02 ? (
            <Button small icon="brightness-5" label={`Set to ${Math.round(target * 100)}%`} onPress={() => commit(target)} />
          ) : null}
          <Text style={[font.tiny, { flex: 1 }]}>Changes your phone's brightness everywhere{phone.auto ? '' : ' — auto-brightness is off while you set it by hand'}.</Text>
        </Row>
      ) : (
        <View style={{ marginTop: space.sm, gap: space.sm }}>
          <Text style={font.small}>To change your phone's brightness from here, Android needs you to allow "Modify system settings" for eepy once.</Text>
          <View style={{ alignItems: 'flex-start' }}>
            <Button small icon="shield-check-outline" label="Allow brightness control" onPress={async () => patch({ canSet: await askPhoneBrightnessPermission() })} />
          </View>
        </View>
      )}
    </View>
  );
}

/** "Screen at 70% — too bright for now" against the current target. */
function BrightnessCheck({ target, brightness }: { target: ReturnType<typeof screenTargetAt>; brightness?: number }) {
  const verdict = judgeScreenBrightness(brightness, target);
  if (!verdict) return null;
  return (
    <View style={{ marginTop: space.sm }}>
      <Note tone={verdict.tone === 'good' ? 'good' : verdict.tone === 'warn' ? 'warn' : 'bad'} icon="brightness-6">
        {verdict.text}
      </Note>
    </View>
  );
}

export function ScreenLightCard({ a, full }: { a: Analysis; full?: boolean }) {
  const now = useNow(30_000);
  const [phone, patchPhone, refreshPhone] = usePhoneScreen();
  const plan = screenPlanFor(a);
  const target = screenTargetAt(plan, now);
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
      <BrightnessCheck target={target} brightness={phone.brightness} />
      <PhoneBrightness target={target.maxBrightness < 1 ? target.maxBrightness : undefined} phone={phone} patch={patchPhone} refresh={refreshPhone} />

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
