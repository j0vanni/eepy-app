/**
 * "Took a nap?" — a nap you took without eepy's nap timer (state/napLog.ts): when you lay down and
 * for how long, today's naps listed with Remove, and Undo right after logging. On the Nap screen
 * (a panel) and the check-in sheet (`bare`, inside that screen's own panel).
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import { dateKey, formatDuration, formatTime, MINUTE } from '@/engine/time';
import { clampNapStart, logNap, NAP_LOG, napsOn, removeNap } from '@/state/napLog';
import { useStore } from '@/state/store';
import { Button, Card, CardTitle, Chip, Row, Stepper } from '@/ui/components';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { font, space } from '@/ui/theme';

const LENGTHS = [10, 20, 30, 45, 60, 90];
const STEP = 5 * MINUTE;

/** `bare`: no panel and no heading (inside another section). */
export function NapLogCard({ bare }: { bare?: boolean }) {
  const sessions = useStore((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(20);
  const [start, setStart] = useState(() => clampNapStart(Date.now() - 45 * MINUTE, 20, Date.now()));
  const [justLogged, setJustLogged] = useState<string>();
  const now = Date.now();
  const naps = napsOn(sessions, dateKey(now));
  const at = clampNapStart(start, minutes, now);

  const save = () => {
    confirmHaptic();
    setJustLogged(logNap(at, minutes, Date.now()));
    setOpen(false);
  };
  const setLength = (m: number) => {
    selectionTick();
    setMinutes(m);
  };
  const moveStart = (t: number) => {
    selectionTick();
    setStart(t);
  };

  const body = (
    <>
      {naps.map((n) => (
        <Row key={n.id} gap={space.sm} style={{ minHeight: 40 }}>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontVariant: ['tabular-nums'] }]}>
              {formatTime(n.start)} – {formatTime(n.end)}
            </Text>
            <Text style={font.small}>
              {formatDuration(n.minutes)}
              {n.manual ? '' : ' · from your watch'}
            </Text>
          </View>
          {n.manual ? <Button small kind="ghost" label={n.id === justLogged ? 'Undo' : 'Remove'} onPress={() => removeNap(n.id)} /> : null}
        </Row>
      ))}
      {open ? (
        <View style={naps.length ? { marginTop: space.sm } : null}>
          <Stepper label="Lay down at" sub="5-minute steps" value={formatTime(at)} onDec={() => moveStart(at - STEP)} onInc={() => moveStart(at + STEP)} />
          <Stepper
            label="For how long"
            sub={`Up at ${formatTime(at + minutes * MINUTE)}`}
            value={formatDuration(minutes)}
            onDec={() => setLength(Math.max(NAP_LOG.minMin, minutes - 5))}
            onInc={() => setLength(Math.min(NAP_LOG.maxMin, minutes + 5))}
          />
          <Row gap={space.sm} style={{ flexWrap: 'wrap', marginTop: space.xs }}>
            {LENGTHS.map((m) => (
              <Chip key={m} label={m < 60 ? `${m} min` : formatDuration(m)} selected={minutes === m} onPress={() => setLength(m)} />
            ))}
          </Row>
          <Text style={[font.tiny, { marginTop: space.md }]}>It counts toward your sleep pressure and tonight's plan.</Text>
          <Row gap={space.sm} style={{ flexWrap: 'wrap', marginTop: space.md }}>
            <Button small icon="check" label="Log nap" onPress={save} />
            <Button small kind="ghost" label="Cancel" onPress={() => setOpen(false)} />
          </Row>
        </View>
      ) : (
        <View style={[{ alignItems: 'flex-start' }, naps.length ? { marginTop: space.sm } : null]}>
          <Button
            small
            kind="secondary"
            icon="plus"
            label={naps.length ? 'Log another nap' : 'Log a nap'}
            onPress={() => {
              setStart(clampNapStart(Date.now() - (minutes + 25) * MINUTE, minutes, Date.now()));
              setOpen(true);
            }}
          />
        </View>
      )}
    </>
  );
  if (bare) return body;
  return (
    <Card>
      <CardTitle title="Took a nap?" sub="Log one you took without the nap timer. The watch can miss short ones." />
      {body}
    </Card>
  );
}
