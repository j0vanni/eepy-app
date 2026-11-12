/**
 * eepy follows its own phone-light advice (Settings → Wind-down & phone light → "Dim & warm eepy"): a faint
 * warm tint from the evening on, and from wind-down its window is dimmed (only eepy's own window,
 * only if the phone is brighter, and never too dark to read — engine/screenLight.EEPY_DIM).
 *
 * While eepy controls its own window brightness, the phone's brightness slider can't change it — so a
 * small **Brightness** button opens eepy's own slider (no permission needed), with "Auto-dim" and
 * "Use phone brightness". Setting it yourself turns the auto-dimming off until the next noon.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EEPY_DIM, EEPY_MANUAL_MIN_SLIDER, screenTargetAt } from '@/engine/screenLight';
import { formatTime } from '@/engine/time';
import { dimEepy, getScreenBrightness, setEepyBrightness, undimEepy } from '@/integrations/screen';
import { AUTO_BRIGHTNESS, eepyDimOn, eepyWindowMode, manualBrightness } from '@/state/screenDim';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { BrightnessSlider } from '@/ui/BrightnessSlider';
import { screenPlanFor } from '@/ui/cards/ScreenLightCard';
import { Button, Icon, IconButton, Row } from '@/ui/components';
import { selectionTick } from '@/ui/haptics';
import { colors, font, iconSize, radius, space, touch } from '@/ui/theme';

/** How strong the warm tint over the whole app is, by phase. */
const TINT = { evening: 0.04, winddown: 0.07, night: 0.08 } as const;
/** Above the tab bar (62) on the left. */
const PILL_BOTTOM = 62 + 14;

export function EveningScreen() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const insets = useSafeAreaInsets();
  const a = useAnalysis();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  const lastSent = useRef(0);
  const t = Date.now();
  const phase = settings.screenDim && a ? screenTargetAt(screenPlanFor(a, { rundown: settings.rundown, screensOffMin: settings.screensOffMin }), now).phase : undefined;
  const autoDimTo = phase === 'winddown' ? EEPY_DIM.winddown : phase === 'night' ? EEPY_DIM.night : undefined;
  const mode = eepyWindowMode(settings, t, autoDimTo);
  const key = mode.kind === 'phone' ? 'phone' : `${mode.kind}:${mode.slider}`;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (mode.kind === 'phone') {
      undimEepy();
      return;
    }
    if (mode.kind === 'manual') {
      setEepyBrightness(mode.slider);
      return;
    }
    const to = mode.slider;
    getScreenBrightness().then((b) => {
      if (b === undefined || b > to) dimEepy(to);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const tint = eepyDimOn(settings, t) && (phase === 'evening' || phase === 'winddown' || phase === 'night') ? TINT[phase] : 0;
  // The control shows while eepy sets its own brightness (auto-dimmed or set by you).
  const control = mode.kind !== 'phone';
  if (!tint && !control) return null;

  const set = (v: number, commit = false) => {
    // Apply while dragging, but not more than ~8 times a second.
    const n = Date.now();
    if (!commit && n - lastSent.current < 120) return;
    lastSent.current = n;
    setSettings(manualBrightness(n, Math.max(EEPY_MANUAL_MIN_SLIDER, v)));
  };
  const until = formatTime(manualBrightness(t).screenDimPausedUntil!);
  return (
    <>
      {tint ? <View style={[StyleSheet.absoluteFill, styles.tint, { opacity: tint }]} /> : null}
      {control && open ? (
        <View style={[styles.panel, { bottom: insets.bottom + PILL_BOTTOM + touch.min + space.sm }]}>
          <Row gap={space.sm}>
            <Text style={[font.h3, { flex: 1 }]}>eepy's brightness</Text>
            <IconButton icon="close" label="Close" onPress={() => setOpen(false)} />
          </Row>
          <Text style={font.small}>
            {mode.kind === 'auto' ? 'Dimmed for the evening. Drag to set it yourself.' : `Set by you until ${until}.`} Only eepy changes, not your phone.
          </Text>
          <BrightnessSlider value={mode.slider} onChange={(v) => set(v)} onCommit={(v) => set(v, true)} />
          <Row gap={space.sm} style={{ marginTop: space.xs, flexWrap: 'wrap' }}>
            {mode.kind === 'manual' && settings.screenDim ? (
              <Button
                small
                kind="ghost"
                icon="brightness-auto"
                label="Auto-dim"
                onPress={() => {
                  selectionTick();
                  setSettings(AUTO_BRIGHTNESS);
                }}
              />
            ) : null}
            <Button
              small
              kind="ghost"
              icon="cellphone"
              label="Use phone brightness"
              onPress={() => {
                selectionTick();
                setSettings(manualBrightness(Date.now(), undefined));
                setOpen(false);
              }}
            />
          </Row>
        </View>
      ) : null}
      {control ? (
        <Pressable
          onPress={() => setOpen(!open)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="eepy's brightness"
          accessibilityHint="Opens a brightness slider for eepy's screen"
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [styles.pill, { bottom: insets.bottom + PILL_BOTTOM }, pressed ? { opacity: 0.75 } : null]}
        >
          <Icon name="brightness-6" size={iconSize.sm} color={colors.textDim} />
          <Text style={[font.small, { color: colors.text, fontWeight: '700' }]}>Brightness</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // A warm wash over everything; touches pass through.
  tint: { backgroundColor: colors.warn, pointerEvents: 'none' },
  pill: {
    position: 'absolute',
    left: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  // A sheet floating over the page and its panels: one step lighter than a panel.
  panel: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    padding: space.lg,
    paddingTop: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    elevation: 12,
  },
});
