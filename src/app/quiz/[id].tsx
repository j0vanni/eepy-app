/**
 * A questionnaire (insomnia, sleepiness, breathing, body clock): one question at a time, the
 * answers as large rows; then the score and what it means.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CHRONOTYPE_LABELS, categoryFromRmeq } from '@/engine/chronotype';
import { Quiz, QUIZZES, scoreQuiz } from '@/engine/screening';
import { dateKey, localizeClockText } from '@/engine/time';
import { useStore } from '@/state/store';
import { Button, Empty, Hero, Meter, Note, Screen } from '@/ui/components';
import { selectionTick } from '@/ui/haptics';
import { colors, font, radius, space, touch } from '@/ui/theme';

export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: Quiz['id'] }>();
  const quiz = QUIZZES[id];
  const saveScreening = useStore((s) => s.saveScreening);
  const [answers, setAnswers] = useState<number[]>([]);
  const [step, setStep] = useState(0);

  if (!quiz) {
    return (
      <Screen>
        <Empty icon="help-circle-outline" title="Unknown questionnaire" body="" />
      </Screen>
    );
  }
  const done = step >= quiz.questions.length;

  const choose = (value: number) => {
    selectionTick();
    const next = [...answers];
    next[step] = value;
    setAnswers(next);
    if (step + 1 >= quiz.questions.length) {
      const { score } = scoreQuiz(quiz.id, next);
      saveScreening(quiz.id, next, score, dateKey(Date.now()));
    }
    setStep(step + 1);
  };

  if (done) {
    const { score, band } = scoreQuiz(quiz.id, answers);
    const tone = band.level === 'alert' ? 'bad' : band.level === 'warn' ? 'warn' : band.level === 'good' ? 'good' : 'info';
    const chrono = quiz.id === 'rmeq' ? CHRONOTYPE_LABELS[categoryFromRmeq(score)] : undefined;
    const max = quiz.bands.reduce((m, b) => Math.max(m, b.max), 0);
    const color = tone === 'bad' ? colors.bad : tone === 'warn' ? colors.warn : tone === 'good' ? colors.good : colors.text;
    return (
      <Screen>
        <Stack.Screen options={{ title: quiz.title }} />
        <Hero
          label="Your score"
          value={String(score)}
          unit={`/ ${max}`}
          color={color}
          caption={
            <View style={{ marginTop: space.md }}>
              <Meter value={score} max={max} color={tone === 'bad' ? colors.bad : tone === 'warn' ? colors.warn : colors.accent} />
              <Text style={[font.h2, { marginTop: space.md }]}>{chrono ? chrono.label : band.label}</Text>
              <Text style={[font.body, { color: colors.textDim, marginTop: space.xs }]}>{chrono ? chrono.description : band.detail}</Text>
            </View>
          }
        />
        <View style={{ gap: space.sm, marginBottom: space.md }}>
          <Button label="Done" onPress={() => router.back()} />
          <Button
            kind="ghost"
            label="Take it again"
            onPress={() => {
              setAnswers([]);
              setStep(0);
            }}
          />
        </View>
        {quiz.id !== 'rmeq' ? <Note tone={tone}>This is a screening aid, not a diagnosis. Share the result with a doctor if you're concerned.</Note> : null}
        <Text style={[font.tiny, { marginTop: space.sm, paddingHorizontal: space.xs }]}>{quiz.source}</Text>
      </Screen>
    );
  }

  const q = quiz.questions[step];
  return (
    <Screen subtitle={step === 0 ? quiz.intro : undefined}>
      <Stack.Screen options={{ title: quiz.title }} />
      <Text style={[font.label, { textTransform: 'uppercase' }]}>
        Question {step + 1} of {quiz.questions.length}
      </Text>
      <View style={{ marginTop: space.sm }}>
        <Meter value={step} max={quiz.questions.length} height={4} />
      </View>
      <Text style={[font.h2, { marginTop: space.lg, marginBottom: space.lg }]} accessibilityRole="header">
        {q.text}
      </Text>
      <View style={{ gap: space.sm }}>
        {q.options.map((o) => {
          const on = answers[step] === o.value;
          return (
            <Pressable
              key={o.label}
              onPress={() => choose(o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.option, on ? { backgroundColor: colors.accentSoft } : null, pressed ? { backgroundColor: colors.surfaceAlt } : null]}
            >
              <Text style={[font.body, { flex: 1 }]}>{localizeClockText(o.label)}</Text>
            </Pressable>
          );
        })}
      </View>
      {step > 0 ? <Button kind="ghost" label="Back" onPress={() => setStep(step - 1)} style={{ marginTop: space.md }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', minHeight: touch.comfy + space.sm, paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
});
