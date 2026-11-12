/** The search box on More and Settings, backed by featureIndex.ts: type a word, tap a result to go there. */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Icon, ListCard, ListRow } from './components';
import { searchFeatures } from './featureIndex';
import { colors, font, radius, space, touch } from './theme';

const MAX_RESULTS = 8;

export function FeatureSearch({ onSearchingChange, placeholder = 'Find a feature or setting…' }: { onSearchingChange?: (searching: boolean) => void; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchFeatures(query).slice(0, MAX_RESULTS), [query]);
  const searching = query.trim().length > 0;

  const set = (q: string) => {
    setQuery(q);
    onSearchingChange?.(q.trim().length > 0);
  };

  return (
    <View style={{ marginBottom: space.md }}>
      <View style={styles.box}>
        <Icon name="magnify" color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={set}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search features and settings"
        />
        {searching ? (
          <Pressable onPress={() => set('')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="close-circle" color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      {searching ? (
        <View style={{ marginTop: space.sm }}>
          {results.length ? (
            <ListCard>
              {results.map((f) => (
                <ListRow
                  key={f.id}
                  icon={f.icon}
                  title={f.title}
                  sub={f.where}
                  onPress={() => {
                    set('');
                    router.push(f.href);
                  }}
                />
              ))}
            </ListCard>
          ) : (
            <Card animate={false}>
              <Text style={font.small}>{`Nothing found for “${query.trim()}”. Try a word like “alarm”, “coffee”, “wake-up” or “sync”.`}</Text>
            </Card>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touch.comfy },
  // The box already shows where you type; no extra browser focus ring in the web preview.
  input: { ...font.body, flex: 1, paddingVertical: space.sm, minWidth: 0, outlineStyle: 'solid', outlineWidth: 0 },
});
