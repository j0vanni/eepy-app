/** The "Find a feature or setting…" box on More and Settings, backed by featureIndex.ts. */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Icon, ListRow } from './components';
import { searchFeatures } from './featureIndex';
import { colors, font, radius, space } from './theme';

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
        <Icon name="magnify" size={20} color={colors.textFaint} />
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
          <Pressable onPress={() => set('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      {searching ? (
        <Card style={{ marginTop: space.sm, paddingVertical: space.xs }} animate={false}>
          {results.length ? (
            results.map((f) => (
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
            ))
          ) : (
            <Text style={[font.small, { paddingVertical: space.md }]}>{`Nothing found for “${query.trim()}”. Try a word like “alarm”, “coffee”, “wake-up” or “sync”.`}</Text>
          )}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 46,
  },
  // The pill already shows where you type; no extra browser focus box in the web preview.
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10, minWidth: 0, outlineStyle: 'solid', outlineWidth: 0 },
});
