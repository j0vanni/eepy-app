/**
 * Tonight's wind-down, step by step. With the bedtime rundown on (the default) it is the rundown
 * (ui/rundown/RundownCard.tsx). With it off, the plain plan (engine/windDownPlan.ts): evening light,
 * last meal and exercise, wind-down, screens off, the screen-free routine and lights-out — with the
 * e-ink reader setting on, the routine becomes reading time on the e-reader.
 *
 * `compact` (Plan → Tonight) is a panel with only what's still ahead; the full list (the wind-down
 * screen) is a captioned group straight on the page.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { eReaderIfOn } from '@/engine/eReader';
import { formatDuration, formatTime, MINUTE } from '@/engine/time';
import { currentWindDownStep, windDownTimeline } from '@/engine/windDownPlan';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Link, Section, Timeline, TimelineItem } from '@/ui/components';
import { RundownCard } from '@/ui/rundown/RundownCard';
import { font, space } from '@/ui/theme';

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
  const items: TimelineItem[] = shown.map((s) => ({
    key: s.id,
    time: formatTime(s.at),
    title: s.title,
    // The panel keeps to one line each, except what's happening now and the one that matters most.
    sub: !compact || s === current || s.id === 'screens-off' ? s.detail : undefined,
    state: s === current ? 'now' : s.at <= now ? 'done' : s === next ? 'next' : 'later',
  }));
  const nextIn = next ? `Next: ${next.title.toLowerCase()} in ${formatDuration(Math.max(1, Math.round((next.at - now) / MINUTE)))}` : undefined;

  if (compact) {
    return (
      <Card>
        <CardTitle icon="timeline-clock-outline" title="Tonight, step by step" sub={nextIn} />
        <Timeline items={items} />
        <View style={{ alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="weather-night" label="Open wind-down" onPress={() => router.push('/winddown')} />
        </View>
      </Card>
    );
  }
  return (
    <Section title="Tonight's wind-down" action={<Link label="Change" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'winddown' } })} />}>
      {nextIn ? <Text style={[font.small, { paddingHorizontal: space.xs, marginBottom: space.md }]}>{nextIn}</Text> : null}
      <Timeline items={items} />
      {off ? (
        <Text style={[font.tiny, { paddingHorizontal: space.xs }]}>
          Screens off {screensOffMin} min before lights-out: what's on the screen keeps you up as much as its light.
          {eReader ? ` Your e-reader is fine after that. Keep its frontlight low${eReader.warmLight ? ' and warm' : ''} and stick to books.` : ''}
        </Text>
      ) : null}
    </Section>
  );
}
