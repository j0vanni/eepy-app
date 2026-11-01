/** Sleep tab → Nights: every recorded night, newest first; tap one for its full report. */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Analysis, trendRows } from '@/engine/analysis';
import { formatClock, formatDuration } from '@/engine/time';
import { selectDataset, useStore } from '@/state/store';
import { Button, Card, Icon, Row } from '@/ui/components';
import { dayLabel, nightLabel } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

const PAGE = 30;

export function NightsList({ a }: { a: Analysis }) {
  const data = useStore(useShallow(selectDataset));
  const [days, setDays] = useState(PAGE);
  const rows = useMemo(() => trendRows(a, data, days).filter((r) => r.sleepMin !== undefined).reverse(), [a, data, days]);
  const ids = useMemo(() => new Map(a.nights.map((n) => [n.wakeDate, n.main?.id])), [a]);
  const need = a.need.needMin;

  return (
    <>
      <Row gap={space.sm} style={{ marginBottom: space.sm, flexWrap: 'wrap' }}>
        <Text style={[font.small, { flex: 1 }]}>{`${rows.length} nights in the last ${days} days. Tap one for its full report.`}</Text>
        <Button small kind="secondary" icon="pencil-plus" label="Log a night" onPress={() => router.push('/log-sleep')} />
      </Row>
      <Card style={{ paddingVertical: space.sm }}>
        {rows.map((r, i) => {
          const main = r.sleepMin! - r.napMin;
          const short = main < need - 15;
          const id = ids.get(r.date);
          return (
            <Pressable
              key={r.date}
              onPress={() => id && router.push({ pathname: '/night/[id]', params: { id } })}
              disabled={!id}
              style={({ pressed }) => [styles.row, i ? styles.rowBorder : null, pressed ? { opacity: 0.6 } : null]}
              accessibilityRole="button"
              accessibilityLabel={`${nightLabel(r.date)}, ${formatDuration(main)}${r.score !== undefined ? `, score ${r.score}` : ''}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={font.body}>{nightLabel(r.date)}</Text>
                <Text style={font.small}>
                  {dayLabel(r.date)}
                  {r.onsetMin !== undefined && r.wakeMin !== undefined ? ` · ${formatClock(r.onsetMin)} → ${formatClock(r.wakeMin)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[font.h3, { color: short ? colors.warn : colors.text, fontVariant: ['tabular-nums'] }]}>{formatDuration(main)}</Text>
                <Text style={font.tiny}>{short ? `${formatDuration(need - main)} short` : 'enough'}</Text>
              </View>
              <View style={[styles.score, { borderColor: r.score !== undefined ? scoreColor(r.score) : colors.border }]}>
                <Text style={[font.small, { color: colors.text, fontWeight: '700' }]}>{r.score ?? '–'}</Text>
              </View>
              <Icon name="chevron-right" color={id ? colors.textFaint : 'transparent'} />
            </Pressable>
          );
        })}
        {rows.length === 0 ? <Text style={[font.small, { paddingVertical: space.md }]}>No nights recorded in this period.</Text> : null}
      </Card>
      {days < 180 ? (
        <View style={{ alignItems: 'center' }}>
          <Button small kind="ghost" label="Show older nights" onPress={() => setDays(days + 60)} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  score: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
