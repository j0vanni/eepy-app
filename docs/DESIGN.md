# eepy — how the app looks and how screens are built

The interface was rebuilt from scratch in 0.13. This page is the brief every screen follows.

## The idea

A bedside clock. Near-black page, warm white type, one amber signal colour, big numbers.
You open eepy to learn one thing or do one thing; the screen should give you that first and
keep the rest out of the way.

## Rules

1. **One thing per screen.** A screen opens with a `Hero`: the single number or phrase it is
   about (energy now, time to lights-out, last night's sleep). Everything under it supports it.
2. **Then what to do.** Actions come right after the hero: at most one amber (`primary`) button
   or tile per screen. Other actions are `secondary`; dismiss/undo are `ghost`.
3. **Then the details, as rows.** Supporting facts are rows in a panel (`ListCard` + `ListRow`,
   or `KeyValue`), not a stack of unrelated cards. A screen has few panels, each with a caption
   (`Section`). If a block is only sometimes relevant, show it only then.
4. **Explanations fold away.** How-it-works text, science notes and long rationale go behind a
   row that opens a detail screen or a `Fold`; never between the user and the action.
5. **Plain words.** Say what it is ("Lights out", "Sleep debt", "Energy now"). No jargon in
   titles (KSS, WASO, RMSSD, chronotype…) — a detail row may name the term once. Sentence
   case everywhere; captions are the only uppercase. Times and durations through
   `formatTime` / `formatDuration`.
6. **No decoration.** No gradients, no tinted icon circles, no borders around panels, no emoji
   as icons (emoji are fine as content: the 5 sleep-rating faces). Icons are
   MaterialCommunityIcons, drawn in `textDim` unless they carry a state colour.
7. **Colour means something.**
   - amber `accent` / `energy`: the main action, "now", energy.
   - blue `sleep` and the stage colours: sleep, nights, the plan for tonight. Never buttons.
   - `good` / `warn` / `bad`: outcomes only (a score, a debt, an alert).
   - `caffeine`: drinks.
   Everything else is `text`, `textDim`, `textFaint`.
8. **Night is darker.** After lights-out Today uses `Screen tone="night"` (true black, dimmer
   text) and shows only what matters in bed.
9. **Touch targets** are at least 44 dp (`touch.min`); primary buttons 52 dp, the one big
   action (`big`) 64 dp.

## Where things live

Four tabs:

| Tab | What it answers |
| --- | --- |
| **Today** | What is my energy / what is next / what should I do now. Changes with the time of day (morning: last night; day: energy; evening: countdown to lights-out; night: the in-bed view). |
| **Sleep** | How did I sleep: last night, every night, trends, sleep need and debt. |
| **Plan** | When to go to bed and get up: tonight, the week ahead, the usual week. |
| **More** | Every tool and setting in one list, with search. |

Stack screens opened from those: Energy (`/energy`, why the number is what it is and how eepy
learns it), Reaction test, Nap, Drink, Check-in, Wind-down, Night details, Settings pages, and
the rest of the tools.

## Building blocks (`src/ui/components.tsx`)

`Screen`, `Hero`, `Card`, `CardTitle`, `Section`, `Link`, `ListCard`, `ListRow`, `Fold`, `KeyValue`,
`Timeline`, `ActionTile`, `Button`, `Chip`, `Segmented`, `Stepper`, `AppSwitch`, `IconButton`,
`Stat`, `Pill`, `Meter`, `Ring`, `SplitBar`, `Banner`, `Note`, `Empty`, `Divider`, `Row`, `Icon`.

Tokens are in `src/ui/theme.ts` (`colors`, `night`, `space`, `radius`, `font`, `touch`,
`iconSize`). Screens use tokens only — no hex colours, no font sizes outside `font` except for a
one-off number that needs a size between `h1` and `display`.

Charts are in `src/ui/charts.tsx` (energy curve, hypnogram, stage bar, duration bars, line
chart, sleep timeline, gauge).

## Screen recipe

```tsx
<Screen title="…" subtitle="…">          // tab screens; stack screens pass only subtitle (or nothing)
  <Banner … />                           // at most one, only when something needs attention
  <Hero label="…" value="…" caption="…" />
  <Button … /> or <Row><ActionTile …/>…</Row>
  <Section title="…">
    <ListCard> <ListRow …/> … </ListCard>
  </Section>
</Screen>
```

Forms (log a drink, adjust tonight, settings): one panel per decision, the choice as `Chip`s,
`Segmented` or a `Stepper`, and one primary button at the bottom.
