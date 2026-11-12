// The recovery alert panel (Energy → Recovery).
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { Lines } from '@/ui/coach/parts';
import { Card, CardTitle, Divider, Fold, KeyValue, Pill } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const UNIT = { hr: ' bpm', hrv: ' ms', resp: ' / min' } as const;

/**
 * A gentle, non-diagnostic warning when resting heart rate, HRV and breathing rate drift from your
 * own baseline: what it is, each signal as a row (the ones that are off in the alert's colour), and
 * what to do about it, folded away.
 */
export function RecoveryAlertCard({ analysis: a }: { analysis: Analysis }) {
  const alert = a.recoveryAlert;
  if (!alert) return null;
  const tone = alert.level === 'warning' ? colors.bad : colors.warn;
  return (
    <Card>
      <CardTitle icon="heart-pulse" title={alert.title} color={tone} right={<Pill label={alert.level === 'warning' ? 'Take it easy' : 'Keep an eye on it'} color={tone} />} />
      <Text style={font.small}>{alert.detail}</Text>
      {alert.signals?.length ? (
        <View style={{ marginTop: space.sm }}>
          {alert.signals.map((s) => (
            <KeyValue
              key={s.key}
              label={s.label}
              sub={`Usually ${s.key === 'resp' ? s.baseline.toFixed(1) : Math.round(s.baseline)}${UNIT[s.key] ?? ''}`}
              value={s.change}
              color={s.off ? tone : colors.text}
            />
          ))}
        </View>
      ) : null}
      {alert.advice?.length ? (
        <>
          <Divider spacing={space.xs} />
          <Fold bare title="What helps" value={`${alert.advice.length} thing${alert.advice.length === 1 ? '' : 's'}`}>
            <Lines items={alert.advice} />
          </Fold>
        </>
      ) : null}
    </Card>
  );
}
