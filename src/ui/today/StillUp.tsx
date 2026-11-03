/**
 * Today at night, past lights-out with no "I'm in bed" yet: "Still up?" — eepy's best plan from now
 * (engine/planOptions.ts, still-up mode), 2–3 alternatives, one tap to use it. Using one sets
 * tonight's lights-out (`settings.tonight`) and/or skips the routine alarm, so the alarm, reminders
 * and sleep mode follow — and Today goes back to the countdown to the new lights-out.
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatDuration } from '@/engine/time';
import { usePlanOptions } from '@/state/planOptions';
import { Button, Card, Row } from '@/ui/components';
import { HowEepyDecided, optionStats, takeOption } from '@/ui/planner/PlanOptions';
import { colors, font, radius, space } from '@/ui/theme';

const NIGHT_CARD = { backgroundColor: '#0A0E1C', borderColor: '#2A2C55' };

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
    <Card style={NIGHT_CARD} animate={false}>
      <Text style={[font.label, { color: colors.light }]}>STILL UP?</Text>
      <Text style={[font.h2, { color: colors.text, marginTop: 4 }]}>{`${best.headline} → ${formatDuration(best.sleepMin)}`}</Text>
      <Text style={[font.small, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>{best.times}</Text>
      {best.pros[0] ? <Text style={[font.small, { marginTop: 2 }]}>{best.pros[0]}</Text> : null}
      <View style={{ marginTop: space.md }}>
        <Button icon="check" label="Use this" onPress={() => takeOption(best)} />
      </View>
      {alternatives.length ? (
        <>
          <Text style={[font.label, { marginTop: space.lg, marginBottom: space.xs }]}>OR</Text>
          <View style={{ gap: space.sm }}>
            {alternatives.map((o) => (
              <Row key={o.id} gap={space.sm} style={{ paddingVertical: 8, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: '#1E2340' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { color: colors.textDim }]}>{o.title}</Text>
                  <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>{optionStats(o)}</Text>
                </View>
                <Button small kind="secondary" label="Use" onPress={() => takeOption(o)} />
              </Row>
            ))}
          </View>
        </>
      ) : null}
      <HowEepyDecided steps={opts.thinking} color={colors.light} textColor={colors.textDim} />
      <Pressable onPress={() => router.push('/tonight')} hitSlop={8} accessibilityRole="button" style={{ marginTop: space.sm, minHeight: 32, justifyContent: 'center' }}>
        <Text style={[font.small, { color: colors.accent, fontWeight: '600' }]}>Pick your own time</Text>
      </Pressable>
    </Card>
  );
}
