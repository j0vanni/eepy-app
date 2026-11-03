/**
 * Tonight's wind-down, step by step (engine/windDownPlan.ts): evening light, last meal and
 * exercise, wind-down, screens off, the screen-free routine and lights-out — with what's
 * happening now and a countdown to the next step. `compact` shows only what's still ahead. With
 * the e-ink reader setting on, the routine becomes reading time on the e-reader. With the bedtime
 * rundown on (the default) it shows that instead (ui/rundown/RundownCard.tsx).
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { eReaderIfOn } from '@/engine/eReader';
import { formatDuration, formatTime, MINUTE } from '@/engine/time';
import { currentWindDownStep, windDownTimeline } from '@/engine/windDownPlan';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Icon, Row } from '@/ui/components';
import { RundownCard } from '@/ui/rundown/RundownCard';
import { colors, font, space } from '@/ui/theme';

export function WindDownTimelineCard({ a, compact }: { a: Analysis; compact?: boolean }) {
  const rundown = useStore((s) => s.settings.rundown.enabled);
  return rundown ? <RundownCard a={a} compact={compact} /> : <PlainTimeline a={a} compact={compact} />;
}

function PlainTimeline({ a, compact }: { a: Analysis; compact?: boolean }) {
  const now = useNow(30_000);
  const screensOffMin = useStore((s) => s.settings.screensOffMin);
  const eReaderSetting = useStore((s) => s.settings.eReader);
  const eReader = eReaderIfOn(eReaderSetting);
  const steps = windDownTimeline(a.tonight, screensOffMin, { eReader });
  const current = currentWindDownStep(steps, now);
  const next = steps.find((s) => s.at > now);
  const shown = compact ? steps.filter((s) => s.at > now || s === current).slice(0, 4) : steps;
  if (shown.length === 0) return null;
  const off = steps.find((s) => s.id === 'screens-off');
  const eReaderNote = eReader
    ? ` Your e-reader is fine after that: e-ink reflects light like paper, so keep the frontlight low${eReader.warmLight ? ' and warm' : ''} and stick to books.`
    : '';

  return (
    <Card>
      <CardTitle
        icon="timeline-clock-outline"
        title={compact ? 'Tonight, step by step' : "Tonight's wind-down"}
        color={colors.light}
        sub={next ? `Next: ${next.title.toLowerCase()} in ${formatDuration(Math.max(1, Math.round((next.at - now) / MINUTE)))}` : undefined}
      />
      <View style={{ gap: space.sm }}>
        {shown.map((s) => {
          const isNow = s === current;
          const past = s.at <= now && !isNow;
          const tint = s.id === 'screens-off' ? colors.warn : s.id === 'lights-out' ? colors.accent : colors.light;
          return (
            <Row key={s.id} gap={space.md} style={{ alignItems: 'flex-start', opacity: past ? 0.45 : 1 }}>
              <View style={{ width: 30, alignItems: 'center', paddingTop: 2 }}>
                <Icon name={s.icon} size={20} color={isNow ? tint : colors.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Row gap={space.sm}>
                  <Text style={[font.body, { fontWeight: isNow ? '700' : '600', color: isNow ? tint : colors.text }]}>{s.title}</Text>
                  <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{isNow ? 'now' : formatTime(s.at)}</Text>
                </Row>
                {!compact || isNow || s.id === 'screens-off' ? <Text style={font.small}>{s.detail}</Text> : null}
              </View>
            </Row>
          );
        })}
      </View>
      {compact ? (
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="weather-night" label="Open wind-down" onPress={() => router.push('/winddown')} />
        </View>
      ) : off ? (
        <Text style={[font.tiny, { marginTop: space.md }]}>
          Screens off {screensOffMin} min before lights-out — what's on the screen keeps you up as much as its light.{eReaderNote} Change it in Settings → Wind-down &
          phone light.
        </Text>
      ) : null}
    </Card>
  );
}
