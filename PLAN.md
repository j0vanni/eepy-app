# eepy — plan: more dynamic, more features

"More dynamic" can mean three different things. This plan covers all three, ordered so each phase ships as its own APK:

1. **Feels alive** — the app reacts to the time of day, animates, and lets you touch and play with the numbers.
2. **Stays current without opening it** — background sync, smart notifications, home-screen widgets.
3. **Adapts to you** — it learns from quick check-ins and lets you test changes, so advice gets more personal every week.

Effort: **S** ≈ an hour or two · **M** ≈ half a day · **L** ≈ a day or more (for me to build + test).
Everything listed has a library that works with the current setup (Expo SDK 58 / RN 0.88). Items marked 🔐 need a new Android permission or prompt.

---

## Phase 1 — Feels alive (no new permissions, lowest risk)

| # | Feature | What you'd see | How | Effort |
| --- | --- | --- | --- | --- |
| 1.1 | **Time-of-day Today screen** | The home screen changes shape through the day. **Morning**: last-night report up top, one-tap check-in (rating, woke naturally), "get light now" card. **Daytime**: live energy, nap coach, caffeine meter. **Evening**: big countdown to wind-down and lights-out, wind-down checklist. **Night** (after bedtime): dimmed "go to sleep" view with "if you sleep now, wake at…" cycle times. | Phase picked from your wake time, plan and current time; existing engine output | M |
| 1.2 | **Live countdowns & meters** | "Lights out in 2h 14m", caffeine mg ticking down, the energy "now" dot moving along the curve, a sleep-pressure gauge filling up through the day | Minute ticker already exists; add a sleep-pressure readout from the two-process model | S |
| 1.3 | **Interactive charts** | Drag a finger across the energy curve, hypnogram or trend charts to read exact values at that moment (with light haptic ticks); tap a day's bar to open that night | `react-native-gesture-handler` + `expo-haptics` (both already installed) | M |
| 1.4 | **Motion** | Score rings and meters fill in, chart lines draw on, cards fade in, sync spinner while pulling | `react-native-reanimated` (already installed) | M |
| 1.5 | **"What if?" simulator** ⭐ | Sliders for tonight's bedtime and wake, a nap (time + length) and a coffee (time + mg). Tomorrow's energy curve, tomorrow's debt, caffeine at bedtime and the expected sleep score redraw instantly as you drag | Engine already models all of this; add a "tomorrow" forecast and debounce the sliders | L |
| 1.6 | **Quick check-in sheet** | A floating button on every tab: "I'm sleepy / energy / log coffee / add tag" in one tap, no navigation | Bottom sheet + existing store actions | S |

**Why first:** biggest "feels dynamic" change, uses only JavaScript (no native risk), nothing new to grant.

## Phase 2 — Stays current without opening the app

| # | Feature | What you'd see | How | Effort |
| --- | --- | --- | --- | --- |
| 2.1 | **Background sync** 🔐 | New nights and vitals arrive on their own, even if you don't open eepy | `expo-background-task` (Android WorkManager, runs roughly every 15–60 min when Android allows) + Health Connect's *read in background* permission | M |
| 2.2 | **Morning report notification** | As soon as last night lands: "7h 12m · score 82 · debt 2h ▼ · nap window 14:10" | Runs the engine after a background sync | S |
| 2.3 | **Adaptive reminders** | Reminders that react to your day: a nap nudge only when nap need is high, bedtime reminder moves if you napped or had late caffeine, "last night is missing — open Nothing X" at 10:00 if nothing synced | Re-plans notifications after each sync / journal change | S |
| 2.4 | **Home-screen widgets** | *Small*: sleep debt + lights-out time. *Medium*: today's energy curve with "now", nap verdict, caffeine cut-off. Refreshes in the background | `react-native-android-widget` (Expo config plugin, Android-only) | L |
| 2.5 | **Wind-down & nap live notifications** | A pinned notification counting down to lights-out with a checklist (dim lights, screens away, …); during a nap, a pinned timer you can stop from the lock screen | Ongoing notifications via `expo-notifications` | M |
| 2.6 | **Full-screen alarm** 🔐 | Nap/wake alarm that takes over the lock screen with Snooze / I'm up, then "how did you sleep?" | Needs a small native config plugin (full-screen intent) — highest risk item in this phase | L |

## Phase 3 — Adapts to you

| # | Feature | What you'd see | How | Effort |
| --- | --- | --- | --- | --- |
| 3.1 | **Energy forecast that learns** | 2–3 quick "how alert are you right now?" pings a day for two weeks; eepy fits *your* body-clock timing and dip size, then shows "forecast accuracy: 84%" | Fit circadian phase/amplitude of the existing three-process model to your sleepiness ratings | M |
| 3.2 | **Faster sleep-need learning** | On free days a morning notification: "Did you wake up on your own?" — one tap feeds the need estimate | Notification actions + journal | S |
| 3.3 | **Experiments** ⭐ | "Try: no caffeine after 14:00 for 7 nights." eepy tracks whether you stuck to it and reports the before/after effect with the same statistics as the insights | Builds on the existing insight engine (t-tests, effect sizes) | M |
| 3.4 | **Goals & streaks** | Pick 1–3 goals (wake within ±30 min, debt under 2h, caffeine cut-off kept); see streaks and a gentle weekly score | New goals model + Today/Trends cards | M |
| 3.5 | **Weekly review** | Sunday notification → a review screen: best night, what improved, top insight, one suggestion for next week | Aggregates existing analysis | M |
| 3.6 | **Recovery early warning** | "Resting HR up 6 bpm, HRV down 25%, breathing faster for 2 nights — possible illness or overreaching. Take it easy." | Rules on baselines the readiness model already computes | S |
| 3.7 | **Calendar-aware plan** 🔐 | Tomorrow's first event sets the alarm and bedtime; late events that eat into sleep get flagged | `expo-calendar` (read-only) | M |

## Phase 4 — New capabilities

| # | Feature | What you'd see | How | Effort |
| --- | --- | --- | --- | --- |
| 4.1 | **Wind-down audio** | Guided breathing (box / 4-7-8) with haptic pacing; white / pink / brown noise with a sleep timer; gentle wake sound that ramps up | `expo-audio` (generated noise, no streaming) | M |
| 4.2 | **Light check** | During wind-down, how bright your room actually is ("too bright for melatonin"); log morning outdoor light | Phone ambient-light sensor via `expo-sensors` | S |
| 4.3 | **Workout timing insights** 🔐 | "Workouts after 20:00 add 14 min to your time to fall asleep" | Read Health Connect exercise sessions (Nothing X may write them) | S |
| 4.4 | **CBT-I programme** | A structured 6-week insomnia programme: sleep diary, sleep-window titration, stimulus-control coaching | New flow on top of insomnia mode | L |
| 4.5 | **Reports & export** | Monthly PDF summary to keep or show a doctor; CSV export of every night | `expo-print` + `expo-sharing` | M |
| 4.6 | **Gadgetbridge import** | For anyone using the open-source app instead of Nothing X | Read its database export | M |

---

## Recommended order

1. **Phase 1 (1.1 → 1.6)** — one APK. The app immediately feels different every time you open it, and the what-if simulator is the most "play with it" feature.
2. **2.1 + 2.2 + 2.3** — background sync and smart notifications, so it's useful before you even open it.
3. **2.4 widgets + 2.5 live notifications**.
4. **3.3 experiments, 3.1 learning forecast, 3.5 weekly review**, then the rest of Phase 3.
5. Phase 4 by interest.

## Things to decide

- **Which kind of "dynamic" matters most to you?** (feel / freshness / smarts) — the order above assumes *feel* first.
- **Notifications budget:** OK with 2–3 short sleepiness pings a day for two weeks (3.1)?
- **Widgets:** which numbers do you want on your home screen?
- **Calendar access** (3.7) — fine, or skip?

## How each phase gets verified

- Engine changes get unit tests (`npm test`), like everything in `src/engine/`.
- UI changes get checked in a browser build with demo data (screenshots) before the APK.
- Every push builds a new APK via GitHub Actions; background sync, widgets, notifications and alarms can only be truly checked on your phone, so those items will ask you for a quick test + screenshot.
