/**
 * Tonight's bedtime rundown as a timeline (engine/rundown.ts): the evening steps, wind-down, phone
 * down, the screen-free steps and lights-out, with times, lengths and what to do and why (tap a step).
 * The step happening now is highlighted with a countdown to the next. `compact` (Today in the
 * evening, Planner → Tonight) shows tonight at a glance and the next few steps, with "Start my
 * rundown"; the full card is on the wind-down screen.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { isOpen } from '@/engine/inBed';
import { canPickUp, playerPosition, Rundown, rundownGlance, rundownNow, RundownStep } from '@/engine/rundown';
import { formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import { sessionFor } from '@/state/inBed';
import { startRundown, useRundown } from '@/state/rundown';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Icon, Note, Row } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

const until = (ms: number) => formatDuration(Math.max(1, Math.round(ms / MINUTE)));

/** "by 8:15 PM", "10:40 PM · 30 min", "10:30 PM". */
export function stepTime(s: RundownStep): string {
  if (s.kind === 'by') return `by ${formatTime(s.at)}`;
  if (s.kind === 'moment' || s.min === 0) return formatTime(s.at);
  return `${formatTime(s.at)} · ${s.min} min`;
}

const tintOf = (s: RundownStep) => (s.phase === 'phone-down' ? colors.warn : s.phase === 'lights-out' ? colors.accent : s.phase === 'evening' ? colors.energy : colors.light);

function StepRow({ s, now, current, expanded, onPress, compact }: { s: RundownStep; now: number; current: boolean; expanded: boolean; onPress: () => void; compact?: boolean }) {
  const past = !current && (s.status !== undefined || (s.kind === 'by' ? s.at <= now : s.end <= now && s.at < now));
  const tint = tintOf(s);
  const icon = s.status === 'done' ? 'check-circle' : s.status === 'skipped' ? 'minus-circle-outline' : s.icon;
  const left = current && s.kind === 'do' && s.end > now ? ` · ${until(s.end - now)} left` : '';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${s.title}, ${stepTime(s)}`}
      style={({ pressed }) => [
        { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: 6, paddingHorizontal: current ? space.sm : 0, borderRadius: radius.md, opacity: past ? 0.5 : 1 },
        current ? { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: tint } : null,
        pressed ? { opacity: 0.75 } : null,
      ]}
    >
      <View style={{ width: 26, alignItems: 'center', paddingTop: 2 }}>
        <Icon name={icon} size={20} color={current ? tint : s.status === 'done' ? colors.good : colors.textDim} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Text style={[font.body, { flex: 1, fontWeight: current ? '700' : '600', color: current ? tint : colors.text }]}>{s.title}</Text>
          <Text style={[font.small, { fontVariant: ['tabular-nums'], textAlign: 'right' }]}>{current ? `now${left}` : stepTime(s)}</Text>
        </Row>
        {!compact || current ? (
          <Text style={font.small}>
            {s.summary}
            {s.shortened ? ` · ${s.min} min tonight (set: ${s.setMin})` : ''}
          </Text>
        ) : null}
        {expanded ? <Text style={[font.small, { color: colors.text, marginTop: 4 }]}>{s.detail}</Text> : null}
      </View>
      <View style={{ paddingTop: 2 }}>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
      </View>
    </Pressable>
  );
}

/** A small uppercase heading between the timeline's parts. */
function PartLabel({ text, color = colors.textFaint }: { text: string; color?: string }) {
  return <Text style={[font.label, { marginTop: space.md, marginBottom: 2, color }]}>{text}</Text>;
}

/** "Start my rundown" / "Resume · step 3 of 9" — and "Pick up from now" once the evening is under way. */
export function RundownStartButtons({ a, r, now, secondary }: { a: Analysis; r: Rundown; now: number; secondary?: boolean }) {
  const pos = playerPosition(r);
  const open = () => router.push('/rundown');
  if (r.playing) {
    return <Button small={secondary} kind={secondary ? 'secondary' : 'primary'} icon="play-circle-outline" label={`Resume · step ${Math.min(pos.index + 1, pos.total)} of ${pos.total}`} onPress={open} />;
  }
  return (
    <>
      <Button
        small={secondary}
        kind={secondary ? 'secondary' : 'primary'}
        icon="play-circle-outline"
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
  if (!r) return null;
  const { current, next } = rundownNow(r, now);
  const toggle = (id: string) => setExpanded((e) => (e === id ? undefined : id));
  const evening = now >= r.windDownStart - 2 * HOUR && now < r.lightsOut;
  const showStart = !inBed && (r.playing || evening || !compact);
  const sub = next ? `Next: ${next.title} ${next.at > now ? `in ${until(next.at - now)}` : 'now'}` : undefined;

  const row = (s: RundownStep) => (
    <StepRow key={s.id} s={s} now={now} current={s === current} expanded={expanded === s.id} onPress={() => toggle(s.id)} compact={compact} />
  );

  return (
    <Card>
      <CardTitle icon="format-list-checks" title={compact ? "Tonight's rundown" : 'Your bedtime rundown'} color={colors.light} sub={sub} />
      <Row gap={space.sm} style={{ marginBottom: space.sm }}>
        <Icon name="cellphone-off" size={16} color={colors.warn} />
        <Text style={[font.small, { flex: 1, color: colors.text, fontVariant: ['tabular-nums'] }]}>{rundownGlance(r)}</Text>
      </Row>
      {r.note ? (
        <View style={{ marginBottom: space.sm }}>
          <Note tone="warn" icon="timer-sand">
            {r.note}
          </Note>
        </View>
      ) : null}
      {compact ? (
        <View style={{ gap: 2 }}>{r.steps.filter((s) => s === current || (s.at > now && !s.status)).slice(0, 4).map(row)}</View>
      ) : (
        <View>
          {r.evening.length ? <PartLabel text="EVENING" color={colors.energy} /> : null}
          {r.evening.map(row)}
          {r.routine.some((s) => s.phase === 'winddown') ? <PartLabel text={`WIND-DOWN · FROM ${formatTime(r.windDownStart)}`} color={colors.light} /> : null}
          {r.routine.filter((s) => s.phase === 'winddown').map(row)}
          <PartLabel text={`PHONE DOWN · ${formatTime(r.phoneDown)}`} color={colors.warn} />
          {r.routine.filter((s) => s.phase === 'phone-down' || s.phase === 'screen-free').map(row)}
          <PartLabel text={`LIGHTS OUT · ${formatTime(r.lightsOut)}`} color={colors.accent} />
          {r.routine.filter((s) => s.phase === 'lights-out').map(row)}
        </View>
      )}
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        {showStart ? <RundownStartButtons a={a} r={r} now={now} secondary={compact} /> : null}
        {compact ? (
          <Button small kind="ghost" icon="timeline-clock-outline" label="Full rundown" onPress={() => router.push('/winddown')} />
        ) : (
          <Button small kind="ghost" icon="tune-variant" label="Customize" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'winddown' } })} />
        )}
      </Row>
      {!compact ? (
        <Text style={[font.tiny, { marginTop: space.sm }]}>
          Built backwards from lights-out: phone down when the screen-free steps start ({formatDuration((r.lightsOut - r.phoneDown) / MINUTE)} before). Tap a step for what to do and why.
        </Text>
      ) : null}
    </Card>
  );
}
