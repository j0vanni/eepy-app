/**
 * The accurate wake-up in the UI (engine/wakeDetect.ts): the one-line question on Today's morning card,
 * the step-by-step night on the night screen, and the corrections you can make (fell asleep / woke up /
 * got up). Corrections are stored per night in the wake log and always win.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { SessionMetrics } from '@/engine/sessions';
import { clockDiff, formatClock, formatDuration, formatTime, MINUTE, minutesOfDay } from '@/engine/time';
import type { NightFix, SleepSession } from '@/engine/types';
import { Boundary, BoundarySource, Confidence, NightTimeline, withFix } from '@/engine/wakeDetect';
import { originLabel } from '@/integrations/healthConnectMapper';
import { useStore } from '@/state/store';
import { Button, Card, CardTitle, Row, Stepper } from '@/ui/components';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

/** "Your watch" / "Your phone" / "Your tracker", for "Your watch recorded sleep until …". */
export function trackerLabel(s: SleepSession): string {
  if (/watch|band|ring/i.test(s.device ?? '') || (s.origin && originLabel(s.origin).likelyWatch)) return 'Your watch';
  if (s.origin) return 'Your phone';
  return 'Your tracker';
}

/** What eepy wants you to check about a night, if anything. */
export function wakeQuestion(m: SessionMetrics, t: NightTimeline): { text: string; yes: string } | undefined {
  if (t.fixed || t.confirmed) return undefined;
  const who = trackerLabel(m.session);
  if (t.trimmedMin >= 10) {
    const why = t.upEvidence.length ? ` (${t.upEvidence.join(', ')})` : '';
    return { text: `${who} recorded sleep until ${formatTime(t.recorded.end)} — you were up at ${formatTime(t.outOfBed.time)}${why}.`, yes: 'Looks right' };
  }
  if (t.askLate) {
    const late = t.usualWakeMin !== undefined ? clockDiff(t.usualWakeMin, minutesOfDay(t.woke.time)) : 0;
    return {
      text: `Were you really asleep until ${formatTime(t.woke.time)}?${late > 0 ? ` That's ${formatDuration(late)} later than usual.` : ''}`,
      yes: 'Yes, I was',
    };
  }
  if (t.onsetShiftMin >= 10) {
    const why = t.onsetEvidence.length ? ` (${t.onsetEvidence[0]})` : '';
    return { text: `${who} recorded sleep from ${formatTime(t.recorded.onset)} — you were still up until ${formatTime(t.asleep.time)}${why}.`, yes: 'Looks right' };
  }
  return undefined;
}

const SOURCE_LABEL: Record<BoundarySource, string> = {
  recorded: 'as recorded',
  watch: 'watch',
  you: 'your time',
  app: 'eepy',
  alarm: 'alarm',
  checkin: 'check-in',
  journal: 'journal',
  caffeine: 'drink log',
  steps: 'steps',
};

const CONFIDENCE_COLOR: Record<Confidence, string> = { high: colors.good, medium: colors.textDim, low: colors.warn };

const STEP = 5 * MINUTE;
const clamp = (t: number, a: number, b: number) => Math.min(b, Math.max(a, t));

/** Steppers for your own times; only what you change is saved (nothing changed = "Looks right"). */
function FixEditor({ t, full, onDone }: { t: NightTimeline; full?: boolean; onDone: () => void }) {
  const prev = useStore((s) => s.wakeLog.fixes[t.id]);
  const update = useStore((s) => s.updateWakeLog);
  const rec = t.recorded;
  const [asleep, setAsleep] = useState(t.asleep.time);
  const [wake, setWake] = useState(t.woke.time);
  const [up, setUp] = useState(t.outOfBed.time);
  const move = (set: (v: number) => void, v: number) => {
    selectionTick();
    set(v);
  };
  const save = () => {
    const fix: NightFix = { asleep: prev?.asleep, wake: prev?.wake, up: prev?.up, at: Date.now() };
    if (asleep !== t.asleep.time) fix.asleep = asleep;
    if (wake !== t.woke.time) fix.wake = wake;
    // Today's short editor only shows the wake-up; when you got up then follows the evidence.
    if (full && up !== t.outOfBed.time) fix.up = up;
    if (fix.asleep === undefined && fix.wake === undefined && fix.up === undefined) fix.ok = true;
    confirmHaptic();
    update((log) => withFix(log, t.id, fix));
    onDone();
  };
  return (
    <View style={{ marginTop: space.sm, marginBottom: full ? 0 : space.md }}>
      {full ? (
        <Stepper
          label="Fell asleep"
          sub={`recorded ${formatTime(rec.onset)}`}
          value={formatTime(asleep)}
          onDec={() => move(setAsleep, clamp(asleep - STEP, rec.start, wake - 60 * MINUTE))}
          onInc={() => move(setAsleep, clamp(asleep + STEP, rec.start, wake - 60 * MINUTE))}
        />
      ) : null}
      <Stepper
        label="Woke up"
        sub={`recorded ${formatTime(rec.finalWake)}`}
        value={formatTime(wake)}
        onDec={() => move(setWake, clamp(wake - STEP, asleep + 60 * MINUTE, rec.end))}
        onInc={() => {
          const w = clamp(wake + STEP, asleep + 60 * MINUTE, rec.end);
          move(setWake, w);
          if (up < w) setUp(w);
        }}
      />
      {full ? (
        <Stepper
          label="Got up"
          sub={`recording ended ${formatTime(rec.end)}`}
          value={formatTime(up)}
          onDec={() => move(setUp, clamp(up - STEP, wake, rec.end))}
          onInc={() => move(setUp, clamp(up + STEP, wake, rec.end))}
        />
      ) : null}
      <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
        <Button small icon="check" label="Save" onPress={save} />
        <Button small kind="ghost" label="Cancel" onPress={onDone} />
      </Row>
    </View>
  );
}

/**
 * "Your watch recorded sleep until 9:12 AM — you were up at 7:40 AM (opened eepy, 230 steps)" with
 * Looks right / Change. `full` (night screen) also offers fell-asleep / got-up times and undo.
 */
export function WakeCheck({ m, t, full }: { m: SessionMetrics; t: NightTimeline; full?: boolean }) {
  const update = useStore((s) => s.updateWakeLog);
  const [editing, setEditing] = useState(false);
  const q = wakeQuestion(m, t);
  if (editing) return <FixEditor t={t} full={full} onDone={() => setEditing(false)} />;
  if (t.fixed || t.confirmed) {
    if (!full) return null;
    return (
      <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
        <Text style={[font.small, { flex: 1, minWidth: 160 }]}>{t.fixed ? 'Using the times you set.' : 'You confirmed these times.'}</Text>
        <Button small kind="ghost" label="Change" onPress={() => setEditing(true)} />
        <Button small kind="ghost" label="Undo" onPress={() => update((log) => withFix(log, t.id, undefined))} />
      </Row>
    );
  }
  if (!q) {
    if (!full) return null;
    return (
      <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
        <Button small kind="ghost" icon="pencil-outline" label="Times look off? Change" onPress={() => setEditing(true)} />
      </View>
    );
  }
  return (
    <View style={{ marginTop: full ? space.sm : 0, marginBottom: full ? 0 : space.md }}>
      <Text style={[font.small, { color: colors.text }]}>{q.text}</Text>
      <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
        <Button
          small
          kind="secondary"
          icon="check"
          label={q.yes}
          onPress={() => {
            confirmHaptic();
            update((log) => withFix(log, t.id, { ok: true, at: Date.now() }));
          }}
        />
        <Button small kind="ghost" icon="pencil-outline" label="Change" onPress={() => setEditing(true)} />
      </Row>
    </View>
  );
}

function Step({ color, label, time, detail, b }: { color: string; label: string; time: string; detail?: string; b?: Boundary }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, paddingVertical: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: 7 }} />
      <View style={{ flex: 1 }}>
        <Row gap={space.sm}>
          <Text style={[font.body, { flex: 1 }]}>{label}</Text>
          <Text style={[font.h3, { fontVariant: ['tabular-nums'] }]}>{time}</Text>
        </Row>
        {detail ? <Text style={font.small}>{detail}</Text> : null}
        {b ? (
          <Text style={[font.tiny, { marginTop: 1 }]}>
            {SOURCE_LABEL[b.source]} · <Text style={{ color: CONFIDENCE_COLOR[b.confidence] }}>{b.confidence} confidence</Text>
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const MAX_EPISODES = 6;

/** Night screen: in bed → asleep → wake-ups → woke up → out of bed, each with its source and confidence. */
export function NightTimelineCard({ m, t }: { m: SessionMetrics; t?: NightTimeline }) {
  if (!t) return null;
  const who = trackerLabel(m.session);
  const rec = t.recorded;
  const asleepBits = [
    m.latencyMin >= 1 ? `${formatDuration(m.latencyMin)} to fall asleep` : undefined,
    t.lastUseBeforeSleep !== undefined ? `last used eepy ${formatTime(t.lastUseBeforeSleep)}` : undefined,
    t.onsetShiftMin >= 10 ? `${who.toLowerCase().replace('your ', 'the ')} said ${formatTime(rec.onset)}` : undefined,
    ...t.onsetEvidence.filter((e) => t.onsetShiftMin < 10 || e !== t.onsetEvidence[0]),
  ].filter(Boolean);
  const late = t.askLate && t.usualWakeMin !== undefined ? clockDiff(t.usualWakeMin, minutesOfDay(t.woke.time)) : 0;
  const tail = (t.outOfBed.time - t.woke.time) / MINUTE;
  const outBits = [
    t.upEvidence.join(', '),
    tail >= 1 ? `${formatDuration(tail)} awake in bed first` : undefined,
    t.trimmedMin >= 1 ? `recording ran on to ${formatTime(rec.end)}` : undefined,
  ].filter(Boolean);
  const shown = t.episodes.slice(0, MAX_EPISODES);
  return (
    <Card>
      <CardTitle icon="timeline-clock-outline" title="Your night, step by step" />
      <Step color={colors.textFaint} label="In bed" time={formatTime(t.inBed.time)} b={t.inBed} />
      <Step color={colors.light} label="Fell asleep" time={formatTime(t.asleep.time)} detail={asleepBits.join(' · ') || undefined} b={t.asleep} />
      {shown.map((e) => (
        <Step
          key={e.start}
          color={colors.awake}
          label="Awake"
          time={formatTime(e.start)}
          detail={[
            `until ${formatTime(e.end)} · ${formatDuration(e.minutes)}`,
            e.steps >= 20 ? `got up (${e.steps} steps)` : e.usedEepy ? 'used eepy' : 'in bed',
          ].join(' · ')}
        />
      ))}
      {t.episodes.length > shown.length ? <Text style={[font.tiny, { marginLeft: 16 }]}>+{t.episodes.length - shown.length} more wake-ups</Text> : null}
      <Step
        color={colors.energy}
        label="Woke up"
        time={formatTime(t.woke.time)}
        detail={late > 0 ? `${formatDuration(late)} later than your usual ${formatClock(t.usualWakeMin!)}` : undefined}
        b={t.woke}
      />
      <Step color={colors.good} label="Out of bed" time={formatTime(t.outOfBed.time)} detail={outBits.join(' · ') || undefined} b={t.outOfBed} />
      <Text style={[font.small, { marginTop: space.sm }]}>
        In bed {formatDuration(m.timeInBedMin)} · asleep {formatDuration(m.totalSleepMin)} · {Math.round(m.efficiency * 100)}% efficiency
        {t.trimmedMin >= 1 ? ` · ${formatDuration(t.trimmedMin)} after you got up left out` : ''}
      </Text>
      <WakeCheck m={m} t={t} full />
    </Card>
  );
}
