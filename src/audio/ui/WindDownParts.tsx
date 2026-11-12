/**
 * The wind-down screen's own pieces: the countdown to lights-out at the top, and the plain
 * "before lights-out" checklist (shown when the bedtime rundown is off).
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatDuration, formatTime } from '@/engine/time';
import { useNow } from '@/state/useAnalysis';
import { Hero, Icon, ListCard, Meter, Note, Section } from '@/ui/components';
import { until } from '@/ui/format';
import { colors, font, space, touch } from '@/ui/theme';

import { WIND_DOWN_CHECKLIST, windDownStatus } from '../windDown';

/** The one thing the screen is about: how long until lights-out (and, before wind-down, when it starts). */
export function CountdownHero({ analysis }: { analysis: Analysis | undefined }) {
  // Its own clock: the last ten minutes count down by the second.
  const now = useNow(1000);
  if (!analysis) {
    return <Hero label="Wind-down" value="Tonight" caption="Sync a few nights from your watch for your own lights-out time. Everything below works already." />;
  }
  const t = analysis.tonight;
  const s = windDownStatus(now, t);
  if (s.phase === 'after') {
    return (
      <Hero
        label="Past lights-out"
        value="Time to sleep"
        caption={`Lights out was ${formatTime(t.bedtime)}, ${formatDuration(-s.minToBedtime)} ago · wake ${formatTime(t.wake)}. Phone face down. Sounds keep playing.`}
      />
    );
  }
  const winding = s.phase === 'during';
  return (
    <Hero
      label={winding ? 'Winding down · lights out in' : 'Lights out in'}
      value={until(t.bedtime - now)}
      caption={winding ? `At ${formatTime(t.bedtime)} · wake ${formatTime(t.wake)}` : `At ${formatTime(t.bedtime)} · wind-down starts ${formatTime(t.windDownStart)}, in ${formatDuration(s.minToWindDown)}`}
    >
      {winding ? (
        <View style={{ marginTop: space.md }}>
          <Meter value={s.progress} max={1} color={colors.sleep} />
        </View>
      ) : null}
    </Hero>
  );
}

// Ticks survive leaving and re-opening the screen during this app session, per night.
const ticksByNight = new Map<string, string[]>();

export function Checklist({ nightKey }: { nightKey: string }) {
  const [done, setDone] = useState<string[]>(() => ticksByNight.get(nightKey) ?? []);
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    ticksByNight.set(nightKey, next);
    setDone(next);
  };
  const all = done.length === WIND_DOWN_CHECKLIST.length;
  return (
    <Section title="Before lights-out" action={<Text style={[font.small, all ? { color: colors.good } : null]}>{`${done.length} of ${WIND_DOWN_CHECKLIST.length}`}</Text>}>
      <ListCard>
        {WIND_DOWN_CHECKLIST.map((item) => {
          const checked = done.includes(item.id);
          return (
            <Pressable
              key={item.id}
              onPress={() => toggle(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: touch.comfy + space.xs }, pressed ? { opacity: 0.65 } : null]}
            >
              <Icon name={checked ? 'check-circle' : 'checkbox-blank-circle-outline'} size={24} color={checked ? colors.good : colors.textFaint} />
              <View style={{ flex: 1 }}>
                <Text style={[font.body, checked ? { color: colors.textFaint, textDecorationLine: 'line-through' } : null]}>{item.title}</Text>
                <Text style={font.small}>{item.sub}</Text>
              </View>
            </Pressable>
          );
        })}
      </ListCard>
      {all ? (
        <Note tone="good" icon="weather-night">
          All set. Keep the lights low from here.
        </Note>
      ) : null}
    </Section>
  );
}
