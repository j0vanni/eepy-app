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
| ✅ | **Touchable charts** (drag to read values, haptic ticks; tap a night on Sleep → Trends), animations, floating quick check-in (sleepiness, energy, coffee, tags) |
| ✅ | **Workout-timing insights** from Health Connect exercise sessions (if Nothing X writes them) |
| ✅ | **Coach** hub for all of the above (now More → Coach) |
| 🧪 | **Full-screen alarm** for naps and the cycle-timed wake-up: rings over the lock screen at alarm volume with Snooze (9 min) / I'm up, survives reboots, falls back to a ringing heads-up when the phone is in use (Android 14+ asks you to allow full-screen alarms) |

## 17. New in 0.3 — coffee times and the watch on your wrist

| | Feature |
| --- | --- |
| ✅ | **Drink editor**: change the time, day or amount of any logged drink; shows what it leaves in your system at lights-out |
| ✅ | **Usual-coffee learning** + one-tap "log my usual" and the 🧪 *Had your usual coffee?* nudge (see §8) |
| 🧪 | **Watch-first alarms** (Settings → Alarms & watch): nap and/or morning alarms buzz the CMF Watch silently three times through Nothing X's notification mirroring; the phone alarm rings 3/5/10 min later only if you haven't tapped *I'm up* |
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
| ✅ | **12-hour clock** everywhere (times, charts, notifications, quiz answers, experiment rules): Settings → You & schedule → *Time format* — follow the phone (default), 12-hour or 24-hour |
| ✅ | **Instant coffee** (62 mg) and **decaf** (3 mg) presets |
| ✅ | **Your own drinks**: name + amount (e.g. "Instant, 2 tsp · 105 mg") saved from the drink editor, shown first everywhere, removable in Settings → Caffeine & drinks |
| ✅ | **The check-in shows what you actually drink** — your most-logged drinks of the last 30 days first, common ones after; *More…* shows everything |
| ✅ | **Skip tomorrow's alarm** in one tap (evening countdown or Planner → Tonight), with Undo; only that morning is skipped, and it counts as a free morning for sleep-need learning |
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
| 🧪 | **eepy dims and warms itself** in the evening (warm tint; its own window dimmed from wind-down) — Settings → Wind-down & phone light |
| ℹ️ | Android doesn't let apps switch Night Light or change system brightness without a special permission, so eepy guides and links rather than changing them |

## 21. New in 0.6 — calendar, recovery plan, wind-down timeline

| | Feature |
| --- | --- |
| ✅ | **Calendar** (Planner → Month view, Sleep → Calendar): month grid where each day shows the night that ended that morning — sleep vs your need (purple met / amber short) and duration — and coming mornings with their planned wake-up; month stats (average sleep and score, nights that met your need, usual sleep and wake times) |
| ✅ | **Plan single mornings**: tap a coming day → usual wake-up, a set time ("up by 6:00 AM" for work, a flight…) or a free day with no alarm. eepy shows the optimal night before: wind-down, lights-out, cycle-timed alarm, expected sleep and any extra for sleep debt. Tonight's plan, reminders and alarm follow the calendar |
| ✅ | **Eases into early mornings**: nights before an early start move earlier by at most 45 min a night (the body clock can't jump), which can pull tonight's lights-out earlier too; nights that can't move earlier than your body clock allows are flagged as short, with a nap tip |
| ✅ | **Recovery autopilot**: sleep debt is paid back a little each night (at most +30 min) instead of one long lie-in, with wake-ups kept steady; a "Getting back on track" card shows the coming nights and when debt drops under an hour |
| ✅ | **Wind-down timeline**: evening light, last big meal, hard exercise done, wind-down, **screens off** (30/45/60 min before lights-out, default 45 — Settings → Wind-down & phone light), screen-free routine, lights-out; on Today in the evening and in the wind-down routine, with what's happening now and a countdown to the next step; the phone-light "screen away" phase starts at screens-off |
| 🧪 | **Screens-off reminder** at that time |
| 🧪 | **Phone brightness slider** in the Phone light card: sets the phone's own brightness (after allowing "Modify system settings" once), with the current target marked, "Set to target" and auto-brightness on/off. Targets now match the position of Android's brightness slider (evening ≤ 50%, wind-down ≤ 30%, night ≤ 15%) |

## 22. New in 0.7 — shortcuts and bedtime autopilot

| | Feature |
| --- | --- |
| 🧪 | **App-icon shortcuts** (long-press the eepy icon): *Log my usual coffee*, *Start a nap*, *Running late* (Adjust tonight) and *Check in* — Android dynamic shortcuts set when eepy starts, so no setup; drag one to the home screen to pin it |
| 🧪 | **"Log coffee" Quick Settings tile**: logs your usual drink at its usual time from anywhere and collapses the shade. Settings → Notifications & shortcuts → *Add "Log coffee" to Quick Settings* (Android 13+ asks in one tap; older: edit Quick Settings and drag it in) |
| ✅ | **One-tap sheet** (`eepy://quick/coffee · nap · late · checkin · sounds`): coffee is logged with the same per-day id as every other "usual" button (can't double-log; a same drink logged by hand near the usual time counts too), with **Undo**, **Change time** and *Log another now*; no usual drink yet → the drink editor. Nap offers the recommended nap with its alarm time (**Start nap**) or opens the Nap coach |
| 🧪 | **Bedtime autopilot**: eepy owns an Android mode, **"eepy sleep"**, and switches it on at lights-out (or the start of wind-down — your choice) and off when your morning alarm starts (the first watch buzz in watch-first mode; the planned wake-up when the alarm is off or skipped). Follows "Adjust tonight". Exact alarms switch it **while eepy is closed** and survive reboots |
| 🧪 | **Android 15+**: the phone's own sleep mode — grayscale, dimmed wallpaper, dark theme, no always-on display, notifications silenced; it appears with your phone's modes, where you choose who may still call. **Android 10–14**: a Do Not Disturb rule that only silences notifications. Alarms (eepy's included) and media (sleep sounds) always get through |
| 🧪 | **Stop now** keeps it off for the rest of that night (also when you switch the mode off yourself); **Start now** from 3 h before. Status and controls in Settings → Wind-down & phone light → Bedtime autopilot and on Today's evening countdown |
| 🧪 | Optional **"Sleep mode on 🌙 — play sleep sounds?"** notification when it switches on; *Play sounds* starts your default sound with its timer |
| ℹ️ | **Allow once**: Settings → Wind-down & phone light → Bedtime autopilot → *Allow access* opens Android's "Do Not Disturb access" (on Android 15+ "Modes" access) list — turn eepy on. Every mode call needs it; without it eepy shows the status and nothing is switched |
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
| ✅ | Settings → Health Connect & data → **Detect when I'm actually up** (on by default) |
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
| ✅ | Breathing card on the night screen (with a lowest-SpO₂-per-5-minutes chart) and a 30-night trend card in Sleep → Trends → Recovery, both linking to the STOP-Bang check; persistent dips show up in the weekly review and as an insight. Demo data includes plausible SpO₂ (a reading every ~2 min, more dips after alcohol) |
| 🧪 | Health Connect stores one OxygenSaturation record per reading; eepy keeps one app's readings per night (the watch's), summarises them at sync time and stores only the summary plus a compact 5-minute curve for the last ~30 nights. How often Nothing X writes SpO₂ overnight is still to be confirmed on a real CMF Watch 3 Pro — nights synced before this feature need a full re-sync |

## 25. New in 0.8 — two-step mornings

*"Wake up at 5, do my face routine, go back to sleep until 6:05, then get ready."*

| | Feature |
| --- | --- |
| ✅ | **Setting** (off by default): routine alarm time (e.g. 5:00), routine length (e.g. 20 min) and which mornings (default: your workdays). The final wake-up stays the day's normal one (workday wake-up, e.g. 6:05); a wake-up set in the calendar keeps the same gap before it; free days and calendar days off never use it. Settings that can't work (routine alarm after the wake-up, more than 3 h before it, less than 15 min left to sleep after the routine) are explained instead |
| ✅ | **Planning**: total sleep = main block (lights-out → routine alarm) + the back-to-sleep stretch (routine done + ~10 min to fall back asleep → final wake-up). The routine and falling back asleep are time awake, so lights-out moves earlier by exactly that much (20 + 10 min → 30 min) and the two stretches together still cover your need — tonight and every coming night in the calendar / recovery plan, with a rationale line. Paused under a CBT-I sleep window; follows "Adjust tonight" |
| ✅ | **Two alarms**: a gentler **routine alarm**, cycle-timed in the 30 min before the routine time so it catches light sleep (*"Face routine time — keep the lights low, then back to bed until 6:05"*), and the **final alarm** right at the wake-up — the ~35-min second stretch is light, REM-ish sleep with no full cycle to time, so eepy doesn't pretend to predict one. Separate full-screen alarms (`eepy-wake-routine` and `eepy-wake`) or two planner alarms on builds without the native alarm; watch-first buzzes + phone backup for each; *Skip* silences both; a watch-buzz "I'm up" on the routine alarm stops only that one |
| ✅ | **Held until the final alarm**: after 4am eepy plans tomorrow while this morning's alarms are still to come; both are kept (marks `wake.at` = the final alarm, `wake.routineAt`) until the final alarm has rung plus its backup and snooze grace, so the 6:05 alarm is never replaced by tomorrow's |
| ✅ | **Bedtime autopilot** stays on through the routine and switches off at the final alarm (the routine alarm gets through like every alarm) |
| ✅ | **Accurate wake-up**: the awake stretch around the routine alarm (watch's awake time, eepy use, alarm taps, steps) is the **morning routine** — with any sleep after it, it isn't taken as the final wake-up (even when only light sleep follows), it's labelled "Morning routine" in "Your night, step by step", and up to routine + 10 + 15 min of it counts neither as waking in the night (restfulness, WASO, awakenings, night story) nor as time awake in bed (efficiency, the planner's efficiency). Total sleep = both stretches. Two recordings either side of a long routine are joined into one night. **No sleep after the routine** → it was the real wake-up, and eepy says so |
| ✅ | **Routine card** for Today (only between the two alarms): *"Back to bed by 5:20 — alarm at 6:05. Lights low, screens off."* with **Staying up? Skip the 6:05 alarm** (also switches sleep mode off; Undo puts both back) — the morning isn't treated as a free day. The routine alarm's "I'm up" opens Today |
| ✅ | **Editor card** with a live preview: *"Lights out 21:55 → 04:47 routine alarm → back to sleep ~05:17 → up 06:05 · 7h 32m sleep"* |
| 🧪 | Watch-first: whether Nothing X mirrors the routine buzz while sleep mode is on (the "wrist" channel bypasses Do Not Disturb; the phone backup rings regardless) needs checking on a real CMF Watch 3 Pro |
| ℹ️ | Without per-night records, the current times are used to read past two-step mornings (mornings from when it was switched on; periods it was on before stay two-step after switching it off) |

## 26. New in 0.8 — easier navigation and planner

Built for a non-technical user who found it confusing where things were. Nothing was removed; things moved to where you'd look for them, every screen has a plain one-line explanation, and a search box finds any feature or setting.

| | Feature |
| --- | --- |
| ✅ | **Five tabs with plain names: Today · Planner · Nap · Sleep · More** (were Today · Nap · Plan · Coach · Trends). The old `/plan` and `/trends` routes redirect to Planner and Sleep; `/coach` is now a screen under More |
| ✅ | **Planner tab** (replaces Plan and the planning half of the Calendar): a **7-day week strip** — each morning's weekday, wake-up and the lights-out the night before, with marks for a time you set, a free day (no alarm) or a skipped alarm. Tap a day for its plan in plain words (*"Lights out 11:05 PM → alarm 6:05 AM · 7h 10m sleep, wind down from 10:05 PM"*), why it's earlier/shorter (body clock, easing into an early start, paying back debt) and the same controls as the month calendar: **Usual / Set a time / Free day**, each with a one-line explanation |
| ✅ | Planner → **Tonight**: lights-out in big type, wind-down, the alarm (cycle-timed, explained: *wakes you at the end of a sleep cycle, in the 30 minutes before your wake-up*), one clear **Can't make it? Adjust tonight** button, Skip / Undo for the alarm, "Why these times?" folded, calendar notes, the step-by-step wind-down and "Getting back on track" when there's sleep debt |
| ✅ | Planner → **Your usual week**: workdays (Mon–Sun toggles), workday wake-up and wake-up on other days (automatic = 1 h later) — moved here from Settings — plus the spot where the morning-routine card mounts |
| ✅ | Planner → **More planning tools**, folded: bedtime calculator, move your schedule, caffeine in your system, phone light; What if? and the jet lag planner; tonight's body-clock note. **Month view** button opens the month calendar (same day editor) |
| ✅ | **Sleep tab** = your history: **Trends** (all the charts), **Calendar** (the month of past nights and coming mornings) and **Nights** (every night, newest first, with sleep vs need and score; tap for the night report; *Log a night*) |
| ✅ | **More tab**: grouped under plain headings — Coach (coach, experiments, goals, weekly review), Learn (body clock, sleep need, What if?), Self-checks, Wind-down, Programmes (insomnia programme, jet lag), Your data (journal, log a night/drink, reports, connect the watch), App (settings, updates, what's new) |
| ✅ | **Search — "Find a feature or setting…"** at the top of More and Settings: a small index of every screen, tool, Settings page and the settings people look for by name (wake time, alarm, coffee, backup, do not disturb…), each result saying where it lives (*Planner › Your usual week*). Prefix and plural matching; a unit test fails if a screen or Settings page is missing from it or a result points at a route that doesn't exist |
| ✅ | **Settings split into short pages**: You & schedule · Alarms & watch · Notifications & shortcuts · Wind-down & phone light · Caffeine & drinks · Health Connect & data · App updates · About (`/settings/<page>`), grouped on a short Settings home with the same search box |
| ✅ | **Today**: a row of big one-tap buttons near the top — Log coffee, Check in, Nap, and Adjust tonight (Wind down in the evening). The evening no longer repeats tonight's times in a second card (a link opens the full plan in the Planner); the header keeps journal, sync and settings |
| ✅ | **"What's new / where things moved"** sheet, once, for people who used eepy before this update (new installs skip it); always available from More → What's new and Settings → About |

---

## 27. New in 0.8.1 — different wake-up times, calmer check-in

| | Feature |
| --- | --- |
| ✅ | **Different wake-up times on different days**: Planner → Your usual week → *Different times on different days* gives every weekday its own time (e.g. Mon 6:05, Tue 7:30, Thu 8:00); days you don't change keep the workday / day-off time, and single dates in the week strip still win. Bedtimes, alarms, two-step mornings (same gap before each day's wake-up), the week strip and reminders all follow |
| ✅ | **Check-in stays open** while you log several things (sleepiness, energy, coffee, tags); the "Saved" note with Undo fades and you leave with *Done* |

---

## 28. New in 0.9 — UI polish

A pass over every screen for one calm, consistent look. Nothing was removed.

| | Feature |
| --- | --- |
| ✅ | **One visual system** (`src/ui/theme.ts`, `src/ui/components.tsx`): a type scale with line heights (h1 · h2 · h3 · body · small · tiny, plus a `label` style for every small uppercase caption), a 4-pt spacing scale, colour roles (accent purple = actions and your plan, energy yellow, caffeine brown, violet for evening light and wind-down) and a fainter-text colour that still passes 4.5:1 contrast |
| ✅ | **Bigger touch targets**: buttons 48 dp (40 dp small, with extra hit area), chips 38 dp, steppers 40 dp, list rows 56 dp, header icons 44 dp; a whole settings row toggles its switch, not just the switch; switches use the accent colour everywhere |
| ✅ | **Times never break mid-word** ("6:56 A / M"): wider time columns in the night view, *Your day*, the journal and the simulator; stat values stay on one line and stats line up at the top |
| ✅ | **Charts**: one sans-serif face for every axis label, end labels kept inside the chart, room for the last point |
| ✅ | **Tab bar** tall enough for its labels; the floating **+** and tab bar dim with the night view, and every tab scrolls its last card clear of the **+** |
| ✅ | **Less repetition, shorter text**: cards no longer repeat their title in a toggle (two-step mornings, background sync), the phone-light tool isn't a card inside a card, single-group Settings pages drop the duplicate heading, long explanations (simulator, body clock, nap coach) fold away, the body-clock check-in list shows the latest five, and dense hints were shortened |
| ✅ | **Screens read top-down**: the night report leads with the score, then the story; stack screens show their one-line intro (Coach, Journal, Goals, Experiments, Log a drink); insights use a quiet icon instead of a bright border; onboarding has step dots, a Monday-first day row and a full-width *Next* |
| ✅ | Fixes: experiment rules no longer say "7:00 AM AM"; Sleep → Trends opened from a link no longer logs a navigation error; the quick coffee / nap sheets have a close button and two equal actions instead of wrapping buttons |

---

## 29. New in 0.10 — routine alarm per date

| | Feature |
| --- | --- |
| ✅ | **Routine alarm on or off for one morning**: tap a day in the Planner's week strip (or the month calendar) → *Routine alarm this morning*. Off skips the routine alarm that morning (one alarm, lights-out 30 min later, wake-up detection reads the early wake-up as the real one); on adds it to a morning outside your two-step days, a weekend with an alarm, or a single date while the weekly setting is off. The row says what it does (*"Up 5:00 AM for your 20-min routine, back to sleep until 6:00 AM · just this morning"*); switching back to what your week says forgets the choice, changing that morning's wake-up keeps it, and a free day (no alarms) drops it. Saved as `wakePlan[date].twoStep`; a routine-only choice doesn't mark the day as a set wake-up in the calendar |

---

## 30. New in 0.10 — e-ink reader

For people who read on a Kindle, Kobo, Boox or similar. E-ink reflects light like paper instead of shining a backlight at you, so with the frontlight low (and warm, if it can be) an e-reader is fine after screens-off — unlike a phone or tablet, which delays melatonin and sleep compared with a printed book (Chang et al., 2015).

| | Feature |
| --- | --- |
| ✅ | **Settings → Wind-down & phone light → E-ink reader**: *I read on an e-ink reader* (off by default) and *It has a warm / amber light*, with a short explainer, tonight's reading time (*phone away at 10:30 PM, then read until lights-out at 11:15 PM*) and a reminder to keep it to reading — on Android readers like Boox, browser and other apps closed, notifications off at night. Search finds it as e-reader, e-ink, Kindle, Kobo, Boox, reading, book, frontlight or warm light |
| ✅ | **Wind-down timeline** (Today in the evening, the wind-down routine, Planner → Tonight): *Screens off* says phone, tablet, TV and laptop off — your e-reader is fine (teeth and skin care now); the screen-free routine becomes **Read on your e-reader** from 10 min after screens-off until lights-out, with the frontlight advice; *Lights out* starts with **put the e-reader down**. No room for reading on a very short evening → no reading step |
| ✅ | **E-reader frontlight targets** (`engine/eReader.ts`, the same phases as the phone): daytime and evening — anything comfortable, frontlight off in daylight or a lit room (warmth going up in the evening); wind-down — frontlight ≤ 30%, warmth well up; screens-off → lights-out — the lowest you can read (about 10–20%), warmth all the way up, dark mode if the reader has it; night — e-reader down in bed, or read in another room until sleepy. Without a warm light: keep it low — a bedside lamp on the page beats the frontlight |
| ✅ | **Phone light card**: an *E-reader* block with the frontlight target right now; the full card (wind-down routine, Planner → More planning tools → Phone light) adds the rest of the evening |
| ✅ | **Middle of the night**: the night view's *Can't sleep?*, the lights-out step and the insomnia programme's stimulus-control rules say: after ~20 min awake, get up, sit somewhere dim in another room and read on your e-reader — frontlight at its lowest and warmest — until you're sleepy (and, in the programme, no reading in bed, e-reader included) |
| 🧪 | **Screens-off reminder**: *Phone down — e-reader's fine, frontlight low and warm* (just *frontlight low* without a warm light) |

---

## 31. New in 0.10 — "I'm in bed" sleep sessions

*"Can you add an in bed button, to start the sleep sesh?"* One tap starts the night; "I'm up" ends it.

| | Feature |
| --- | --- |
| ✅ | **"I'm in bed"** — a big button on Today from the start of wind-down (in the countdown card, and the last quick-action tile), in the night view and on the wind-down screen, with a small remembered **Start sleep sounds** switch (on by default) |
| ✅ | **The tap is tonight's lights-out**: ≥ 10 min off the plan, it becomes the one-night "Adjust tonight" override, so the cycle-timed alarm counts its sleep cycles from the tap — still in the 30 min before your wake-up, never later; your wake-up (or one you moved yourself) stays. Two-step mornings keep working: the routine alarm is the cycle-timed first ring, the final alarm stays at the wake-up (lights-out too close to the routine → one alarm). After 4am the session belongs to this morning and nothing is re-timed |
| ✅ | **Starts what helps**: your default sleep sound with its timer (unless something is already playing), and — with bedtime autopilot on — the phone's sleep mode until the alarm's first ring. Tonight's wind-down, lights-out, screens-off and phone-light reminders go quiet (the planners check the open session) and any already on screen are cleared |
| ✅ | **Calm confirmation**: *"Sleep session started 10:45 PM · Alarm 6:34 AM (5 cycles) · sleep mode on · Brown noise · 45 min"* with **Undo** for two minutes (puts tonight's plan and your own adjustment back, forgets the tap, stops the sound and sleep mode it started); then *"In bed since 10:45 PM"* with **End session** / **Cancel**. Today switches to the dimmed night view ("Good night"), with the **+** and tab bar dimmed |
| ✅ | **"I'm up"** on Today in the morning (big button), from the full-screen alarm's and the watch buzz's "I'm up" (the check-in ends the session), and "Staying up? Skip the alarm" on a two-step morning: records when you got up, stops sleep sounds and sleep mode; Undo opens the session again. Alarms are never silenced by it — one still to ring rings. A session nobody ended closes by itself 3 h after the wake-up (noon at the latest) |
| ✅ | **Accuracy** (wake-up detection rules 14–15): "I'm in bed" starts time in bed — earlier than the watch's recording adds time awake in bed, later leaves out what came before — and sleep onset is never earlier than the tap + 5 min; "I'm up" is a high-confidence sign of getting up, with the same went-back-to-sleep guard (deep/REM after it), no corroboration needed on unstaged nights, and up to 45 min after the recording (no walking in between) it ends the night there. "Your night, step by step" shows *"In bed 12:10 AM — you tapped In bed · the watch started at 12:35 AM"* |
| ✅ | **"Save last night from your taps"**: no watch night for that morning → in bed → up as a manual night with your usual time to fall asleep, in one tap; the watch's night replaces it if it arrives later |
| ✅ | **"I'm in bed" on the wind-down / lights-out notifications and the live wind-down card** (next to "Running late"), the `eepy://quick/inbed` one-tap sheet (with Undo; in the middle of the day it opens the Nap coach) and a long-press **app-icon shortcut** ("In bed", second, so launchers that show four keep it). Search: "in bed", "sleep session" |
| 🧪 | On a phone: sleep mode switching on at the tap and off at the alarm, Undo letting the autopilot switch it on again at lights-out (new native `undoSleepModeStart`; older APKs fall back to Stop, which keeps it off that night), the notification button cold-starting eepy into the sheet, the full-screen alarm's "I'm up" link (`eepy://checkin?up=alarm`, from the next alarm scheduled), the new shortcut icon, and sounds starting from a notification tap |

---

## 32. New in 0.10.1 — catching up with a late body clock

*"Does this make sense? How am I supposed to beat sleep debt?"* — a plan that held lights-out at 1:27 AM before a 5:00 routine alarm (about 3½ h of sleep) because the body clock was used to ~2:12 AM.

| | Feature |
| --- | --- |
| ✅ | **Sleep debt lets lights-out move further ahead of the body clock**: 1 h ahead of when you usually fall asleep with no debt, plus 1 min per 3 min of debt, up to 2 h (`schedule.bodyClockAdvanceMin`) — sleep pressure makes you sleepy sooner. Was a fixed 45 min |
| ✅ | **Never under 5 h on a morning with an alarm**: lights-out is planned for at least 5 h of sleep (routine and time to fall asleep included), but never more than 3 h before your usual sleep onset; the old rule could plan 4 h in bed. Days off with no alarm keep the body-clock hold |
| ✅ | **Actually steps earlier each night**: the hold uses the earlier of your four-week habit and the last three nights, so keeping last night's earlier lights-out moves tonight's; coming nights in the week strip and calendar assume ~30 min earlier per night instead of repeating the same late time. Holds shorter than 15 min are dropped |
| ✅ | **Honest plan text**: *"Your need puts lights out at 10:03 PM, but you've been falling asleep around 2:12 AM — too big a jump for one night. With 2h 59m of sleep debt you'll get sleepy sooner than usual, so aim for 12:06 AM tonight, then about 30 min earlier each night until you're there. Not sleepy at lights-out? Keep the lights low and read until you are."* plus what moves the body clock earlier (bright light soon after waking, dim evenings, not sleeping in > 1 h on days off). The "+20m to pay down debt" and "lights out 30 min earlier for the routine" lines are dropped on held nights, where they weren't true |
| ✅ | **Skip the routine on a short night**: a held two-step night says the routine costs 30 min of sleep, and the Planner offers **Skip the routine that morning · +30 min sleep** (sets that date's routine alarm off) |
| ✅ | The what-if simulator uses the same rule for "lying awake from going to bed too early" |

---

## NEW — Smarter nightly plan

*"Can you make it more dynamic as well? More possibilities, thinking, etc."* Each night eepy now weighs several ways to spend it, picks one with its reasoning in plain words, and learns from what you actually do (`engine/planOptions.ts`, `engine/adherence.ts`).

| | Feature |
| --- | --- |
| ✅ | **Options for tonight** (Planner → Tonight): only the ones that apply — *eepy's plan*; *Skip the routine* (eepy's plan for that morning without it, on a two-step morning); *Earliest you'll fall asleep* (your usual sleep onset minus the debt-aware body-clock advance, when it's 15+ min off the plan — e.g. the 5-hour floor put lights-out before you'll be sleepy — never before the full-need time); *Full catch-up* (your need plus the debt extra, with its expected time lying awake); *Can't make it* (30 min later, from an hour before lights-out, with and without the routine); *Plan + nap tomorrow* (20 min at the afternoon dip, done by 3 PM); *Sleep in a little* (only without a fixed alarm, up to an hour, at most 2 h after your workday wake-up, with its body-clock cost). Each one: the key times, expected sleep and the change vs the plan, time to fall asleep, debt after tonight and in a week, tomorrow's energy and focus, and plain pros and cons |
| ✅ | **Simulated, then projected**: every option is replayed by the what-if simulator (which now models the two-step routine as time awake in the night, and a nap tomorrow), then projected over the week plan's next six nights with the 14-night debt model — tonight like this, then eepy's plan (going to bed later or sleeping in nudges the next night's body clock later too). Strategies also show *"kept up every night"* (skipping the routine every two-step morning, the full-need time every night, the earliest every night) |
| ✅ | **eepy's pick, with a transparent score** (`UTILITY`): sleep (14 points an hour under 5 h, 10 up to your need, 5 beyond), −2 per hour of debt in a week, tomorrow's energy (0.4/point) and focus (0.4/h) — counting 1.5× with an early or an important first event (exam, interview, flight…) and 2× with both, −0.25 per minute lying awake, +6 for keeping your routine, realism (−0.04 per minute a lights-out is more than an hour before when you've actually been going to bed; less grace the later you usually are), −3 per hour slept in (−9 while eepy is easing your body clock earlier), −1.5 for fitting in a nap. **The plan — or the option you're using — stays the pick unless another beats it by 3 points**; nothing changes until you tap |
| ✅ | **How eepy decided** (folded): *"You have 3h 38m of sleep debt."* → *"You've been falling asleep around 1:52 AM — with that debt you can likely fall asleep from about 11:50 PM."* → *"Tomorrow starts at 6:00 AM with your routine at 5:00 AM."* → *"Last 3 nights you went to bed ~35 min after the plan."* → *"Your sleep onset has moved ~2 min earlier a night this week, so coming nights step 15 min earlier each, not 30."* → *"So: keep eepy's plan — lights out 11:52 PM, routine alarm 5:00 AM. (“Skip the routine” would add 30m of sleep — not enough to change it.)"* |
| ✅ | **Run down → sleep first**: low readiness (< 55), HRV well below normal, a recovery warning or "sick" in the journal: sleep counts 1.3×, the routine counts nothing, lying awake 1.5× and sleeping in half — *"You logged being sick → sleep wins over the routine."* |
| ✅ | **Adherence**: eepy keeps what it planned each night (`planLog`, from the app and the background task, frozen once that lights-out has passed; an "I'm in bed" tap never rewrites it) and compares it with when you actually went to bed — the tap, or the watch (onset minus your usual time to fall asleep). Late by 20+ min: realism tightens and *"Planning earlier won't help while bedtime keeps slipping ~35 min — start wind-down at 10:17 PM instead of 10:52 PM"*, with **Turn on the screens-off reminder** if it's off |
| ✅ | **The ramp follows you**: how fast your sleep onset has really moved over the last week (a robust Theil–Sen slope; one late Saturday doesn't swing it), blended with the default 30 min a night and kept within 15–45 min, sets how much earlier the week strip, calendar and recovery plan step each coming night (`PlanInput.rampMinPerNight`); the plan text says the pace it uses |
| ✅ | **Still up?** (Today, night view): past tonight's lights-out with no "I'm in bed" yet — the best plan from now (*"Lights out by 12:20 AM, skip the routine → 5h 25m"*) with **Use this**, 2–3 alternatives (bed now with the routine, a nap tomorrow, another 30 min up) with **Use**, how eepy decided, and *Pick your own time*. Using one sets tonight's lights-out (`settings.tonight`) and/or the routine alarm (`wakePlan[date].twoStep`), so the alarm, reminders and sleep mode follow and Today goes back to the countdown |
| ✅ | **In use, and back**: the option you use is marked *In use* (the countdown says *Using “Skip the routine” tonight*), and **Back to eepy's plan** restores tonight's times and the morning's routine choice. Your own times from Adjust tonight show as their own row |
| ✅ | Hidden while you're in bed and while the insomnia programme sets your window. Search: "options", "how eepy decided", "still up", "re-plan" |

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
