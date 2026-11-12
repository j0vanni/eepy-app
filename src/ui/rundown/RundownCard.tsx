/**
 * Tonight's bedtime rundown as a timeline (engine/rundown.ts): the evening steps, wind-down, phone
 * down, the screen-free steps and lights-out — time, what it is, one line about it; tap a step for
 * what to do and why. The step happening now is marked.
 *
 * `compact` (Plan → Tonight) is a panel: tonight at a glance, the next few steps, "Start my rundown"
 * and the way to the full list. The full list (the wind-down screen) is a captioned group straight
 * on the page; the screen puts `RundownStartButtons` under its hero.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { isOpen } from '@/engine/inBed';
import { canPickUp, playerPosition, Rundown, rundownGlance, rundownNow, RundownStep } from '@/engine/rundown';
import { formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import { sessionFor } from '@/state/inBed';
import { startRundown, useRundown } from '@/state/rundown';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Link, Note, Row, Section, Timeline, TimelineItem } from '@/ui/components';
import { font, space } from '@/ui/theme';

const until = (ms: number) => formatDuration(Math.max(1, Math.round(ms / MINUTE)));
const openSettings = () => router.push({ pathname: '/settings/[section]', params: { section: 'winddown' } });

/** "by 8:15 PM", "10:40 PM · 30 min", "10:30 PM". */
export function stepTime(s: RundownStep): string {
  if (s.kind === 'by') return `by ${formatTime(s.at)}`;
  if (s.kind === 'moment' || s.min === 0) return formatTime(s.at);
  return `${formatTime(s.at)} · ${s.min} min`;
}

/** Behind you: marked in the player, or over by the clock. */
const isPast = (s: RundownStep, now: number) => s.status !== undefined || (s.kind === 'by' ? s.at <= now : s.end <= now && s.at < now);

/** One step as a timeline row. `open` adds what to do and why under it. */
function stepItem(s: RundownStep, o: { now: number; current?: RundownStep; next?: RundownStep; open: boolean; onPress: () => void }): TimelineItem {
  const isNow = s === o.current;
  const length = s.kind === 'do' && s.min > 0 ? `${s.min} min${s.shortened ? ` tonight (set: ${s.setMin})` : ''}` : '';
  const left = isNow && s.kind === 'do' && s.end > o.now ? `${until(s.end - o.now)} left` : '';
  const line = [left || length, s.status === 'skipped' ? 'skipped' : '', s.summary].filter(Boolean).join(' · ');
  return {
    key: s.id,
    time: formatTime(s.at),
    title: s.title,
    sub: o.open ? `${line}\n${s.detail}` : line,
    state: isNow ? 'now' : isPast(s, o.now) ? 'done' : s === o.next ? 'next' : 'later',
    onPress: o.onPress,
  };
}

/**
 * "Start my rundown" / "Resume · step 3 of 9", and "Pick up from now" once the evening is under way.
 * `main`: the screen's one big action; `quiet`: an ordinary button; `compact`: small, inside a panel.
 */
export function RundownStartButtons({ a, r, now, look = 'main' }: { a: Analysis; r: Rundown; now: number; look?: 'main' | 'quiet' | 'compact' }) {
  const pos = playerPosition(r);
  const open = () => router.push('/rundown');
  const props = { big: look === 'main', small: look === 'compact', kind: look === 'main' ? ('primary' as const) : ('secondary' as const), icon: 'play-circle-outline' };
  if (r.playing) return <Button {...props} label={`Resume · step ${Math.min(pos.index + 1, pos.total)} of ${pos.total}`} onPress={open} />;
  return (
    <>
      <Button
        {...props}
        label="Start my rundown"
        onPress={() => {
          startRundown(a, Date.now());
          open();
        }}
      />
      {canPickUp(r, now) ? (
        <Button
          small
          kind="ghost"
          label="Pick up from now"
          onPress={() => {
            startRundown(a, Date.now(), true);
            open();
          }}
        />
      ) : null}
    </>
  );
}

export function RundownCard({ a, compact }: { a: Analysis; compact?: boolean }) {
  const now = useNow(30_000);
  const r = useRundown(a, now);
  const inBed = useStore((s) => isOpen(sessionFor(s.settings.session, a)));
  const [expanded, setExpanded] = useState<string>();
  const [earlier, setEarlier] = useState(false);
  if (!r) return null;
  const { current, next } = rundownNow(r, now);
  const item = (s: RundownStep) => stepItem(s, { now, current, next, open: expanded === s.id, onPress: () => setExpanded((e) => (e === s.id ? undefined : s.id)) });
  const note = r.note ? (
    <View style={{ marginTop: space.sm }}>
      <Note tone="warn" icon="timer-sand">
        {r.note}
      </Note>
    </View>
  ) : null;

  if (compact) {
    const evening = now >= r.windDownStart - 2 * HOUR && now < r.lightsOut;
    const showStart = !inBed && (r.playing || evening);
    const upcoming = r.steps.filter((s) => s === current || (s.at > now && !s.status)).slice(0, 4);
    return (
      <Card>
        <CardTitle icon="format-list-checks" title="Tonight's rundown" sub={next ? `Next: ${next.title} ${next.at > now ? `in ${until(next.at - now)}` : 'now'}` : undefined} />
        <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{rundownGlance(r)}</Text>
        {note}
        <View style={{ marginTop: space.md }}>
          <Timeline items={upcoming.map(item)} />
        </View>
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          {showStart ? <RundownStartButtons a={a} r={r} now={now} look="compact" /> : null}
          <Button small kind="ghost" icon="timeline-clock-outline" label="Full rundown" onPress={() => router.push('/winddown')} />
        </Row>
      </Card>
    );
  }

  // The full list opens at what is happening now; what is behind you folds away.
  const past = r.steps.filter((s) => s !== current && isPast(s, now));
  const shown = earlier ? r.steps : r.steps.filter((s) => !past.includes(s));
  return (
    <Section title="Your bedtime rundown" action={<Link label="Change" onPress={openSettings} />}>
      <Text style={[font.small, { fontVariant: ['tabular-nums'], paddingHorizontal: space.xs }]}>{rundownGlance(r)}</Text>
      {note}
      {past.length ? (
        <View style={{ alignItems: 'flex-start', marginTop: space.xs }}>
          <Button small kind="ghost" icon={earlier ? 'chevron-up' : 'chevron-down'} label={earlier ? 'Hide earlier steps' : `${past.length} earlier step${past.length > 1 ? 's' : ''}`} onPress={() => setEarlier(!earlier)} />
        </View>
      ) : null}
      <View style={{ marginTop: space.md }}>
        <Timeline items={shown.map(item)} />
      </View>
      <Text style={[font.tiny, { paddingHorizontal: space.xs }]}>Tap a step for what to do and why.</Text>
    </Section>
  );
}
