/**
 * Today at night, past lights-out with no "I'm in bed" yet: "Still up?" — eepy's best plan from now
 * (engine/planOptions.ts, still-up mode), 2–3 alternatives, one tap to use it. Using one sets
 * tonight's lights-out (`settings.tonight`) and/or skips the routine alarm, so the alarm, reminders
 * and sleep mode follow — and Today goes back to the countdown to the new lights-out.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatDuration } from '@/engine/time';
import { usePlanOptions } from '@/state/planOptions';
import { Button, Card, Divider, Row } from '@/ui/components';
import { HowEepyDecided, optionStats, takeOption } from '@/ui/planner/PlanOptions';
import { colors, font, night, space } from '@/ui/theme';

import { Caption, NIGHT_PANEL } from './nightParts';

export function StillUpCard({ a, now }: { a: Analysis; now: number }) {
  const opts = usePlanOptions(a, now);
  // Only once tonight's lights-out (eepy's, or a time you picked) has passed.
  if (!opts || now < a.tonight.bedtime) return null;
  // Options still ahead of you (eepy's own lights-out may be later than a time you picked).
  const ahead = opts.options.filter((o) => o.bedtime >= now);
  if (!ahead.length) return null;
  const best = ahead.includes(opts.recommended) ? opts.recommended : ahead.reduce((b, o) => (o.utility > b.utility ? o : b));
  const alternatives = ahead.filter((o) => o !== best).slice(0, 3);
  return (
    <Card style={NIGHT_PANEL} animate={false}>
      <Caption color={colors.sleep}>Still up?</Caption>
      <Text style={[font.h2, { color: night.text, marginTop: space.xs }]}>{`${best.headline} → ${formatDuration(best.sleepMin)}`}</Text>
      <Text style={[font.small, { color: night.textDim, marginTop: space.xxs, fontVariant: ['tabular-nums'] }]}>{best.times}</Text>
      {best.pros[0] ? <Text style={[font.small, { color: night.textDim }]}>{best.pros[0]}</Text> : null}
      <Button kind="secondary" icon="check" label="Use this" style={{ marginTop: space.md }} onPress={() => takeOption(best)} />
      {alternatives.length ? (
        <>
          <Caption style={{ marginTop: space.lg }}>Or</Caption>
          {alternatives.map((o, i) => (
            <View key={o.id}>
              {i ? <Divider spacing={0} /> : null}
              <Row gap={space.md} style={{ paddingVertical: space.sm, minHeight: 56 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { color: night.text }]}>{o.title}</Text>
                  <Text style={[font.small, { color: night.textDim, fontVariant: ['tabular-nums'] }]}>{optionStats(o)}</Text>
                </View>
                <Button small kind="secondary" label="Use" onPress={() => takeOption(o)} />
              </Row>
            </View>
          ))}
        </>
      ) : null}
      <Divider spacing={space.sm} />
      <HowEepyDecided steps={opts.thinking} />
      <View style={{ alignItems: 'flex-start' }}>
        <Button small kind="ghost" icon="clock-edit-outline" label="Pick your own time" onPress={() => router.push('/tonight')} />
      </View>
    </Card>
  );
}
