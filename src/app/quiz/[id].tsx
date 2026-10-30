import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CHRONOTYPE_LABELS, categoryFromRmeq } from '@/engine/chronotype';
import { Quiz, QUIZZES, scoreQuiz } from '@/engine/screening';
import { dateKey, localizeClockText } from '@/engine/time';
import { useStore } from '@/state/store';
import { Button, Card, Empty, Meter, Note, Row, Screen } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

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
    return (
      <Screen>
        <Stack.Screen options={{ title: quiz.title }} />
        <Card>
          <Text style={font.tiny}>YOUR SCORE</Text>
          <Text style={[font.stat, { marginVertical: 4 }]}>
            {score}
            <Text style={font.small}> / {max}</Text>
          </Text>
          <Meter value={score} max={max} color={tone === 'bad' ? colors.bad : tone === 'warn' ? colors.warn : colors.accent} />
          <Text style={[font.h2, { marginTop: space.md }]}>{chrono ? chrono.label : band.label}</Text>
          <Text style={[font.body, { marginTop: space.sm }]}>{chrono ? chrono.description : band.detail}</Text>
        </Card>
        {quiz.id !== 'rmeq' ? <Note tone={tone}>This is a screening aid, not a diagnosis. Share the result with a doctor if you're concerned.</Note> : null}
        <Text style={[font.tiny, { marginVertical: space.md }]}>{quiz.source}</Text>
        <Row gap={space.sm}>
          <Button label="Done" onPress={() => router.back()} />
          <Button
            kind="ghost"
            label="Retake"
            onPress={() => {
              setAnswers([]);
              setStep(0);
            }}
          />
        </Row>
      </Screen>
    );
  }

  const q = quiz.questions[step];
  return (
    <Screen>
      <Stack.Screen options={{ title: quiz.title }} />
      {step === 0 ? <Text style={[font.body, { marginBottom: space.md }]}>{quiz.intro}</Text> : null}
      <Text style={font.tiny}>
        QUESTION {step + 1} OF {quiz.questions.length}
      </Text>
      <View style={{ marginVertical: space.sm }}>
        <Meter value={step} max={quiz.questions.length} height={4} />
      </View>
      <Text style={[font.h2, { marginVertical: space.md }]}>{q.text}</Text>
      {q.options.map((o) => (
        <Pressable key={o.label} onPress={() => choose(o.value)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Card style={answers[step] === o.value ? { borderColor: colors.accent } : undefined}>
            <Text style={font.body}>{localizeClockText(o.label)}</Text>
          </Card>
        </Pressable>
      ))}
      {step > 0 ? <Button kind="ghost" label="Back" onPress={() => setStep(step - 1)} /> : null}
    </Screen>
  );
}
