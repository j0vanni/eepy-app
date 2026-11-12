/**
 * Small pieces the Settings pages (and the setup screens) share, built from the kit's tokens:
 *
 *   ChoiceRow   a setting with a few options: the current one on the right, tap to pick in place
 *   Steps       a short numbered list; a done step shows a tick
 *   Para        a paragraph inside a Fold
 *   Caption     a small uppercase label inside a panel
 *   Outcome     what just happened (saved, cancelled, an error), shown on the page
 *   field       the look of a text field
 */
import { ReactNode, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, Fold, Icon, Note } from '../components';
import { colors, font, iconSize, radius, space } from '../theme';

export interface Choice<T> {
  label: string;
  value: T;
}

/** One setting, a handful of options. Closed it shows the current one; open, the options as chips. */
export function ChoiceRow<T extends string | number>({
  icon,
  title,
  sub,
  value,
  options,
  onChange,
  hint,
}: {
  icon?: string;
  title: string;
  sub?: string;
  value: T;
  options: Choice<T>[];
  onChange: (v: T) => void;
  /** A line under the options, shown while open. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Fold bare icon={icon} title={title} sub={sub} value={current?.label} open={open} onToggle={() => setOpen((o) => !o)}>
      <View style={local.chips}>
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            label={o.label}
            selected={o.value === value}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
          />
        ))}
      </View>
      {hint ? <Text style={[font.tiny, { marginTop: space.sm }]}>{hint}</Text> : null}
    </Fold>
  );
}

export type StepItem = string | { text: string; done?: boolean };

/** What to do, in order. */
export function Steps({ items }: { items: StepItem[] }) {
  return (
    <View style={{ gap: space.sm }}>
      {items.map((item, i) => {
        const step = typeof item === 'string' ? { text: item, done: false } : item;
        return (
          <View key={step.text} style={local.step}>
            <View style={local.stepMark}>
              {step.done ? <Icon name="check" size={iconSize.sm} color={colors.good} /> : <Text style={[font.small, { fontWeight: '700', color: colors.textFaint }]}>{i + 1}</Text>}
            </View>
            <Text style={[font.small, { flex: 1 }, step.done ? null : { color: colors.text }]}>{step.text}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function Para({ children, first }: { children: ReactNode; first?: boolean }) {
  return <Text style={[font.small, first ? null : { marginTop: space.sm }]}>{children}</Text>;
}

export function Caption({ children }: { children: string }) {
  return <Text style={[font.label, { textTransform: 'uppercase', marginBottom: space.sm }]}>{children}</Text>;
}

export interface OutcomeState {
  tone: 'good' | 'info' | 'bad' | 'warn';
  text: string;
}

export function Outcome({ status }: { status?: OutcomeState }) {
  return status ? <Note tone={status.tone}>{status.text}</Note> : null;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const local = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  stepMark: { width: 20, alignItems: 'center', paddingTop: 1 },
});

/** A text field inside a panel. */
export const field = {
  ...font.body,
  backgroundColor: colors.surfaceAlt,
  borderRadius: radius.md,
  paddingHorizontal: space.md,
  paddingVertical: space.md,
};
