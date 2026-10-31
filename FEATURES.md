# eepy — feature list

A sleep coach for Android that turns the data your **CMF Watch 3 Pro** already collects into answers:
*how much sleep do I need, how far behind am I, should I nap, when should I go to bed, and what is helping or hurting my sleep?*

**Legend**

| Mark | Meaning |
| --- | --- |
| ✅ | Built and covered by automated tests or verified in the UI |
| 🧪 | Built, but needs checking on a real phone with a real CMF Watch (Health Connect specifics) |
| 🗺️ | Planned — designed but not built yet |
| ℹ️ | Not possible / a known limit |

---

## 1. Connecting the CMF Watch 3 Pro

The CMF Watch 3 Pro has no public SDK. It pairs over Bluetooth with Nothing's **Nothing X** app, which shares data with **Google Health Connect**. eepy reads Health Connect, so no second Bluetooth pairing (which would fight the official app) is needed.

| | Feature |
| --- | --- |
| 🧪 | **Health Connect integration** — reads sleep sessions *with stages* (awake, light, deep, REM, out-of-bed, awake-in-bed), heart rate, resting heart rate, HRV (RMSSD), blood oxygen (SpO₂), respiratory rate and steps |
| ✅ | Step-by-step **Connect screen**: checks Health Connect is installed/up to date (links to the Play Store), confirms Nothing X is actually sharing (ticks itself off once Nothing X sleep appears, otherwise lists which apps *are* writing sleep), requests permissions, runs the first import, with live status per step |
| 🧪 | **History import**: 30 / 60 / 90 / 180 days on first sync (requests `READ_HEALTH_DATA_HISTORY` so data older than 30 days is readable) |
| 🧪 | **Auto-sync** on app open and whenever the app returns to the foreground (throttled to every 15 min), plus pull-to-refresh and a manual "Sync now" / "Full re-sync" |
| ✅ | **Paged reads** of every record type, so months of minute-level heart rate don't time out |
| ✅ | **On-device condensing**: raw heart-rate / SpO₂ samples are reduced to per-night summaries (min/avg HR, 10-minute HR curve, HR nadir timing, HRV, SpO₂ avg/min/dips, breathing rate) and then discarded — the local database stays small |
| ✅ | **Source selection**: lists every app writing sleep to Health Connect (Nothing X, phone trackers, Google Fit, Samsung, Fitbit…), auto-picks the watch, lets you choose which to trust |
| ✅ | **Duplicate handling**: when two apps recorded the same night, keeps the preferred / staged / manual one |
| ✅ | **Fragment merging**: a night split by a short awakening (e.g. bathroom trip) becomes one sleep period |
| ✅ | **Nap detection**: short daytime sessions are classified as naps (and Health Connect sessions titled "nap") |
| ✅ | **Missing-night resilience**: if last night hasn't synced yet, eepy says so and assumes a typical night instead of thinking you've been awake for 30 hours |
| ✅ | **Write-back**: manually logged sleep/naps can be saved to Health Connect so other apps see them |
| 🧪 | **Background sync** (Android WorkManager via expo-background-task, ~every 30 min while eepy is closed) with Health Connect's background-read permission; never overwrites stored nights with a failed read |
| 🗺️ | Incremental sync with Health Connect's Changes API (change tokens) instead of re-reading a window |
| 🗺️ | **Gadgetbridge import** (open-source, has experimental CMF Watch 3 Pro support): import its database export for people who don't want the official app |
| 🗺️ | Generic CSV import (start, end, stage) for other trackers |
| 🗺️ | iOS version reading Apple Health (Nothing X syncs there on iPhone); the integration layer is already platform-agnostic |

## 2. "How much sleep do I need?"

| | Feature |
| --- | --- |
| ✅ | **Age-based starting point** from the National Sleep Foundation / AASM recommendations (e.g. 18–25: 7–9 h, 26–64: 7–9 h, 65+: 7–8 h) |
| ✅ | **Learns your personal need** from *unrestricted nights* — mornings you woke without an alarm (you tap "woke naturally" in the Journal; free days that end well after your usual alarm count automatically) |
| ✅ | **Rebound correction**: after a week of short nights you sleep longer than you need, so part of the sleep debt you carried into each unrestricted night is subtracted |
| ✅ | **Energy dose–response**: if you rate daytime energy, a broken-stick regression finds the sleep duration beyond which more sleep stops making you feel better (bootstrapped for uncertainty) |
| ✅ | **Bayesian combination** of all evidence (precision-weighted), solved self-consistently with the debt model (bisection — no oscillation) |
| ✅ | Shows the estimate, a likely range, confidence (low/medium/high), each evidence source with its weight, and how many more natural nights would sharpen it |
| ✅ | **Manual override** if you already know your number |
| ✅ | Converts *sleep* need into *time in bed* using your own sleep efficiency and time-to-fall-asleep |

## 3. Sleep debt

| | Feature |
| --- | --- |
| ✅ | **14-night rolling debt**, recent nights weighted more (1.0 for last night down to 0.35 two weeks ago); naps count |
| ✅ | **Honest about gaps**: nights with no data are skipped, not counted as zero sleep; coverage is reported |
| ✅ | Surplus sleep repays debt, capped at 2 h per night (you can't "bank" unlimited sleep) |
| ✅ | Categories: none / low / moderate / high / severe, plus the change over the past week |
| ✅ | **Payback planner**: simulates future nights to find the smallest nightly extra (20–90 min) that clears the debt within a week, and builds it into tonight's bedtime |
| ✅ | Debt trend chart |

## 4. "Do I need a nap?" — the nap coach

| | Feature |
| --- | --- |
| ✅ | **Nap need score (0–100)** from: sleep debt, last night's shortfall vs. your need, predicted energy now and at the afternoon dip, your current sleepiness (Karolinska Sleepiness Scale check-in), hours awake, anything demanding later (night shift, long drive, late night), naps already taken |
| ✅ | **Verdict**: nap now / nap later (with the time) / optional / skip — with plain-language reasons |
| ✅ | **Timing**: targets your personal circadian afternoon dip, never too soon after waking, and finishes early enough not to wreck bedtime |
| ✅ | **Nap types**, each simulated: *power nap* (10–20 min of light sleep), *coffee nap* (caffeine right before a 20-min nap, only if before your caffeine cut-off), *full-cycle recovery nap* (one personal sleep cycle, only with big debt and enough time before bed), *pre-emptive nap* before a night shift or long drive |
| ✅ | For every option: **predicted energy gain** over the following 3 h and **predicted bedtime delay** tonight (two-process model, measured against your normal bedtime sleep pressure — so a sleep-deprived person isn't wrongly told a nap will ruin the night) |
| ✅ | **Nap timer with a real alarm** (Android alarm-clock scheduling, so it fires on time even in battery-saving Doze), live countdown, one-tap "I'm up — log nap" |
| ✅ | Warns about the 30–60 min "sleep inertia" zone; drowsy-driving advice |
| ✅ | **Insomnia mode** (CBT-I): discourages naps to build sleep pressure for the night |
| 🗺️ | Detect an in-progress nap from the watch and nudge you if it runs into deep sleep |

## 5. Energy & body-clock forecast

| | Feature |
| --- | --- |
| ✅ | **Hour-by-hour energy curve** for today from a three-process model of alertness (sleep pressure + circadian rhythm with post-lunch dip + sleep inertia) driven by your actual recorded sleep, plus a chronic-debt penalty |
| ✅ | Calibrated to the classic sleepiness profile: groggy on waking, late-morning peak, early-afternoon dip, evening "second wind", steep pre-bed decline |
| ✅ | Highlights **peak focus windows**, the **afternoon dip**, a planned nap, and sleep periods; "now" marker with current energy |
| ✅ | **Body-clock estimates**: dim-light melatonin onset (~2 h before habitual sleep), the evening wake-maintenance zone ("forbidden zone" for sleep), core-body-temperature minimum |

## 6. Every night, analysed

| | Feature |
| --- | --- |
| ✅ | **Sleep score (0–100)** with a transparent breakdown: duration vs. *your* need, efficiency, time to fall asleep, deep sleep (age-adjusted target), REM, restfulness (time awake, wake-ups), timing vs. your usual — duration caps the total so a 5-hour night can't score well |
| ✅ | **Hypnogram** (stage-by-stage timeline) and stage totals/percentages |
| ✅ | **Sleep-cycle detection** from REM periods: count, length of each cycle, deep/REM per cycle; your personal average cycle length feeds the planners |
| ✅ | Latency, WASO (wake after sleep onset), number of awakenings, efficiency, mid-sleep |
| ✅ | **Overnight physiology**: heart-rate curve, lowest HR and when it happened (late nadir flagged — often late meals/alcohol), HRV, SpO₂ average/minimum/dips per hour, breathing rate |
| ✅ | Context: the evening's journal tags, your rating, natural vs. alarm wake-up, data source/device |

## 7. Planning

| | Feature |
| --- | --- |
| ✅ | **Tonight's plan**: wind-down start, lights-out, wake time (workday vs. free day), with the reasoning (need ÷ efficiency + latency + debt payback) |
| ✅ | **Gradual-shift guard**: if the ideal bedtime is far earlier than your body clock allows (inside the wake-maintenance zone), it caps tonight and steps earlier 15–30 min per night |
| ✅ | Free-day wake-up capped at +1 h by default to limit social jet lag (or set your own) |
| ✅ | **Cycle-aware smart alarm**: picks the last predicted cycle boundary in the 30 minutes before your wake target, using your own cycle length and latency; optional alarm notification |
| ✅ | **Bedtime calculator**: "I need to wake at…", "I'll go to bed at…", "If I sleep now…" — options on whole cycles, best fit for your need highlighted |
| ✅ | **Schedule shifter**: move your wake time permanently, ≤20 min/day earlier or ≤30 min/day later, with daily light-seek / light-avoid windows |
| ✅ | **Jet-lag planner**: time-zone offsets, optional 1–3 pre-flight days, advance vs. delay strategy (delays the long way round for >9 h eastward jumps), day-by-day sleep times and bright-light seek/avoid windows timed to your shifting body-temperature minimum |
| ✅ | **Daily timeline** on the Today screen: wake, morning light, focus windows, dip, nap, caffeine cut-off, last hard workout, last big meal, wind-down, lights-out, alarm |
| ✅ | **Calendar-aware plan**: tomorrow's first event (chosen calendars, declined invites skipped) moves the wake-up and bedtime earlier when needed, with your own prep time; late events tonight are flagged |
| 🗺️ | Rotating shift-work planner |

## 8. Caffeine

| | Feature |
| --- | --- |
| ✅ | One-tap logging with presets (espresso, coffee sizes, cold brew, teas, matcha, cola, energy drinks, pre-workout, dark chocolate), at any time of day |
| ✅ | **Pharmacokinetic model** (absorption + elimination) with your half-life: fast ≈3 h, typical ≈5 h, slow ≈7 h |
| ✅ | **Personal cut-off time**: latest moment a standard coffee keeps caffeine in the first 3 hours of sleep under your limit (default 50 mg, adjustable) |
| ✅ | Live "mg in your system" and a curve through bedtime; warning if you're already over |
| ✅ | Insight: what caffeine left at bedtime does to *your* sleep latency / deep sleep |
| ✅ | **Fix forgotten drinks**: tap any logged drink (Journal, Today's caffeine card, the check-in toast's *Change*) to move its time, day or amount; log with "30 min / 1 h / 2 h ago" or an exact time |
| ✅ | **Learns your usual morning drink** (first drink of the day over the last 3 weeks) — one tap logs it *at its usual time* from the check-in sheet or a Today card |
| 🧪 | **"Had your usual coffee?"** notification an hour after your usual time if nothing is logged: *Yes* logs it at the usual time without opening the app, *Not today* stops asking |

## 9. Chronotype & regularity

| | Feature |
| --- | --- |
| ✅ | **Chronotype from your data** (Munich ChronoType Questionnaire method): mid-sleep on free days corrected for oversleep (MSFsc) → early bird … night owl |
| ✅ | **Social jet lag**: shift between workday and free-day sleep |
| ✅ | **Chronotype quiz** (reduced Morningness–Eveningness Questionnaire) for when there's no data yet |
| ✅ | **Sleep Regularity Index** (0–100), bedtime / wake-time spread, consistency score, and a sleep-timing chart |

## 10. Recovery & physiology

| | Feature |
| --- | --- |
| ✅ | **Readiness score** each morning from last night's score, sleep debt, HRV vs. your 30-day baseline (ln RMSSD z-score), resting/sleeping heart rate vs. baseline, and schedule consistency — with an explanation per factor |
| ✅ | HRV trend with your normal band; sleeping-heart-rate trend |
| ✅ | Flags frequent overnight SpO₂ dips (when the watch samples densely enough) and points to the apnoea screen |
| ✅ | **Recovery early warning**: sleeping HR up, HRV down and/or breathing faster than your 30-day baseline on 2 of the last 3 nights (gentle, non-diagnostic) |

## 11. Journal & insights

| | Feature |
| --- | --- |
| ✅ | Morning check-in: sleep rating (1–5), woke naturally or by alarm |
| ✅ | Daytime energy (1–5), Karolinska sleepiness (1–9), notes |
| ✅ | 20 evening tags: alcohol, late caffeine, late meal, exercise, late workout, screens in bed, stress, reading, meditation, warm shower, morning sunlight, nap, melatonin, cannabis, nicotine, sick, travel, warm bedroom, noise, shared bed |
| ✅ | Manual sleep / nap logging (bed time, wake time, time to fall asleep, rating) |
| ✅ | **Personal insights** with statistics (Welch's t-test, effect size, "early / moderate / strong signal"): e.g. *"After drinking alcohol, your sleeping heart rate is 6 bpm higher (11 vs 52 nights)"* — for every tag across score, total sleep, deep %, REM %, latency, time awake, HRV and heart rate |
| ✅ | Best-bedtime window (the 30-minute window where your scores are highest), off-schedule penalty, active vs. quiet days (steps), caffeine at bedtime, social jet lag, late heart-rate nadir, chronic short sleep |
| ✅ | Prioritised **coaching tips** (debt payback, regularity, weekend lie-ins, long latency, low efficiency, caffeine, deep/REM, night-owl strategy, CBT-I, see a doctor) |

## 12. Self-checks (screening, not diagnosis)

| | Feature |
| --- | --- |
| ✅ | Daytime sleepiness (adapted Epworth Sleepiness Scale) |
| ✅ | Insomnia check (adapted Insomnia Severity Index) → suggests CBT-I / insomnia mode |
| ✅ | Sleep-apnoea risk (adapted STOP-Bang, including the high-risk rule) |
| ✅ | Results feed the coaching tips (e.g. "talk to a doctor") |

## 13. Reminders & alarms

| | Feature |
| --- | --- |
| ✅ | Wind-down reminder, bedtime, caffeine cut-off, morning check-in — re-planned automatically from the latest analysis |
| ✅ | Cycle-timed wake alarm and nap alarm on a high-priority "alarms" channel using exact alarm-clock delivery |
| ✅ | This morning's alarm is held until it has rung — re-planning after 4 am (when "tonight" becomes tomorrow) can no longer move it to the next day |

## 14. Privacy & your data

| | Feature |
| --- | --- |
| ✅ | **Everything stays on the phone** — no account, no server, no analytics |
| ✅ | JSON **backup / restore** (share sheet / file picker) |
| ✅ | Erase everything (Health Connect data untouched) |
| ✅ | **Demo mode** with nine weeks of realistic simulated nights to explore every feature before connecting the watch |

## 15. App & build

| | Feature |
| --- | --- |
| ✅ | Android APK built by GitHub Actions on every push (typecheck + tests first), attached to a GitHub Release for easy download on the phone |
| ✅ | Expo SDK 58 / React Native 0.88, TypeScript, new architecture, arm64 |
| ✅ | 70+ unit tests over the sleep engine and the Health Connect mapping |
| ✅ | Dark, night-friendly UI; works offline |
| ⏭️ | Home-screen widget — dropped at your request |
| 🧪 | **Wind-down routine**: generated white / pink / brown / rain loops with a fading sleep timer (keeps playing with the screen off), box and 4-7-8 breathing with haptics, live room-brightness check, checklist and countdown |
| 🗺️ | Smart-light integration (dim Hue/Matter lights at wind-down, wake-up light ramp before the alarm) |
| ✅ | **6-week CBT-I programme**: safety screen, sleep-restriction window from your own nights, weekly titration by sleep efficiency, lessons and stimulus-control rules; tonight's plan follows the window |
| 🗺️ | Menstrual-cycle-aware insights (via Health Connect cycle data) |
| 🧪 | **PDF report** (14/30/90 days, with charts) and **CSV export** of every night, via the share sheet |
| 🗺️ | Localisation, accessibility pass, light theme |

## 16. New in 0.2 — dynamic and learning

| | Feature |
| --- | --- |
| ✅ | **Learns your body clock**: 2–3 daily "how alert are you?" pings (😀/😐/🥱 buttons, work without opening the app) plus quick check-ins; a regularised fit of your circadian timing, rhythm strength, afternoon dip and personal rating bias. It's only applied when it predicts held-out check-ins better than the average-person model; "forecast accuracy" is shown honestly. Tapers to 1 ping/day once well calibrated |
| ✅ | **"Your body clock" screen**: your curve vs the average person with your ratings plotted, plain-language findings (peak times, dip timing/strength, early/late clock), check-in coverage, sleep-need learning progress |
| ✅ | **Free-day "Did you wake up on your own?" prompt** → feeds the sleep-need estimate faster |
| ✅ | **Experiments**: 12 templates ranked by your own insights; adherence inferred from data (caffeine log, tags, wake times, naps, workouts) or a daily Yes/No; before/after comparison against your previous 28 nights with statistics |
| ✅ | **Goals & streaks** (pick up to 3) and a **weekly review** every Sunday with a focus for next week |
| 🧪 | **Morning report** notification as soon as last night syncs; **missing-night nudge** to open Nothing X; **adaptive reminders** (nap nudge when needed, caffeine last call only if you had caffeine, bedtime shifts after a long nap, max 5/day) |
| 🧪 | **Pinned wind-down and nap cards** in the notification shade (I'm up / Cancel from the lock screen); gentle generated wake chime for the cycle-timed alarm |
| ✅ | **"What if?" simulator**: drag tonight's bedtime/alarm, add a nap or coffee, and watch tomorrow's energy, debt, sleep and expected score redraw live |
| ✅ | **Today changes through the day** (morning report & check-in → energy now → countdown & wind-down → dimmed "go to sleep" view), live countdowns, sleep-pressure gauge |
| ✅ | **Touchable charts** (drag to read values, haptic ticks; tap a night on Trends), animations, floating quick check-in (sleepiness, energy, coffee, tags) |
| ✅ | **Workout-timing insights** from Health Connect exercise sessions (if Nothing X writes them) |
| ✅ | **Coach tab** hub for all of the above |
| 🧪 | **Full-screen alarm** for naps and the cycle-timed wake-up: rings over the lock screen at alarm volume with Snooze (9 min) / I'm up, survives reboots, falls back to a ringing heads-up when the phone is in use (Android 14+ asks you to allow full-screen alarms) |

## 17. New in 0.3 — coffee times and the watch on your wrist

| | Feature |
| --- | --- |
| ✅ | **Drink editor**: change the time, day or amount of any logged drink; shows what it leaves in your system at lights-out |
| ✅ | **Usual-coffee learning** + one-tap "log my usual" and the 🧪 *Had your usual coffee?* nudge (see §8) |
| 🧪 | **Watch-first alarms** (Settings → CMF Watch): nap and/or morning alarms buzz the CMF Watch silently three times through Nothing X's notification mirroring; the phone alarm rings 3/5/10 min later only if you haven't tapped *I'm up* |
| 🧪 | **Test buzz** and step-by-step Nothing X notification setup; sleep sounds are controllable from the watch's music controls |
| ℹ️ | The CMF Watch 3 Pro has no third-party apps, watch faces or SDK, so eepy can't put a screen or tile on the watch — notifications, music controls and Health Connect are the three ways in |

## 18. App updates

eepy updates itself from the GitHub releases CI publishes (`build-<N>` prereleases with one APK each). Not Expo/EAS Update: every build is a full APK, so native changes ship too.

| | Feature |
| --- | --- |
| ✅ | **Knows its build**: CI writes the run number into the APK as `android.versionCode`; Settings shows "eepy 0.3.0 · build 15". Development and web builds say so and never prompt |
| ✅ | **Checks GitHub** when eepy opens and after each background sync — at most every 6 h, switchable off — and with **Check now**. Picks the highest `build-N` that has an APK (prereleases included, drafts skipped) |
| ✅ | **One notification per new build** ("eepy build 15 is ready — tap to update", with the first changelog line) on the Sleep reports channel; tapping it opens App updates. While eepy is open, an **Update available** card on Today and Settings says it instead |
| ✅ | **Changelog** from the release notes (CI lists the commit subjects since the previous build) |
| 🧪 | **Update to build N**: downloads the APK with a progress bar and opens Android's installer. The first time, Android asks to allow eepy to *install unknown apps* — tap Settings, turn on **Allow from this source**, go back, tap Install. Your data stays: the new build installs over the old one (same signing key, higher versionCode) |
| 🧪 | **Sign in for updates** (the repository is private): **Sign in with GitHub** (device flow of the eepy GitHub App: copy the 8-character code, enter it at github.com/login/device, authorize) or paste a **fine-grained token** (pre-filled link: Contents read-only; pick *Only select repositories → eepy-app*). The token is kept in Android's encrypted storage (expo-secure-store), excluded from backups, and only sent to api.github.com |
| ✅ | Sign-in problems (revoked token, private repo while signed out, a token that can't see eepy-app) never notify; Settings explains them with **Sign in again** |

**Create the GitHub App (repo owner, once)** — until this is done, eepy offers only the token option:

1. github.com → Settings → Developer settings → GitHub Apps → **New GitHub App**.
2. Name: e.g. *eepy updates*; Homepage URL: `https://github.com/j0vanni/eepy-app`. No callback URL; turn **Webhook → Active** off.
3. Tick **Enable Device Flow**. Leave **Expire user authorization tokens** *unticked* (eepy has no client secret to refresh them).
4. Permissions → Repository → **Contents: Read-only** (Metadata: Read-only is added automatically). Nothing else.
5. *Where can this GitHub App be installed?* → **Only on this account**. Create it.
6. **Install App** → your account → **Only select repositories → eepy-app**.
7. Copy the **Client ID** (starts with `Iv`, not the App ID) into `app.json` → `expo.extra.githubClientId`, commit, and let CI build. The client ID is public; no secret is needed.

To revoke later: github.com/settings/applications → *Authorized GitHub Apps* (sign-in) or github.com/settings/personal-access-tokens (tokens).

---

## 19. New in 0.4 — everyday polish

| | Feature |
| --- | --- |
| ✅ | **12-hour clock** everywhere (times, charts, notifications, quiz answers, experiment rules): Settings → You → *Time format* — follow the phone (default), 12-hour or 24-hour |
| ✅ | **Instant coffee** (62 mg) and **decaf** (3 mg) presets |
| ✅ | **Your own drinks**: name + amount (e.g. "Instant, 2 tsp · 105 mg") saved from the drink editor, shown first everywhere, removable in Settings |
| ✅ | **The check-in shows what you actually drink** — your most-logged drinks of the last 30 days first, common ones after; *More…* shows everything |
| ✅ | **Skip tomorrow's alarm** in one tap (evening countdown or Plan → Smart alarm), with Undo; only that morning is skipped, and it counts as a free morning for sleep-need learning |
| ✅ | The evening countdown and Plan show the **alarm that will actually ring** (this morning's held alarm, or watch buzz + phone backup times) |

---

## 20. New in 0.5 — real-life nights and phone light

| | Feature |
| --- | --- |
| ✅ | **Adjust tonight**: can't make the planned lights-out? Pick your own (Plan / +30 min / +1 h / +1½ h / +2 h / fine-tune) and, if you can, a later wake-up. A live preview shows expected sleep, the re-timed cycle-aligned alarm, tomorrow's energy, focus time and debt vs the plan, plus recovery tips (nap time tomorrow, coffee, sleeping in). Only that night changes |
| ✅ | Everything follows an adjusted night: wind-down and lights-out reminders, the live wind-down card, the alarm, the caffeine cut-off, the energy forecast and Today's phases. Reach it from Today's countdown, the Tonight card, Plan, the late-night view ("Still up? Re-plan") and a 🧪 **Running late** button on the wind-down / lights-out notifications |
| ✅ | **Phone light**: a personal screen-light schedule from your plan — evening (~3 h before lights-out, when melatonin rises): Night Light on, brightness ≤ 40%; wind-down: warmest + Extra dim, ≤ 15%; night: screen away; morning: bright is fine but get daylight. Shown on Today in the evening, in the wind-down routine and on Plan, with the Night Light custom schedule to set |
| 🧪 | Live **brightness check** against the target (reads the phone's brightness, no permission needed) and shortcuts to Android's **Night Light** and **Extra dim** settings; **Dim eepy now** |
| 🧪 | **Phone-light reminder** when the evening limits start (button opens Night Light settings) |
| 🧪 | **eepy dims and warms itself** in the evening (warm tint; its own window dimmed from wind-down) — Settings → Wind-down |
| ℹ️ | Android doesn't let apps switch Night Light or change system brightness without a special permission, so eepy guides and links rather than changing them |

## 21. New in 0.6 — calendar, recovery plan, wind-down timeline

| | Feature |
| --- | --- |
| ✅ | **Calendar** (Today's header, Plan, Coach): month grid where each day shows the night that ended that morning — sleep vs your need (purple met / amber short) and duration — and coming mornings with their planned wake-up; month stats (average sleep and score, nights that met your need, usual sleep and wake times) |
| ✅ | **Plan single mornings**: tap a coming day → usual wake-up, a set time ("up by 6:00 AM" for work, a flight…) or a free day with no alarm. eepy shows the optimal night before: wind-down, lights-out, cycle-timed alarm, expected sleep and any extra for sleep debt. Tonight's plan, reminders and alarm follow the calendar |
| ✅ | **Eases into early mornings**: nights before an early start move earlier by at most 45 min a night (the body clock can't jump), which can pull tonight's lights-out earlier too; nights that can't move earlier than your body clock allows are flagged as short, with a nap tip |
| ✅ | **Recovery autopilot**: sleep debt is paid back a little each night (at most +30 min) instead of one long lie-in, with wake-ups kept steady; a "Getting back on track" card shows the coming nights and when debt drops under an hour |
| ✅ | **Wind-down timeline**: evening light, last big meal, hard exercise done, wind-down, **screens off** (30/45/60 min before lights-out, default 45 — Settings → Wind-down), screen-free routine, lights-out; on Today in the evening and in the wind-down routine, with what's happening now and a countdown to the next step; the phone-light "screen away" phase starts at screens-off |
| 🧪 | **Screens-off reminder** at that time |
| 🧪 | **Phone brightness slider** in the Phone light card: sets the phone's own brightness (after allowing "Modify system settings" once), with the current target marked, "Set to target" and auto-brightness on/off. Targets now match the position of Android's brightness slider (evening ≤ 50%, wind-down ≤ 30%, night ≤ 15%) |

## 22. New in 0.7 — shortcuts and bedtime autopilot

| | Feature |
| --- | --- |
| 🧪 | **App-icon shortcuts** (long-press the eepy icon): *Log my usual coffee*, *Start a nap*, *Running late* (Adjust tonight) and *Check in* — Android dynamic shortcuts set when eepy starts, so no setup; drag one to the home screen to pin it |
| 🧪 | **"Log coffee" Quick Settings tile**: logs your usual drink at its usual time from anywhere and collapses the shade. Settings → Shortcuts → *Add "Log coffee" to Quick Settings* (Android 13+ asks in one tap; older: edit Quick Settings and drag it in) |
| ✅ | **One-tap sheet** (`eepy://quick/coffee · nap · late · checkin · sounds`): coffee is logged with the same per-day id as every other "usual" button (can't double-log; a same drink logged by hand near the usual time counts too), with **Undo**, **Change time** and *Log another now*; no usual drink yet → the drink editor. Nap offers the recommended nap with its alarm time (**Start nap**) or opens the Nap coach |
| 🧪 | **Bedtime autopilot**: eepy owns an Android mode, **"eepy sleep"**, and switches it on at lights-out (or the start of wind-down — your choice) and off when your morning alarm starts (the first watch buzz in watch-first mode; the planned wake-up when the alarm is off or skipped). Follows "Adjust tonight". Exact alarms switch it **while eepy is closed** and survive reboots |
| 🧪 | **Android 15+**: the phone's own sleep mode — grayscale, dimmed wallpaper, dark theme, no always-on display, notifications silenced; it appears with your phone's modes, where you choose who may still call. **Android 10–14**: a Do Not Disturb rule that only silences notifications. Alarms (eepy's included) and media (sleep sounds) always get through |
| 🧪 | **Stop now** keeps it off for the rest of that night (also when you switch the mode off yourself); **Start now** from 3 h before. Status and controls in Settings → Bedtime autopilot and on Today's evening countdown |
| 🧪 | Optional **"Sleep mode on 🌙 — play sleep sounds?"** notification when it switches on; *Play sounds* starts your default sound with its timer |
| ℹ️ | **Allow once**: Settings → Bedtime autopilot → *Allow access* opens Android's "Do Not Disturb access" (on Android 15+ "Modes" access) list — turn eepy on. Every mode call needs it; without it eepy shows the status and nothing is switched |
| ℹ️ | Android reserves the "Bedtime" mode type for the system's Digital Wellbeing app, so "eepy sleep" is a time-based mode (eepy tries Bedtime first and falls back) |

## 23. New in 0.7 — accurate wake-up and sleep

| | Feature |
| --- | --- |
| ✅ | **The night ends when you got up**, even if the watch or the phone's sleep mode kept "sleeping": eepy cuts the recording at the first sign you were up (opened eepy, "I'm up" on the alarm, a check-in, or ≥ 100 steps within 20 min), unless the watch shows ≥ 5 min of deep/REM sleep after it (you checked the phone and went back to sleep). It never cuts before the last deep/REM sleep, never changes naps or manual logs, and only acts on ≥ 10 min |
| ✅ | **Falling asleep**: using eepy or walking around after the recorded start moves sleep onset later (never past the first deep/REM sleep); the in-bed time before stays as time awake in bed, so latency and efficiency are right |
| ✅ | **Woke up vs. got up**: the last sleep is the wake-up used for sleep metrics; getting up ends the time in bed used for efficiency |
| ✅ | **Wake-ups during the night** with start, end and length, and whether you got up (≥ 20 steps) or used eepy, or just lay awake; eepy use in the middle of the night counts as awake |
| ✅ | Every model uses the corrected night: total sleep, wake time, score, sleep need, debt, chronotype, regularity, insights, the energy forecast, learning and exports |
| ✅ | **Night screen — "Your night, step by step"**: in bed → fell asleep (time to fall asleep, last eepy use) → wake-ups → woke up → out of bed, each with its source and a high/medium/low confidence, plus in-bed vs. asleep time |
| ✅ | **Check and correct**: "Your watch recorded sleep until 9:12 AM — you were up at 7:40 AM (opened eepy, 230 steps)" with **Looks right / Change** on Today's morning card (wake-up) and the night screen (fell asleep, woke up, got up). Your times always win. When nothing was detected but you "slept" ≥ 90 min past your usual wake-up for that kind of day, eepy asks "Were you really asleep until …?" |
| ✅ | Evidence: eepy remembers when it was on screen in the evening, at night and in the morning (60 days), "I'm up" taps on the watch alarm, check-ins and journal ratings, plus a per-night **step curve** from Health Connect (10-min bins, to 30 min after the night). Heart rate and caffeine logs only add confidence |
| ✅ | Settings → Data sources → **Detect when I'm actually up** (on by default) |
| ℹ️ | Step records longer than 30 min (e.g. hourly totals) can't time anything and are ignored; heart-rate / SpO₂ summaries are still computed over the recorded window at sync time |

## 24. New in 0.7 — night story and breathing check

| | Feature |
| --- | --- |
| ✅ | **Night story** at the top of every night: a plain-English account built from the data eepy already has — *"Asleep in 12 min — quicker than usual. Deep sleep came early (1h 20m, your normal). You were awake 3:10–3:24 AM and your heart rate rose then. REM was short (14% vs your usual 21%). Likely factors: drinking alcohol and ~60 mg of caffeine still active at lights-out."* Numbers are bold (coloured by good/bad), causes are tappable (they open that evening's journal) |
| ✅ | Compared with **your own usual** (median of up to 30 recent nights): time to fall asleep, total sleep, deep sleep (and whether it came early or late), awakenings with times (and whether heart rate rose then, from the 10-minute HR curve), REM share, lowest heart rate and when, HRV, oxygen dips, bedtime |
| ✅ | **Likely factors only when they plausibly apply**: a journal tag, caffeine still active at lights-out (personal half-life), a late watch workout, a nap or an unusual bedtime is named only if an effect it's known to have showed up that night (e.g. alcohol → less REM, more time awake, higher / late-settling heart rate). Where the insights engine has measured *your* effect, it says so (*"On nights after drinking alcohol, your REM sleep is usually 5 percentage points lower"*). Logged but no visible effect → "also logged", never blamed; helpful habits are never blamed; at most three likely factors |
| ✅ | One-line version on Today's last-night card and as the first line of the 🧪 morning-report notification (*"Restless (20m awake) and REM short (14% vs 21%) — likely drinking alcohol."*) |
| ✅ | **Breathing check (SpO₂ dips)**: per night, dips of ≥ 3% and ≥ 4% below a local 15-minute baseline per hour of covered sleep (an ODI-like count), lowest reading, time below 90%, readings per hour, coverage and a confidence level; single-reading glitches and readings while awake are ignored |
| ✅ | Conservative verdicts — *looks normal* (< 5 dips/h), *some dips* (≥ 5/h), *frequent dips* (≥ 15/h of 3%, ≥ 10/h of 4%, or ≥ 10% of the night below 90%) — and only the 30-night median over ≥ 5 dense nights can say *"frequent dips — worth mentioning to a doctor"*. Too few readings (< 1 every 5 min) → "too few readings to judge", never a guess. Always with the disclaimer that a wrist sensor is not a diagnostic test |
| ✅ | Breathing card on the night screen (with a lowest-SpO₂-per-5-minutes chart) and a 30-night trend card in Trends → Recovery, both linking to the STOP-Bang check; persistent dips show up in the weekly review and as an insight. Demo data includes plausible SpO₂ (a reading every ~2 min, more dips after alcohol) |
| 🧪 | Health Connect stores one OxygenSaturation record per reading; eepy keeps one app's readings per night (the watch's), summarises them at sync time and stores only the summary plus a compact 5-minute curve for the last ~30 nights. How often Nothing X writes SpO₂ overnight is still to be confirmed on a real CMF Watch 3 Pro — nights synced before this feature need a full re-sync |

---

---

## Science behind it

* Borbély (1982); Daan, Beersma & Borbély (1984) — two-process model of sleep regulation
* Åkerstedt & Folkard (1997) — three-process model of alertness; Åkerstedt & Gillberg (1990) — Karolinska Sleepiness Scale
* Hirshkowitz et al. (2015), National Sleep Foundation; Watson et al. (2015), AASM/SRS — sleep-duration recommendations
* Van Dongen et al. (2003) — cumulative cost of chronic sleep restriction
* Roenneberg, Wirz-Justice & Merrow (2003) — Munich ChronoType Questionnaire; Wittmann et al. (2006) — social jet lag
* Phillips et al. (2017) — Sleep Regularity Index
* Lavie (1986) — sleep "gates" and the evening forbidden zone
* Brooks & Lack (2006) — optimal nap duration; Hayashi, Masuda & Hori (2003) — caffeine + short nap
* Drake et al. (2013) — caffeine 0, 3 or 6 hours before bed
* Khalsa et al. (2003) — human phase-response curve to light; Eastman & Burgess (2009) — avoiding jet lag
* Adan & Almirall (1991) — reduced MEQ; Johns (1991) — ESS; Morin (1993) — ISI; Chung et al. (2008) — STOP-Bang
* Plews et al. (2013) — day-to-day HRV interpretation with ln RMSSD

eepy is a wellness tool, not a medical device. Wrist-based sleep staging is an estimate.
