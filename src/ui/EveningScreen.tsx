/**
 * eepy follows its own phone-light advice (Settings → Wind-down → "Dim & warm eepy"): a faint
 * warm tint from the evening on, and from wind-down its window is dimmed to the target (only
 * eepy's own window, and only if the phone is brighter than that). Daytime: no change.
 */
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { screenTargetAt } from '@/engine/screenLight';
import { dimEepy, getScreenBrightness, undimEepy } from '@/integrations/screen';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { screenPlanFor } from '@/ui/cards/ScreenLightCard';

const TINT = { evening: 0.06, winddown: 0.1, night: 0.12 } as const;

export function EveningScreen() {
  const enabled = useStore((s) => s.settings.screenDim);
  const a = useAnalysis();
  const now = useNow(60_000);
  const phase = enabled && a ? screenTargetAt(screenPlanFor(a), now).phase : undefined;
  const dimTo = phase === 'winddown' ? 0.15 : phase === 'night' ? 0.08 : undefined;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (dimTo === undefined) {
      undimEepy();
      return;
    }
    getScreenBrightness().then((b) => {
      if (b === undefined || b > dimTo) dimEepy(dimTo);
    });
  }, [dimTo]);

  const tint = phase === 'evening' || phase === 'winddown' || phase === 'night' ? TINT[phase] : 0;
  if (!tint) return null;
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(255, 140, 40, ${tint})`, pointerEvents: 'none' }]} />;
}
