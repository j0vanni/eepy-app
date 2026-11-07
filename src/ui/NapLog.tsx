/**
 * "Took a nap? Log it" — a nap you took without eepy's nap timer (state/napLog.ts): when you lay
 * down and for how long, today's naps listed with Remove, and Undo right after logging. On the Nap
 * tab and the check-in sheet ("+").
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import { dateKey, formatDuration, formatTime, MINUTE } from '@/engine/time';
import { clampNapStart, logNap, NAP_LOG, napsOn, removeNap } from '@/state/napLog';
import { useStore } from '@/state/store';
import { Button, Card, CardTitle, Chip, Icon, Row, Stepper } from '@/ui/components';
import { confirmHaptic, selectionTick } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

const LENGTHS = [10, 20, 30, 45, 60, 90];
const STEP = 5 * MINUTE;

/** `bare`: no card frame (inside another section). */
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

  const body = (
    <>
      {naps.length ? (
        <View style={{ gap: 6, marginBottom: space.sm }}>
          {naps.map((n) => (
            <Row key={n.id} gap={space.sm}>
              <Icon name="sleep" size={16} color={colors.accent} />
              <Text style={[font.small, { flex: 1, color: colors.text }]}>
                {formatTime(n.start)}–{formatTime(n.end)} · {formatDuration(n.minutes)}
                {n.manual ? '' : ' · from your watch'}
              </Text>
              {n.manual ? <Button small kind="ghost" label={n.id === justLogged ? 'Undo' : 'Remove'} onPress={() => removeNap(n.id)} /> : null}
            </Row>
          ))}
        </View>
      ) : null}
      {open ? (
        <View>
          <Stepper
            label="Lay down at"
            sub="5-minute steps"
            value={formatTime(at)}
            onDec={() => {
              selectionTick();
              setStart(at - STEP);
            }}
            onInc={() => {
              selectionTick();
              setStart(at + STEP);
            }}
          />
          <Text style={[font.small, { marginTop: space.xs, marginBottom: 6 }]}>For how long</Text>
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {LENGTHS.map((m) => (
              <Chip key={m} label={m < 60 ? `${m} min` : formatDuration(m)} selected={minutes === m} onPress={() => setLength(m)} />
            ))}
          </Row>
          <Stepper
            label="In bed"
            value={formatDuration(minutes)}
            onDec={() => setLength(Math.max(NAP_LOG.minMin, minutes - 5))}
            onInc={() => setLength(Math.min(NAP_LOG.maxMin, minutes + 5))}
          />
          <Text style={[font.tiny, { marginBottom: space.sm }]}>
            {formatTime(at)} → up {formatTime(at + minutes * MINUTE)}. It counts toward your sleep pressure and tonight's plan.
          </Text>
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            <Button small icon="check" label="Log nap" onPress={save} />
            <Button small kind="ghost" label="Cancel" onPress={() => setOpen(false)} />
          </Row>
        </View>
      ) : (
        <View style={{ alignItems: 'flex-start' }}>
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
      <CardTitle icon="sleep" title="Took a nap? Log it" sub="Naps without the nap timer — the watch may miss short ones" />
      {body}
    </Card>
  );
}
