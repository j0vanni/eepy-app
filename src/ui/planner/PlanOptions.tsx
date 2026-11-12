/**
 * Plan → "Options for tonight": one row per option, eepy's pick first. A row opens to its numbers,
 * pros and cons and "Use this" (the pick is open already unless it is the one in use); the last
 * row, folded, is how eepy decided.
 * Today's "Still up?" card (ui/today/StillUp.tsx) shares optionStats, takeOption and HowEepyDecided.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import type { PlanOption, PlanOptions } from '@/engine/planOptions';
import { formatDuration, formatTime } from '@/engine/time';
import { applyPlanOption, usePlanOptions } from '@/state/planOptions';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Banner, Button, Fold, Icon, styles as kit, ListCard, Note, Row, Section } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, iconSize, space, touch } from '@/ui/theme';

import { Bullet, Caption } from './parts';

/** A duration that never breaks across lines ("1h 22m"). */
const dur = (m: number) => formatDuration(m).replace(/ /g, ' ');
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

/** The reasoning, step by step; the last step is the conclusion. */
function Steps({ steps, color = colors.textFaint, textColor }: { steps: string[]; color?: string; textColor?: string }) {
  return (
    <View style={{ gap: space.sm }}>
      {steps.map((s, i) => (
        <Row key={s} gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Text style={[font.small, { width: 16, fontWeight: '700', textAlign: 'right', color }]}>{i + 1}</Text>
          <Text style={[font.small, { flex: 1 }, textColor ? { color: textColor } : null, i === steps.length - 1 ? { color: textColor ?? colors.text, fontWeight: '700' } : null]}>{s}</Text>
        </Row>
      ))}
    </View>
  );
}

/** "How eepy decided" as a quiet line that opens in place, for a panel that is not a list (the "Still up?" card). */
export function HowEepyDecided({ steps, color = colors.accent, textColor }: { steps: string[]; color?: string; textColor?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touch.min }, pressed ? { opacity: 0.6 } : null]}
      >
        <Text style={[font.small, { color, fontWeight: '700', flex: 1 }]}>How eepy decided</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={iconSize.md} color={color} />
      </Pressable>
      {open ? <Steps steps={steps} color={color} textColor={textColor} /> : null}
    </View>
  );
}

function OptionDetails({ o, opts }: { o: PlanOption; opts: PlanOptions }) {
  const def = opts.defaultOption;
  const first = o.week[0];
  const last = o.week[o.week.length - 1];
  return (
    <View style={{ gap: space.sm, paddingBottom: space.md }}>
      <View>
        <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{optionStats(o)}</Text>
        <Text style={font.small}>
          {`Tomorrow: energy ${o.energy}${o === def ? '' : ` (plan ${def.energy})`} · ${o.focusHours.toFixed(1)} h of focus${o === def ? '' : ` (plan ${def.focusHours.toFixed(1)})`}`}
        </Text>
        <Text style={font.small}>{`Debt ${formatDuration(o.debtAfterMin)} after tonight · about ${o.latencyMin} min to fall asleep`}</Text>
        {first && last && o.week.length > 1 ? (
          <Text style={font.small}>{`Then eepy's plan: lights out ${formatTime(first.bedtime)} tonight → ${formatTime(last.bedtime)} by the ${o.week.length}th night`}</Text>
        ) : null}
      </View>
      {o.pros.map((p) => (
        <Bullet key={`+${p}`} icon="plus-circle-outline" color={colors.good} strong>
          {p}
        </Bullet>
      ))}
      {o.cons.map((c) => (
        <Bullet key={`-${c}`} icon="minus-circle-outline" color={colors.warn} strong>
          {c}
        </Bullet>
      ))}
      {o.kept ? <Text style={font.tiny}>{`Kept up every night (${o.kept.rule}): ${formatDuration(o.kept.debtWeekMin)} of debt in a week.`}</Text> : null}
      {o.inUse ? null : (
        <View style={{ alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="check" label="Use this" onPress={() => takeOption(o)} />
        </View>
      )}
    </View>
  );
}

function OptionRow({ o, opts, open, onToggle }: { o: PlanOption; opts: PlanOptions; open: boolean; onToggle: () => void }) {
  return (
    <View accessibilityLabel={`${o.title}${o.recommended ? ", eepy's pick" : ''}${o.inUse ? ', in use' : ''}. ${o.times}. ${optionStats(o)}`}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => [kit.listRow, pressed ? { opacity: 0.65 } : null]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {o.recommended || o.inUse ? (
            <Row gap={space.md} style={{ marginBottom: space.xxs }}>
              {o.recommended ? <Caption color={colors.sleep}>eepy's pick</Caption> : null}
              {o.inUse ? <Caption color={colors.good}>In use</Caption> : null}
            </Row>
          ) : null}
          <Text style={font.body}>{o.title}</Text>
          <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{o.times}</Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color={colors.textFaint} />
      </Pressable>
      {open ? <OptionDetails o={o} opts={opts} /> : null}
    </View>
  );
}

/** Bedtime keeps slipping: start wind-down earlier, and the screens-off reminder if it's off. */
export function SlippingNudge({ opts }: { opts: PlanOptions }) {
  const setPrefs = useStore((s) => s.setNotificationPrefs);
  if (!opts.nudge) return null;
  const reminder = opts.nudge.action === 'screens-off';
  return <Banner tone="warn" icon="clock-alert-outline" text={opts.nudge.text} action={reminder ? 'Remind me' : undefined} onAction={reminder ? () => setPrefs({ screensOff: true }) : undefined} />;
}

/** The section on the Plan tab. Renders nothing when there are no options (in bed, in the insomnia programme, no plan yet). */
export function PlanOptionsCard({ a }: { a: Analysis }) {
  const now = useNow();
  const opts = usePlanOptions(a, now);
  // One line each. eepy's pick starts open while there is something to decide (it isn't in use yet).
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  if (!opts) return null;
  const opened = openId ?? (opts.recommended.inUse ? '' : opts.recommended.id);
  const choice = opts.choice;
  return (
    <Section title="Options for tonight">
      {choice ? (
        <View style={{ marginBottom: space.sm }}>
          <Note icon="check-circle-outline">
            {`Using “${choice.title}” tonight. eepy's plan: lights out ${formatTime(opts.base.bedtime)}${opts.base.routine ? `, routine ${formatTime(opts.base.routine.alarm)}` : ''}, up ${formatTime(opts.base.wake)}.`}
          </Note>
          <View style={{ alignItems: 'flex-start' }}>
            <Button small kind="secondary" icon="restore" label="Back to eepy's plan" onPress={() => takeOption({ apply: opts.reset })} />
          </View>
        </View>
      ) : opts.mode === 'still-up' ? (
        <Note icon="clock-outline">{`Lights out was ${formatTime(opts.base.bedtime)}. These are the best ways to spend the rest of the night.`}</Note>
      ) : null}
      <ListCard>
        {opts.options.map((o) => (
          <OptionRow key={o.id} o={o} opts={opts} open={opened === o.id} onToggle={() => setOpenId(opened === o.id ? '' : o.id)} />
        ))}
        <Fold bare title="How eepy decided">
          <Steps steps={opts.thinking} />
        </Fold>
      </ListCard>
      <SlippingNudge opts={opts} />
      <Text style={[font.tiny, { paddingHorizontal: space.xs }]}>Nothing changes until you tap “Use this”. Then the alarm, reminders and sleep mode follow.</Text>
    </Section>
  );
}
