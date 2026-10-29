import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatDuration, formatTime } from '@/engine/time';
import { Card, CardTitle, Icon, Note, Ring } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

import { CARD_LEAD_MS, WIND_DOWN_CHECKLIST, windDownStatus } from '../windDown';

/** Big countdown to wind-down / lights-out from tonight's plan. */
export function CountdownHero({ analysis, now }: { analysis: Analysis | undefined; now: number }) {
  if (!analysis) {
    return (
      <Card style={styles.hero}>
        <Row icon="weather-night" ring={0}>
          <Text style={font.tiny}>WIND DOWN</Text>
          <Text style={styles.big}>Tonight</Text>
          <Text style={font.small}>Sync a few nights from your watch for a personal lights-out time. Everything below works already.</Text>
        </Row>
      </Card>
    );
  }
  const t = analysis.tonight;
  const s = windDownStatus(now, t);
  if (s.phase === 'before') {
    const lead = Math.min(1, Math.max(0, 1 - (t.windDownStart - now) / CARD_LEAD_MS));
    return (
      <Card style={styles.hero}>
        <Row icon="weather-sunset-down" ring={lead} color={colors.light}>
          <Text style={font.tiny}>WIND-DOWN STARTS IN</Text>
          <Text style={styles.big}>{formatDuration(s.minToWindDown)}</Text>
          <Text style={font.small}>
            at {formatTime(t.windDownStart)} · lights out {formatTime(t.bedtime)} · wake {formatTime(t.wake)}
          </Text>
        </Row>
      </Card>
    );
  }
  if (s.phase === 'during') {
    return (
      <Card style={styles.hero} accent={colors.accent}>
        <Row icon="weather-night" ring={s.progress} color={colors.accent}>
          <Text style={[font.tiny, { color: colors.accent }]}>LIGHTS OUT IN</Text>
          <Text style={styles.big}>{formatDuration(s.minToBedtime)}</Text>
          <Text style={font.small}>
            Lights out {formatTime(t.bedtime)} · wake {formatTime(t.wake)}
          </Text>
        </Row>
      </Card>
    );
  }
  return (
    <Card style={styles.hero} accent={colors.deep}>
      <Row icon="sleep" ring={1} color={colors.deep}>
        <Text style={font.tiny}>PAST LIGHTS-OUT</Text>
        <Text style={styles.big}>Time to sleep</Text>
        <Text style={font.small}>
          Lights out was {formatTime(t.bedtime)} ({formatDuration(-s.minToBedtime)} ago) · wake {formatTime(t.wake)}. Put the phone face down — sounds keep playing.
        </Text>
      </Row>
    </Card>
  );
}

function Row({ icon, ring, color = colors.accent, children }: { icon: string; ring: number; color?: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      {ring > 0.01 ? (
        <Ring value={ring} max={1} size={76} stroke={6} color={color}>
          <Icon name={icon} size={28} color={color} />
        </Ring>
      ) : (
        <View style={styles.ringIdle}>
          <Icon name={icon} size={28} color={color} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>{children}</View>
    </View>
  );
}

// Ticks survive leaving and re-opening the screen during this app session, per night.
const ticksByNight = new Map<string, string[]>();

export function Checklist({ nightKey }: { nightKey: string }) {
  const [done, setDone] = useState<string[]>(() => ticksByNight.get(nightKey) ?? []);
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    ticksByNight.set(nightKey, next);
    setDone(next);
  };
  const all = done.length === WIND_DOWN_CHECKLIST.length;
  return (
    <Card>
      <CardTitle
        icon="clipboard-check-outline"
        title="Before lights-out"
        color={colors.good}
        right={<Text style={[font.small, { color: all ? colors.good : colors.textDim }]}>{`${done.length} of ${WIND_DOWN_CHECKLIST.length}`}</Text>}
      />
      {WIND_DOWN_CHECKLIST.map((item, i) => {
        const checked = done.includes(item.id);
        return (
          <Pressable
            key={item.id}
            onPress={() => toggle(item.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            style={({ pressed }) => [styles.item, i > 0 && styles.itemBorder, pressed && { opacity: 0.7 }]}
          >
            <Icon name={checked ? 'check-circle' : 'checkbox-blank-circle-outline'} size={24} color={checked ? colors.good : colors.textFaint} />
            <View style={{ flex: 1 }}>
              <Text style={[font.body, checked && styles.checkedText]}>{item.title}</Text>
              <Text style={font.small}>{item.sub}</Text>
            </View>
            <Icon name={item.icon} size={20} color={checked ? colors.textFaint : colors.textDim} />
          </Pressable>
        );
      })}
      {all ? (
        <View style={{ marginTop: space.sm }}>
          <Note tone="good" icon="weather-night">
            All set. Keep the lights low from here.
          </Note>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { paddingVertical: space.xl },
  ringIdle: { width: 76, height: 76, borderRadius: 38, borderWidth: 6, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  big: { fontSize: 34, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkedText: { color: colors.textDim, textDecorationLine: 'line-through' },
});
