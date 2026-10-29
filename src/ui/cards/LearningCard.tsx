// OWNER: learning workstream. Today-screen slot: compact progress of the body-clock learning.
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { eligibleCheckins, LEARNING, livingDay } from '@/engine/calibration';
import { MINUTE } from '@/engine/time';
import { LEARNING_RESET_MARK, useLearning } from '@/state/learning';
import { useStore } from '@/state/store';
import { Card, CardTitle, Icon, Meter } from '../components';
import { QuickCheckIn } from '../learning/QuickCheckIn';
import { colors, font, space } from '../theme';

export function LearningCard({ analysis: a }: { analysis: Analysis }) {
  useLearning();
  const calibration = useStore((s) => s.calibration);
  const checkins = useStore((s) => s.checkins);
  const resetAt = useStore((s) => s.settings.marks[LEARNING_RESET_MARK]);
  const n = useMemo(() => eligibleCheckins(checkins, a.now, typeof resetAt === 'number' ? resetAt : undefined).length, [checkins, a.now, resetAt]);

  const target = LEARNING.confidentCheckins;
  const confident = !!calibration?.applied && n >= target;
  const checkedInToday = checkins.some((c) => livingDay(c.time) === a.day && c.time <= a.now);
  const awake = a.now >= a.wakeTime + 30 * MINUTE && a.now < a.tonight.windDownStart;

  const line = calibration?.applied
    ? `${confident ? `${n} check-ins` : `${n}/${target} check-ins`} · forecast accuracy ${calibration.accuracy}%`
    : calibration
      ? `${n}/${target} check-ins · not beating the average model yet`
      : `${n}/${LEARNING.minCheckins} check-ins until your first personal forecast`;

  return (
    <Card onPress={() => router.push('/learning')}>
      <CardTitle icon="brain" title={confident ? 'Your body clock' : 'Learning your rhythm'} right={<Icon name="chevron-right" color={colors.textFaint} />} />
      <Text style={font.small}>{line}</Text>
      {!confident ? (
        <View style={{ marginTop: space.sm }}>
          <Meter value={Math.min(n, target)} max={target} color={calibration?.applied ? colors.accent : colors.warn} height={6} />
        </View>
      ) : null}
      {!checkedInToday && awake ? (
        <View style={{ marginTop: space.md }}>
          <QuickCheckIn prompt="Rate how alert you feel right now:" showFullScale={false} />
        </View>
      ) : null}
    </Card>
  );
}
