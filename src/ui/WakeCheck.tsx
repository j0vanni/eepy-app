/**
 * The accurate wake-up in the UI (engine/wakeDetect.ts): the question in Today's morning panel, the
 * night's times in order on the night screen, and the corrections you can make (fell asleep / woke
 * up / got up). Corrections are stored per night in the wake log and always win.
 */
import { ReactNode, useState } from 'react';
import { Text, View } from 'react-native';

import type { SessionMetrics } from '@/engine/sessions';
import { clockDiff, formatClock, formatDuration, formatTime, MINUTE, minutesOfDay } from '@/engine/time';
import type { NightFix, SleepSession } from '@/engine/types';
import { Boundary, BoundarySource, NightTimeline, withFix } from '@/engine/wakeDetect';
import { originLabel } from '@/integrations/healthConnectMapper';
import { useStore } from '@/state/store';
import { Button, Card, Divider, KeyValue, Row, Stepper, Timeline, TimelineItem } from '@/ui/components';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { font, space } from '@/ui/theme';

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
  // Two-step morning without the second stretch: the routine was the real wake-up.
  if (t.routine?.stayedUp) {
    return { text: `No sleep after your morning routine — so ${formatTime(t.woke.time)} was your real wake-up.`, yes: 'Looks right' };
  }
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
  up: 'your tap',
  inbed: 'your tap',
};

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
    // The short editor (eepy's question on Today) only shows the wake-up; when you got up then follows the evidence.
    if (full && up !== t.outOfBed.time) fix.up = up;
    if (fix.asleep === undefined && fix.wake === undefined && fix.up === undefined) fix.ok = true;
    confirmHaptic();
    update((log) => withFix(log, t.id, fix));
    onDone();
  };
  return (
    <View>
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
 * Looks right / Change. When eepy has nothing to ask, Today shows when you slept as a row that opens
 * the editor; the night screen (`full`) offers Change and, once you've answered, Undo.
 *
 * It has no panel of its own: on Today it is the first block of the morning panel (and closes with
 * a hairline), on the night screen the last block of the Times panel.
 */
export function WakeCheck({ m, t, full }: { m: SessionMetrics; t: NightTimeline; full?: boolean }) {
  const update = useStore((s) => s.updateWakeLog);
  const [editing, setEditing] = useState<false | 'wake' | 'all'>(false);
  const q = wakeQuestion(m, t);
  let body: ReactNode;
  if (editing) {
    // "Change" on eepy's question edits the wake-up; everywhere else all three times.
    body = <FixEditor t={t} full={full || editing === 'all'} onDone={() => setEditing(false)} />;
  } else if (q) {
    body = (
      <>
        <Text style={font.body}>{q.text}</Text>
        <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
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
          <Button small kind="ghost" icon="pencil-outline" label="Change" onPress={() => setEditing(full ? 'all' : 'wake')} />
        </Row>
      </>
    );
  } else if (!full) {
    // Today: always a way to set when you fell asleep and woke up, not only when eepy asks.
    body = (
      <KeyValue
        label="Asleep"
        sub={t.fixed ? 'Your times' : 'Tap to change'}
        value={`${formatTime(t.asleep.time)} – ${formatTime(t.woke.time)}`}
        onPress={() => setEditing('all')}
      />
    );
  } else if (t.fixed || t.confirmed) {
    body = (
      <Row gap={space.xs} style={{ flexWrap: 'wrap' }}>
        <Text style={[font.small, { flex: 1, minWidth: 140 }]}>{t.fixed ? 'Using the times you set.' : 'You confirmed these times.'}</Text>
        <Button small kind="ghost" label="Change" onPress={() => setEditing('all')} />
        <Button small kind="ghost" label="Undo" onPress={() => update((log) => withFix(log, t.id, undefined))} />
      </Row>
    );
  } else {
    body = (
      <View style={{ alignItems: 'flex-start' }}>
        <Button small kind="ghost" icon="pencil-outline" label="Times look off? Change" onPress={() => setEditing('all')} />
      </View>
    );
  }
  if (full) return <View>{body}</View>;
  return (
    <View>
      {body}
      <Divider spacing={space.md} />
    </View>
  );
}

/** What a time is based on, under its detail: "watch · medium confidence". */
const basis = (b: Boundary) => `${SOURCE_LABEL[b.source]} · ${b.confidence} confidence`;
const lines = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('\n') || undefined;

const MAX_EPISODES = 6;

/**
 * Night screen → Times: in bed → asleep → wake-ups → woke up → out of bed, each with what it is
 * based on, and under them the ways to correct them.
 */
export function NightTimelineCard({ m, t }: { m: SessionMetrics; t?: NightTimeline }) {
  if (!t) return null;
  const who = trackerLabel(m.session).toLowerCase().replace('your ', 'the ');
  const rec = t.recorded;
  const asleepBits = [
    m.latencyMin >= 1 ? `${formatDuration(m.latencyMin)} to fall asleep` : undefined,
    t.lastUseBeforeSleep !== undefined ? `last used eepy ${formatTime(t.lastUseBeforeSleep)}` : undefined,
    t.onsetShiftMin >= 10 ? `${who} said ${formatTime(rec.onset)}` : undefined,
    ...t.onsetEvidence.filter((e) => t.onsetShiftMin < 10 || e !== t.onsetEvidence[0]),
  ].filter(Boolean);
  const late = t.askLate && t.usualWakeMin !== undefined ? clockDiff(t.usualWakeMin, minutesOfDay(t.woke.time)) : 0;
  // "I'm in bed" (engine/wakeDetect.ts rule 14): your tap, and where the recording began if elsewhere.
  const inBedBits = t.inBed.source === 'inbed' ? ['you tapped In bed', Math.abs(t.inBed.time - rec.start) >= MINUTE ? `${who} started at ${formatTime(rec.start)}` : undefined].filter(Boolean) : [];
  const tail = (t.outOfBed.time - t.woke.time) / MINUTE;
  const outBits = [
    t.upEvidence.join(', '),
    tail >= 1 ? `${formatDuration(tail)} awake in bed first` : undefined,
    t.trimmedMin >= 1 ? `recording ran on to ${formatTime(rec.end)}` : undefined,
    t.outOfBed.time - rec.end >= MINUTE ? `recording ended ${formatTime(rec.end)}` : undefined,
  ].filter(Boolean);
  const shown = t.episodes.slice(0, MAX_EPISODES);
  const routine = t.routine;

  // The four times that bound the night stand out; what happened in between is quieter.
  const items: TimelineItem[] = [
    { key: 'in-bed', time: formatTime(t.inBed.time), title: 'In bed', sub: lines(inBedBits.join(' · '), basis(t.inBed)), state: 'next' },
    { key: 'asleep', time: formatTime(t.asleep.time), title: 'Fell asleep', sub: lines(asleepBits.join(' · '), basis(t.asleep)), state: 'next' },
    ...shown.map((e): TimelineItem =>
      e.routine
        ? {
            // Two-step morning: planned time up, not a wake-up in the night (engine/wakeDetect.ts rule 12).
            key: `e${e.start}`,
            time: formatTime(e.start),
            title: 'Morning routine',
            sub: [
              `until ${formatTime(e.end)} · ${formatDuration(e.minutes)}`,
              routine?.backAsleep !== undefined ? `back asleep ${formatTime(routine.backAsleep)}` : undefined,
              routine?.evidence.length ? routine.evidence.join(', ') : undefined,
              routine && routine.minutes > routine.plannedMin ? `${formatDuration(routine.minutes - routine.plannedMin)} longer than planned counts as awake` : 'planned — not counted as waking',
            ]
              .filter(Boolean)
              .join(' · '),
          }
        : {
            key: `e${e.start}`,
            time: formatTime(e.start),
            title: 'Awake',
            sub: [`until ${formatTime(e.end)} · ${formatDuration(e.minutes)}`, e.steps >= 20 ? `got up (${e.steps} steps)` : e.usedEepy ? 'used eepy' : 'in bed'].join(' · '),
          },
    ),
    ...(t.episodes.length > shown.length ? [{ key: 'more', time: '', title: `+${t.episodes.length - shown.length} more wake-ups` }] : []),
    {
      key: 'woke',
      time: formatTime(t.woke.time),
      title: 'Woke up',
      sub: lines(
        routine?.stayedUp
          ? `no sleep after your morning routine (${formatTime(routine.start)}), so this was your real wake-up`
          : late > 0
            ? `${formatDuration(late)} later than your usual ${formatClock(t.usualWakeMin!)}`
            : undefined,
        basis(t.woke),
      ),
      state: 'next',
    },
    { key: 'up', time: formatTime(t.outOfBed.time), title: 'Out of bed', sub: lines(outBits.join(' · '), basis(t.outOfBed)), state: 'next' },
  ];
  // What was left out of the night's totals.
  const left = [
    m.routine ? `${formatDuration(m.routine.minutes)} up for your routine not counted as in bed` : undefined,
    t.trimmedMin >= 1 ? `${formatDuration(t.trimmedMin)} after you got up left out` : undefined,
  ].filter(Boolean);
  return (
    <Card>
      <Timeline items={items} />
      {left.length ? <Text style={font.small}>{`${left.join(' · ')}.`}</Text> : null}
      <Divider spacing={space.md} />
      <WakeCheck m={m} t={t} full />
    </Card>
  );
}
