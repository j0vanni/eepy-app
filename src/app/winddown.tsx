import { Text, View } from 'react-native';

import { BreathingCard } from '@/audio/ui/Breathing';
import { LightCheckCard } from '@/audio/ui/LightCheck';
import { SoundsCard } from '@/audio/ui/SoundControls';
import { Checklist, CountdownHero } from '@/audio/ui/WindDownParts';
import { lightContextAt } from '@/audio/light';
import { dateKey } from '@/engine/time';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { ScreenLightCard } from '@/ui/cards/ScreenLightCard';
import { Screen } from '@/ui/components';
import { font, space } from '@/ui/theme';

/** Wind-down routine: countdown to lights-out, checklist, breathing, sleep sounds and a light check. */
export default function WindDownScreen() {
  const analysis = useAnalysis();
  const now = useNow(30_000);
  const nightKey = analysis?.tonight.wakeDate ?? dateKey(now);
  const lightContext = lightContextAt(now, {
    wakeTime: analysis?.wakeTime,
    windDownStart: analysis?.tonight.windDownStart,
    bedtime: analysis?.tonight.bedtime,
  });

  return (
    <Screen>
      <CountdownHero analysis={analysis} now={now} />
      <Checklist key={nightKey} nightKey={nightKey} />
      <BreathingCard />
      <SoundsCard />
      <LightCheckCard context={lightContext} />
      {analysis ? <ScreenLightCard a={analysis} full /> : null}
      <View style={{ marginTop: space.sm, paddingHorizontal: space.sm }}>
        <Text style={[font.tiny, { textAlign: 'center' }]}>
          Same time, same steps, every night — the routine itself becomes a cue for sleep.
        </Text>
      </View>
    </Screen>
  );
}
