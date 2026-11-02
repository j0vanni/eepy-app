/** The four self-check questionnaires with your latest result (More → Self-checks, Settings → You & schedule). */
import { router } from 'expo-router';

import { QUIZZES, scoreQuiz } from '@/engine/screening';
import { useStore } from '@/state/store';
import { ListCard, ListRow } from '@/ui/components';

const QUIZ_ICON: Record<string, string> = { rmeq: 'owl', ess: 'sleep', isi: 'eye-outline', stopbang: 'lungs' };

export function SelfChecksCard() {
  const screenings = useStore((s) => s.profile.screenings);
  return (
    <ListCard>
      {Object.values(QUIZZES).map((q) => {
        const r = screenings[q.id];
        const band = r ? scoreQuiz(q.id, r.answers).band : undefined;
        return (
          <ListRow
            key={q.id}
            icon={QUIZ_ICON[q.id]}
            title={q.title}
            sub={band ? `${r!.score} · ${band.label} (${r!.date})` : q.subtitle}
            onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: q.id } })}
          />
        );
      })}
    </ListCard>
  );
}
