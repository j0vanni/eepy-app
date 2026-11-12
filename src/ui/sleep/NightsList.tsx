/** Sleep tab → Nights: every recorded night, newest first; tap one for its full report. */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Analysis, trendRows } from '@/engine/analysis';
import { formatClock, formatDuration } from '@/engine/time';
import { selectDataset, useStore } from '@/state/store';
import { Button, Card, Icon, ListCard, ListRow, Row } from '@/ui/components';
import { dayLabel, nightLabel } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

const PAGE = 30;
const MORE = 60;
const MAX_DAYS = 180;

export function NightsList({ a }: { a: Analysis }) {
  const data = useStore(useShallow(selectDataset));
  const [days, setDays] = useState(PAGE);
  const rows = useMemo(() => trendRows(a, data, days).filter((r) => r.sleepMin !== undefined).reverse(), [a, data, days]);
  const ids = useMemo(() => new Map(a.nights.map((n) => [n.wakeDate, n.main?.id])), [a]);
  const need = a.need.needMin;

  return (
    <>
      {rows.length ? (
        <ListCard>
          {rows.map((r) => {
            const main = r.sleepMin! - r.napMin;
            const short = main < need - 15;
            const id = ids.get(r.date);
            const times = r.onsetMin !== undefined && r.wakeMin !== undefined ? `${formatClock(r.onsetMin)} → ${formatClock(r.wakeMin)}` : undefined;
            return (
              <ListRow
                key={r.date}
                // "Sat night · Sun 8 Nov": the evening it began and the morning it ended.
                title={r.date === a.day ? nightLabel(r.date, a.day) : `${nightLabel(r.date, a.day)} · ${dayLabel(r.date, a.day)}`}
                sub={[times, short ? `${formatDuration(need - main)} short` : undefined, r.napMin ? `+${formatDuration(r.napMin)} nap` : undefined].filter(Boolean).join(' · ') || undefined}
                onPress={id ? () => router.push({ pathname: '/night/[id]', params: { id } }) : undefined}
                right={
                  <Row gap={space.sm}>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[font.h3, { color: short ? colors.warn : colors.text, fontVariant: ['tabular-nums'] }]}>{formatDuration(main)}</Text>
                      {r.score !== undefined ? <Text style={[font.small, { color: scoreColor(r.score), fontVariant: ['tabular-nums'] }]}>{`Score ${r.score}`}</Text> : null}
                    </View>
                    <Icon name="chevron-right" color={id ? colors.textFaint : 'transparent'} />
                  </Row>
                }
              />
            );
          })}
        </ListCard>
      ) : (
        <Card>
          <Text style={font.small}>{`No nights recorded in the last ${days} days.`}</Text>
        </Card>
      )}
      <Row gap={space.sm} style={{ paddingHorizontal: space.xs, marginBottom: space.md }}>
        <Text style={[font.tiny, { flex: 1 }]}>{`${rows.length} night${rows.length === 1 ? '' : 's'} in the last ${days} days`}</Text>
        {days < MAX_DAYS ? <Button small kind="ghost" label="Show older nights" onPress={() => setDays(days + MORE)} /> : null}
      </Row>
      <ListCard>
        <ListRow icon="pencil-plus-outline" title="Log a night yourself" sub="For nights without the watch" onPress={() => router.push('/log-sleep')} />
      </ListCard>
    </>
  );
}
