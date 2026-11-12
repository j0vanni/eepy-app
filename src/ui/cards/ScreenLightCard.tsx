/**
 * Phone light: what the screen should be like right now (brightness and blue-light filter), how
 * it compares with the phone's actual brightness, and shortcuts to Android's Night Light and
 * Extra dim. `full` adds the rest of the evening and the Night Light times to set. `embedded` has
 * no panel or title of its own, for use inside a Fold or a section that already says "Phone light".
 * With the e-ink reader setting on, an "E-reader" block adds its frontlight target (engine/eReader.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { EReader, eReaderIfOn, eReaderSchedule, eReaderTargetAt } from '@/engine/eReader';
import { phoneDownAt } from '@/engine/rundown';
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
  undimEepy,
} from '@/integrations/screen';
import { eepyWindowMode, manualBrightness } from '@/state/screenDim';
import { Settings, useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { BrightnessSlider } from '@/ui/BrightnessSlider';
import { AppSwitch, Button, Card, CardTitle, Divider, KeyValue, Note, Row, Timeline } from '@/ui/components';
import { font, space } from '@/ui/theme';
import { Caption } from '@/ui/today/nightParts';

const FILTER_LABEL = { off: 'No filter needed', warm: 'Night Light on', warmest: 'Night Light warmest + Extra dim' } as const;

/** Tonight's phone-light plan; the "screen away" phase starts at phone-down (the bedtime rundown's, or screens-off when it's off). */
export function screenPlanFor(a: Analysis, s: Pick<Settings, 'rundown' | 'screensOffMin'>): ScreenPlanInput {
  return {
    wakeTime: a.wakeTime,
    windDownStart: a.tonight.windDownStart,
    bedtime: a.tonight.bedtime,
    nextWake: a.tonight.wake,
    screensOff: phoneDownAt(a.tonight, s),
  };
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
function PhoneBrightness({
  target,
  phone,
  patch,
  refresh,
  dimming,
}: {
  target?: number;
  phone: PhoneScreen;
  patch: (p: Partial<PhoneScreen>) => void;
  refresh: () => void;
  /** eepy is (or may be) auto-dimming its own screen now (wind-down / night). */
  dimming: boolean;
}) {
  const lastSent = useRef(0);
  if (!screenControlsSupported() || phone.brightness === undefined) return null;

  // While eepy dims (or sets) its own screen, the phone's brightness wouldn't show in eepy: hand it
  // back to the phone's brightness until tomorrow noon, so what you drag is what you see.
  const release = () => {
    const st = useStore.getState();
    if (eepyWindowMode(st.settings, Date.now(), dimming ? 1 : undefined).kind !== 'phone') st.setSettings(manualBrightness(Date.now(), undefined));
    undimEepy();
  };
  const live = (v: number) => {
    if (lastSent.current === 0) release();
    // Apply while dragging, but not more than ~8 times a second.
    patch({ brightness: v });
    const now = Date.now();
    if (now - lastSent.current < 120) return;
    lastSent.current = now;
    setPhoneBrightness(v);
  };
  const commit = async (v: number) => {
    release();
    lastSent.current = 0;
    patch({ brightness: v, auto: false });
    await setPhoneBrightness(v);
  };
  const tooBright = target !== undefined && target < 1 && phone.brightness > target + 0.02;
  return (
    <View style={{ marginTop: space.md }}>
      <Row gap={space.sm}>
        <Text style={[font.body, { flex: 1 }]}>Phone brightness</Text>
        {phone.canSet && phone.auto !== undefined ? (
          <>
            <Text style={font.small}>Auto</Text>
            <AppSwitch
              value={phone.auto}
              label="Automatic brightness"
              onChange={async (on) => {
                patch({ auto: on });
                await setAutoBrightness(on);
                refresh();
              }}
            />
          </>
        ) : null}
      </Row>
      <BrightnessSlider value={phone.brightness} target={target} onChange={live} onCommit={commit} disabled={!phone.canSet} />
      {phone.canSet ? (
        <>
          {tooBright ? (
            <View style={{ alignItems: 'flex-start', marginTop: space.xs }}>
              <Button small kind="secondary" icon="brightness-5" label={`Set to ${Math.round(target * 100)}%`} onPress={() => commit(target)} />
            </View>
          ) : null}
          <Text style={[font.tiny, { marginTop: space.sm }]}>Changes the whole phone, not just eepy.{phone.auto ? '' : ' Auto-brightness is off while you set it by hand.'}</Text>
        </>
      ) : (
        <View style={{ alignItems: 'flex-start', marginTop: space.xs, gap: space.sm }}>
          <Text style={font.small}>To change it from here, allow "Modify system settings" for eepy once.</Text>
          <Button small kind="secondary" icon="shield-check-outline" label="Allow brightness control" onPress={async () => patch({ canSet: await askPhoneBrightnessPermission() })} />
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
    <View style={{ marginTop: space.md }}>
      <Note tone={verdict.tone} icon="brightness-6">
        {verdict.text}
      </Note>
    </View>
  );
}

/** The e-reader's frontlight target now; `full` adds the rest of the evening. */
function EReaderBlock({ plan, now, eReader, full }: { plan: ScreenPlanInput; now: number; eReader: EReader; full?: boolean }) {
  const target = eReaderTargetAt(plan, now, eReader);
  const upcoming = eReaderSchedule(plan, eReader).filter((t) => t.until > now && t.phase !== 'day');
  return (
    <View>
      <Divider />
      <Caption>{`E-reader · ${target.summary}`}</Caption>
      <Text style={[font.h3, { marginTop: space.xs }]}>{target.title}</Text>
      {full ? (
        <>
          <Text style={[font.small, { marginTop: space.xxs, marginBottom: space.md }]}>{target.advice}</Text>
          <Timeline
            items={upcoming.map((t) => ({ key: t.phase, time: t.phase === target.phase ? 'Now' : formatTime(t.from), title: t.summary, state: t.phase === target.phase ? ('now' as const) : ('later' as const) }))}
          />
        </>
      ) : null}
    </View>
  );
}

export function ScreenLightCard({ a, full, embedded }: { a: Analysis; full?: boolean; embedded?: boolean }) {
  const now = useNow(30_000);
  const [phone, patchPhone, refreshPhone] = usePhoneScreen();
  const screensOffMin = useStore((st) => st.settings.screensOffMin);
  const rundown = useStore((st) => st.settings.rundown);
  const eReader = eReaderIfOn(useStore((st) => st.settings.eReader));
  const plan = screenPlanFor(a, { rundown, screensOffMin });
  const target = screenTargetAt(plan, now);
  const evening = target.phase === 'evening' || target.phase === 'winddown' || target.phase === 'night';
  const upcoming = screenLightSchedule(plan).filter((t) => t.until > now && (t.phase === 'evening' || t.phase === 'winddown' || t.phase === 'night'));
  const nl = nightLightSchedule(plan);
  const android = screenControlsSupported();

  const status = target.maxBrightness < 1 ? `≤ ${Math.round(target.maxBrightness * 100)}% · ${FILTER_LABEL[target.filter]}` : FILTER_LABEL.off;
  const body = (
    <>
      {embedded ? <Caption>{`Now · ${status}`}</Caption> : <CardTitle icon={evening ? 'cellphone-cog' : 'cellphone'} title="Phone light" right={<Text style={font.small}>{status}</Text>} />}
      <Text style={[font.h3, embedded ? { marginTop: space.xs } : null]}>{target.title}</Text>
      <Text style={[font.small, { marginTop: space.xxs }]}>{target.advice}</Text>
      <BrightnessCheck target={target} brightness={phone.brightness} />
      <PhoneBrightness
        target={target.maxBrightness < 1 ? target.maxBrightness : undefined}
        phone={phone}
        patch={patchPhone}
        refresh={refreshPhone}
        dimming={target.phase === 'winddown' || target.phase === 'night'}
      />

      {android ? (
        <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
          <Button small kind="secondary" icon="weather-night" label="Night Light" onPress={() => openNightLightSettings()} />
          {target.filter === 'warmest' ? <Button small kind="secondary" icon="brightness-4" label="Extra dim" onPress={() => openExtraDimSettings()} /> : null}
          {target.maxBrightness < 1 ? <Button small kind="ghost" icon="brightness-5" label="Dim eepy now" onPress={() => dimEepy(target.maxBrightness)} /> : null}
        </Row>
      ) : null}

      {(full || !evening) && upcoming.length ? (
        <View style={{ marginTop: space.lg }}>
          <Caption style={{ marginBottom: space.sm }}>This evening</Caption>
          <Timeline
            items={upcoming.map((t) => ({
              key: t.phase,
              time: t.phase === target.phase ? 'Now' : formatTime(t.from),
              title: t.phase === 'night' ? 'Screen away' : `≤ ${Math.round(t.maxBrightness * 100)}% · ${FILTER_LABEL[t.filter]}`,
              state: t.phase === target.phase ? ('now' as const) : ('later' as const),
            }))}
          />
        </View>
      ) : null}

      {full ? (
        <KeyValue
          label="Night Light schedule"
          sub="Set it once in Android and it runs by itself. Dimming matters more than the warm filter."
          value={`${formatTime(nl.on)} – ${formatTime(nl.off)}`}
          onPress={android ? () => openNightLightSettings() : undefined}
        />
      ) : null}

      {eReader ? <EReaderBlock plan={plan} now={now} eReader={eReader} full={full} /> : null}
    </>
  );
  return embedded ? <View>{body}</View> : <Card>{body}</Card>;
}
