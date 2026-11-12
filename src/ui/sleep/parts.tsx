/** Small pieces the Sleep screens share that the kit doesn't have: the five rating faces and a score in words. */
import { Pressable, Text } from 'react-native';

import type { SleepScore } from '@/engine/sleepScore';
import { Row } from '@/ui/components';
import { colors, font, radius, scoreColor, space } from '@/ui/theme';

export const RATINGS = ['😫', '😕', '😐', '🙂', '😄'];

/** "How did you sleep?" — five faces, 1 (worst) to 5 (best). */
export function RatingFaces({ value, onChange }: { value?: number; onChange: (rating: number) => void }) {
  return (
    <Row gap={space.xs} style={{ justifyContent: 'space-between' }}>
      {RATINGS.map((r, i) => {
        const selected = value === i + 1;
        return (
          <Pressable
            key={r}
            onPress={() => onChange(i + 1)}
            style={({ pressed }) => [
              { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.md },
              { backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceAlt : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Rate ${i + 1} of 5`}
          >
            <Text style={{ fontSize: font.stat.fontSize, opacity: value && !selected ? 0.4 : 1 }}>{r}</Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** A Hero caption: the score in words (in its colour), the number, and anything else worth one line. */
export function ScoreLine({ score, rest }: { score?: SleepScore; rest?: string }) {
  if (!score && !rest) return null;
  return (
    <Text style={[font.body, { color: colors.textDim, marginTop: space.xs }]}>
      {score ? <Text style={{ color: scoreColor(score.total), fontWeight: '700' }}>{score.label}</Text> : null}
      {score ? ` · score ${score.total}` : ''}
      {rest ? `${score ? ' · ' : ''}${rest}` : ''}
    </Text>
  );
}

/** A question inside a form panel ("How did you sleep?"). The first one in a panel passes `first`. */
export function Question({ children, first }: { children: string; first?: boolean }) {
  return <Text style={[font.h3, { marginTop: first ? 0 : space.lg, marginBottom: space.sm }]}>{children}</Text>;
}
