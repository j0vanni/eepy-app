/**
 * Planner → Tonight → "Options for tonight": eepy's pick highlighted, every option with its times,
 * sleep, debt in a week and "Use this", details on tap, and — folded — how eepy decided.
 * Today's "Still up?" card (ui/today/StillUp.tsx) shares the pieces.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import type { PlanOption, PlanOptions } from '@/engine/planOptions';
import { formatDuration, formatTime } from '@/engine/time';
import { applyPlanOption, usePlanOptions } from '@/state/planOptions';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Icon, Note, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, radius, space } from '@/ui/theme';

/** A duration that never breaks across lines ("1h 22m"). */
const dur = (m: number) => formatDuration(m).replace(/ /g, '\u00A0');
const signed = (m: number) => `${m >= 0 ? '+' : '−'}${dur(Math.abs(m))}`;

/** "5h 24m sleep (+30m) · debt in a week 2h 52m" */
export function optionStats(o: PlanOption): string {
  const delta = !o.isDefault && Math.abs(o.deltaSleepMin) >= 5 ? ` (${signed(o.deltaSleepMin)})` : '';
  return `${dur(o.sleepMin)} sleep${delta} · debt in a week ${dur(o.debtWeekMin)}`;
}

/** Uses an option (the user's tap). */
export function takeOption(o: Pick<PlanOption, 'apply'>): void {
  confirmHaptic();
  applyPlanOption(o.apply);
}

/** Folded "How eepy decided": the ordered steps. */
export function HowEepyDecided({ steps, color = colors.accent, textColor }: { steps: string[]; color?: string; textColor?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ marginTop: space.sm, minHeight: 32, justifyContent: 'center' }}
        hitSlop={6}
      >
        <Row gap={4}>
          <Icon name="thought-bubble-outline" size={17} color={color} />
          <Text style={[font.small, { color, fontWeight: '600', flex: 1 }]}>How eepy decided</Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={color} />
        </Row>
      </Pressable>
      {open ? (
        <View style={{ marginTop: 4, gap: 6 }}>
          {steps.map((s, i) => (
            <Row key={s} gap={space.sm} style={{ alignItems: 'flex-start' }}>
              <Text style={[font.small, styles.stepNo, { color }]}>{i + 1}</Text>
              <Text style={[font.small, { flex: 1 }, textColor ? { color: textColor } : null, i === steps.length - 1 ? { color: textColor ?? colors.text, fontWeight: '600' } : null]}>{s}</Text>
            </Row>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function OptionDetails({ o, opts }: { o: PlanOption; opts: PlanOptions }) {
  const def = opts.defaultOption;
  const first = o.week[0];
  const last = o.week[o.week.length - 1];
  return (
    <View style={{ marginTop: space.sm, gap: 4 }}>
      <Text style={font.small}>
        {`Tomorrow: energy ${o.energy}${o === def ? '' : ` (plan ${def.energy})`} · ${o.focusHours.toFixed(1)} h of focus${o === def ? '' : ` (plan ${def.focusHours.toFixed(1)})`}`}
      </Text>
      <Text style={font.small}>{`Debt ${formatDuration(o.debtAfterMin)} after tonight, ${formatDuration(o.debtWeekMin)} in a week · ~${o.latencyMin} min to fall asleep`}</Text>
      {first && last && o.week.length > 1 ? (
        <Text style={font.small}>{`This week, then eepy's plan: lights out ${formatTime(first.bedtime)} tonight → ${formatTime(last.bedtime)} by the ${o.week.length}th night`}</Text>
      ) : null}
      {o.pros.map((p) => (
        <Row key={`+${p}`} gap={6} style={{ alignItems: 'flex-start' }}>
          <Icon name="plus-circle-outline" size={16} color={colors.good} />
          <Text style={[font.small, { flex: 1, color: colors.text }]}>{p}</Text>
        </Row>
      ))}
      {o.cons.map((c) => (
        <Row key={`-${c}`} gap={6} style={{ alignItems: 'flex-start' }}>
          <Icon name="minus-circle-outline" size={16} color={colors.warn} />
          <Text style={[font.small, { flex: 1, color: colors.text }]}>{c}</Text>
        </Row>
      ))}
      {o.kept ? <Text style={font.tiny}>{`Kept up every night (${o.kept.rule}): ${formatDuration(o.kept.debtWeekMin)} of debt in a week.`}</Text> : null}
    </View>
  );
}

function OptionRow({ o, opts, open, onToggle }: { o: PlanOption; opts: PlanOptions; open: boolean; onToggle: () => void }) {
  return (
    <View style={[styles.row, o.recommended ? styles.pick : null]} accessibilityLabel={`${o.title}${o.recommended ? ", eepy's pick" : ''}. ${o.times}. ${optionStats(o)}`}>
      {o.recommended ? <Text style={[font.label, { color: colors.accent, marginBottom: 2 }]}>EEPY'S PICK</Text> : null}
      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <Pressable onPress={onToggle} style={{ flex: 1, minWidth: 0 }} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={4}>
          <Text style={font.h3}>{o.title}</Text>
          <Text style={[font.small, { color: colors.text, fontVariant: ['tabular-nums'] }]}>{o.times}</Text>
          <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{optionStats(o)}</Text>
        </Pressable>
        {o.inUse ? (
          <View style={styles.inUse}>
            <Icon name="check" size={14} color={colors.good} />
            <Text style={[font.tiny, { color: colors.good, fontWeight: '700' }]}>IN USE</Text>
          </View>
        ) : (
          <Button small kind={o.recommended ? 'primary' : 'secondary'} label="Use this" onPress={() => takeOption(o)} />
        )}
      </Row>
      <Pressable onPress={onToggle} hitSlop={6} accessibilityRole="button" style={{ marginTop: 4, alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' }}>
        <Row gap={2}>
          <Text style={[font.tiny, { color: colors.accent, fontWeight: '600' }]}>{open ? 'Less' : 'Pros, cons and the week'}</Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
        </Row>
      </Pressable>
      {open ? <OptionDetails o={o} opts={opts} /> : null}
    </View>
  );
}

/** Bedtime keeps slipping: start wind-down earlier, and the screens-off reminder if it's off. */
export function SlippingNudge({ opts }: { opts: PlanOptions }) {
  const setPrefs = useStore((s) => s.setNotificationPrefs);
  if (!opts.nudge) return null;
  return (
    <View style={{ marginTop: space.sm }}>
      <Note tone="warn" icon="clock-alert-outline">
        {opts.nudge.text}
      </Note>
      {opts.nudge.action === 'screens-off' ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="cellphone-off" label="Turn on the screens-off reminder" onPress={() => setPrefs({ screensOff: true })} />
        </View>
      ) : null}
    </View>
  );
}

export function PlanOptionsCard({ a }: { a: Analysis }) {
  const now = useNow();
  const opts = usePlanOptions(a, now);
  // The pick starts open; others open on tap.
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  if (!opts) return null;
  const opened = openId ?? opts.recommended.id;
  const choice = opts.choice;
  const sub =
    opts.mode === 'still-up'
      ? `Lights out was ${formatTime(opts.base.bedtime)} — the best from now`
      : `${opts.options.length} ways to spend tonight, simulated · eepy's pick first`;
  return (
    <Card>
      <CardTitle icon="source-branch" title="Options for tonight" sub={sub} />
      {choice ? (
        <View style={{ marginBottom: space.sm }}>
          <Note tone="info" icon="check-circle-outline">
            {`Using “${choice.title}” tonight. eepy's plan: lights out ${formatTime(opts.base.bedtime)}${opts.base.routine ? `, routine ${formatTime(opts.base.routine.alarm)}` : ''}, up ${formatTime(opts.base.wake)}.`}
          </Note>
          <View style={{ alignItems: 'flex-start' }}>
            <Button small kind="secondary" icon="restore" label="Back to eepy's plan" onPress={() => takeOption({ apply: opts.reset })} />
          </View>
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        {opts.options.map((o) => (
          <OptionRow key={o.id} o={o} opts={opts} open={opened === o.id} onToggle={() => setOpenId(opened === o.id ? '' : o.id)} />
        ))}
      </View>
      <SlippingNudge opts={opts} />
      <HowEepyDecided steps={opts.thinking} />
      <Text style={[font.tiny, { marginTop: space.sm }]}>Nothing changes until you tap “Use this” — then the alarm, reminders and sleep mode follow.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, backgroundColor: colors.surface },
  pick: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  inUse: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.good },
  stepNo: { width: 16, fontWeight: '700', textAlign: 'right' },
});
