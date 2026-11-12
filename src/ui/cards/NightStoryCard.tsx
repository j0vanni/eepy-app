/**
 * The night in plain sentences (engine/nightStory.ts): what the night looked like, then what may
 * explain it. Numbers are bold; a logged tag or drink is a link to that evening's journal.
 */
import { router } from 'expo-router';
import { Text } from 'react-native';

import type { NightStory, StoryFactor, StorySentence, StoryTone } from '@/engine/nightStory';
import { Card } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const TONE_COLOR: Record<StoryTone, string> = { good: colors.good, neutral: colors.text, bad: colors.warn };

/** What the night itself looked like vs. what may explain it. */
const EXPLAIN = new Set(['factors', 'personal', 'helped', 'noted', 'hint']);

/** Tags and logged caffeine live in that evening's journal entry. */
const linked = (f: StoryFactor) => f.kind === 'tag' || f.kind === 'caffeine';

function Paragraph({ sentences, factors }: { sentences: StorySentence[]; factors: StoryFactor[] }) {
  if (!sentences.length) return null;
  return (
    <Text style={[font.body, { color: colors.textDim, marginBottom: space.sm }]}>
      {sentences.map((s, i) => (
        <Text key={i}>
          {i > 0 ? ' ' : ''}
          {s.parts.map((p, j) => {
            const f = p.factor ? factors.find((x) => x.id === p.factor) : undefined;
            if (f) {
              const link = linked(f);
              return (
                <Text
                  key={j}
                  onPress={link ? () => router.push({ pathname: '/journal', params: { date: f.date } }) : undefined}
                  accessibilityRole={link ? 'link' : undefined}
                  style={{ color: f.role === 'likely' ? colors.warn : f.role === 'helped' ? colors.good : colors.text, fontWeight: '600', textDecorationLine: link ? 'underline' : 'none' }}
                >
                  {p.text}
                </Text>
              );
            }
            return p.strong ? (
              <Text key={j} style={{ color: TONE_COLOR[s.tone], fontWeight: '700' }}>
                {p.text}
              </Text>
            ) : (
              <Text key={j}>{p.text}</Text>
            );
          })}
        </Text>
      ))}
    </Text>
  );
}

export function NightStoryCard({ story }: { story: NightStory }) {
  const night = story.sentences.filter((s) => !EXPLAIN.has(s.topic));
  const why = story.sentences.filter((s) => EXPLAIN.has(s.topic));
  return (
    <Card>
      <Paragraph sentences={night} factors={story.factors} />
      <Paragraph sentences={why} factors={story.factors} />
      <Text style={font.tiny}>
        {story.baselineNights >= 5 ? `Compared with your previous ${story.baselineNights} nights. ` : ''}
        {story.staged ? 'Stages and heart rate are wrist estimates' : 'Heart rate is a wrist estimate'}; &ldquo;likely&rdquo; causes are guesses from your own data, not proof.
      </Text>
    </Card>
  );
}
