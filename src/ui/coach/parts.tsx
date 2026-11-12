/**
 * Small pieces the coach screens share, built from the kit's tokens:
 *
 *   Lines               short lines of small text (reasons, tips, rules of thumb)
 *   CheckRow            a row you tick off
 *   ExperimentHero      the running experiment: which day, the rule, the days so far
 *   ExperimentQuestion  "Did you keep to it yesterday?" with Yes / No
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { Experiment, experimentQuestion, ExperimentResult, experimentRule } from '@/engine/experiments';
import { localizeClockText } from '@/engine/time';
import { setAnswer } from '@/ui/coach/actions';
import { ExperimentDots } from '@/ui/coach/Dots';
import { Button, Card, Hero, Icon, Row } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space, touch } from '@/ui/theme';

/** Short lines of small text, each behind a dot. `plain`: paragraphs without the dot. */
export function Lines({ items, plain, icon = 'circle-small', color = colors.textFaint }: { items: string[]; plain?: boolean; icon?: string; color?: string }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {items.map((t) =>
        plain ? (
          <Text key={t} style={font.small}>
            {t}
          </Text>
        ) : (
          <Row key={t} gap={space.xs} style={{ alignItems: 'flex-start' }}>
            <Icon name={icon} color={color} />
            <Text style={[font.small, { flex: 1, color: colors.text }]}>{t}</Text>
          </Row>
        ),
      )}
    </View>
  );
}

/** A row you tick off: the whole row is the target. */
export function CheckRow({ title, sub, checked, onToggle }: { title: string; sub?: string; checked: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [{ flexDirection: 'row', gap: space.md, paddingVertical: space.md, minHeight: touch.comfy, alignItems: 'flex-start' }, pressed ? { opacity: 0.65 } : null]}
    >
      <Icon name={checked ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={22} color={checked ? colors.good : colors.textFaint} />
      <View style={{ flex: 1 }}>
        <Text style={font.body}>{title}</Text>
        {sub ? <Text style={font.small}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Which day of the experiment today is (1-based). */
export function experimentDay(exp: Experiment, result: ExperimentResult, today: string): number {
  const idx = result.days.findIndex((d) => d.status === 'today' || d.date === today);
  return idx >= 0 ? idx + 1 : result.complete ? exp.durationDays : result.elapsed;
}

/** The running experiment as a screen's opening: the day, the rule, the days so far. `link` opens it. */
export function ExperimentHero({ a, exp, result, link }: { a: Analysis; exp: Experiment; result: ExperimentResult; link?: boolean }) {
  const rec = result.recommendation;
  return (
    <Hero
      label={link ? `Your experiment · ${localizeClockText(exp.title)}` : 'Running'}
      value={result.complete ? 'All nights in' : `Day ${experimentDay(exp, result, a.day)} of ${exp.durationDays}`}
      caption={experimentRule(exp)}
      onPress={link ? () => router.push({ pathname: '/experiments/[id]', params: { id: exp.id } }) : undefined}
    >
      <View style={{ marginTop: space.md }}>
        <ExperimentDots days={result.days} size={exp.durationDays > 7 ? 20 : 28} />
      </View>
      <Text style={[font.small, { marginTop: space.sm }]}>
        {result.complete ? 'Open it to see your result.' : `${rec.title} · kept ${result.kept} of ${result.elapsed}${result.nightsAnalysed ? ` · ${result.nightsAnalysed} night${result.nightsAnalysed === 1 ? '' : 's'} compared` : ''}`}
      </Text>
    </Hero>
  );
}

/** The yes/no eepy can't work out from the data for a finished day. */
export function ExperimentQuestion({ exp, date, today }: { exp: Experiment; date: string; today: string }) {
  return (
    <Card>
      <Text style={[font.label, { textTransform: 'uppercase' }]}>{dayLabel(date, today)}</Text>
      <Text style={[font.h3, { marginTop: space.xs }]}>{experimentQuestion(exp)}</Text>
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Button label="Yes" icon="check" onPress={() => setAnswer(exp, date, true)} style={{ flex: 1 }} />
        <Button kind="secondary" label="No" icon="close" onPress={() => setAnswer(exp, date, false)} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}
