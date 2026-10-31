package expo.modules.eepyalarm

import android.app.AlarmManager
import android.app.AutomaticZenRule
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.service.notification.Condition
import android.service.notification.ZenDeviceEffects
import android.service.notification.ZenPolicy
import org.json.JSONArray
import org.json.JSONObject

/** One night of sleep mode: on at `on`, off at `off` (epoch ms). `night` is that night's wake-up date (YYYY-MM-DD). */
internal data class SleepWindow(val night: String, val on: Long, val off: Long, val sounds: String?) {
  fun toJson(): JSONObject {
    val json = JSONObject()
    json.put("night", night)
    json.put("on", on)
    json.put("off", off)
    if (sounds != null) json.put("sounds", sounds)
    return json
  }

  companion object {
    fun fromJson(json: JSONObject): SleepWindow? {
      return try {
        val sounds: String? = if (json.has("sounds")) json.getString("sounds") else null
        SleepWindow(json.getString("night"), json.getLong("on"), json.getLong("off"), sounds)
      } catch (e: Exception) {
        null
      }
    }
  }
}

/**
 * Bedtime autopilot: an app-owned AutomaticZenRule ("eepy sleep") switched on and off by exact
 * AlarmManager alarms (SleepModeReceiver), so it works while eepy is closed.
 *
 * - Android 15+ (API 35): built with AutomaticZenRule.Builder and device effects (grayscale,
 *   dimmed wallpaper, dark theme, no always-on display) — the phone's own "mode" UI.
 * - Android 10–14 (API 29–34): the classic rule, which only filters notifications.
 * - Older: unsupported (setAutomaticZenRuleState needs API 29).
 *
 * Every NotificationManager rule call needs Do Not Disturb ("Modes") access, which the user grants
 * once in Settings (ACCESS_NOTIFICATION_POLICY). Interruption filter is PRIORITY with alarms and
 * media always allowed, so eepy's alarms and sleep sounds still play. Nothing here throws.
 */
internal object SleepMode {
  const val ACTION_ON = "expo.modules.eepyalarm.SLEEP_ON"
  const val ACTION_OFF = "expo.modules.eepyalarm.SLEEP_OFF"
  const val EXTRA_NIGHT = "expo.modules.eepyalarm.NIGHT"
  private const val PREFS = "expo.modules.eepyalarm.sleepmode"
  private const val KEY_RULE_ID = "ruleId"
  private const val KEY_WINDOWS = "windows"
  private const val KEY_APPLIED = "appliedNight"
  private const val KEY_STOPPED = "stoppedNight"
  private const val KEY_ACTIVE = "activeByEepy"
  private const val KEY_ERROR = "lastError"
  private const val RULE_NAME = "eepy sleep"
  private const val TRIGGER_DESCRIPTION = "From your eepy plan: bedtime until your alarm"
  private const val CHANNEL_ID = "eepy-sleep-mode"
  private const val NOTIFICATION_TAG = "eepy-sleep"
  private const val NOTIFICATION_ID = 1
  private const val SOUNDS_LINK = "eepy://quick/sounds"
  private const val WIND_DOWN_LINK = "eepy://winddown"

  /** setAutomaticZenRuleState was added in Android 10. */
  fun supported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

  /** Stable condition id, in the platform's condition://<package>/... form. */
  private fun conditionId(context: Context): Uri =
    Uri.Builder().scheme(Condition.SCHEME).authority(context.packageName).appendPath("sleep-mode").build()

  private fun manager(context: Context): NotificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun hasAccess(context: Context): Boolean {
    return try {
      manager(context).isNotificationPolicyAccessGranted()
    } catch (e: Exception) {
      false
    }
  }

  private fun setError(context: Context, message: String) {
    prefs(context).edit().putString(KEY_ERROR, message).apply()
  }

  private fun describe(e: Exception): String = e.message ?: e.javaClass.simpleName

  // ---- The rule ---------------------------------------------------------------------------------

  /** eepy's rule id, creating the rule if it doesn't exist (yet, or any more). Null without access. */
  fun ensureRule(context: Context): String? {
    if (!supported() || !hasAccess(context)) return null
    val nm = manager(context)
    val p = prefs(context)
    val stored: String? = p.getString(KEY_RULE_ID, null)
    if (stored != null) {
      val existing: AutomaticZenRule? = try {
        nm.getAutomaticZenRule(stored)
      } catch (e: Exception) {
        null
      }
      if (existing != null) return stored
    }
    // The id was lost (e.g. app data cleared) but the rule survived: adopt it rather than add a second one.
    val uri = conditionId(context)
    try {
      val rules: Map<String, AutomaticZenRule>? = nm.getAutomaticZenRules()
      if (rules != null) {
        for ((id, rule) in rules) {
          if (uri == rule.getConditionId()) {
            p.edit().putString(KEY_RULE_ID, id).apply()
            return id
          }
        }
      }
    } catch (e: Exception) {
      // Fall through and create it.
    }
    val config: ComponentName? = AppShortcuts.launchComponent(context)
    if (config == null) {
      setError(context, "eepy has no launch activity")
      return null
    }
    var created: String? = null
    var error: String? = null
    for (rule in candidateRules(context, config)) {
      try {
        created = nm.addAutomaticZenRule(rule)
      } catch (e: Exception) {
        error = describe(e)
      }
      if (created != null) break
    }
    if (created == null) {
      setError(context, error ?: "Android didn't create the sleep mode")
      return null
    }
    p.edit().putString(KEY_RULE_ID, created).remove(KEY_ERROR).apply()
    return created
  }

  /** Rules to try, best first. */
  private fun candidateRules(context: Context, config: ComponentName): List<AutomaticZenRule> {
    val uri = conditionId(context)
    // Alarms (eepy's included) and media (sleep sounds) always get through; the rest follows the user's settings.
    val policy: ZenPolicy = ZenPolicy.Builder().allowAlarms(true).allowMedia(true).build()
    val rules = ArrayList<AutomaticZenRule>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      val effects: ZenDeviceEffects = ZenDeviceEffects.Builder()
        .setShouldDisplayGrayscale(true)
        .setShouldDimWallpaper(true)
        .setShouldUseNightMode(true)
        .setShouldSuppressAmbientDisplay(true)
        .build()
      // TYPE_BEDTIME is reserved for the system's Wellbeing app (anyone else gets an
      // IllegalArgumentException), so a time-based type is the fallback.
      val types = intArrayOf(AutomaticZenRule.TYPE_BEDTIME, AutomaticZenRule.TYPE_SCHEDULE_TIME)
      for (type in types) {
        val rule: AutomaticZenRule = AutomaticZenRule.Builder(RULE_NAME, uri)
          .setType(type)
          .setConfigurationActivity(config)
          .setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
          .setZenPolicy(policy)
          .setDeviceEffects(effects)
          .setIconResId(R.drawable.eepy_ic_moon)
          .setTriggerDescription(TRIGGER_DESCRIPTION)
          .setManualInvocationAllowed(true)
          .setEnabled(true)
          .build()
        rules.add(rule)
      }
    } else {
      val owner: ComponentName? = null
      rules.add(AutomaticZenRule(RULE_NAME, owner, config, uri, policy, NotificationManager.INTERRUPTION_FILTER_PRIORITY, true))
    }
    return rules
  }

  private fun condition(context: Context, on: Boolean, userAction: Boolean): Condition {
    val uri = conditionId(context)
    val state = if (on) Condition.STATE_TRUE else Condition.STATE_FALSE
    val summary = if (on) "Sleeping" else "Awake"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      // A user's own Start / Stop in eepy is never ignored; scheduled changes respect a manual override.
      val source = if (userAction) Condition.SOURCE_USER_ACTION else Condition.SOURCE_SCHEDULE
      return Condition(uri, summary, state, source)
    }
    return Condition(uri, summary, state)
  }

  /** Switches the rule on or off. False (with lastError set) when Android didn't let us. */
  private fun setRuleState(context: Context, on: Boolean, userAction: Boolean): Boolean {
    if (!supported()) {
      setError(context, "Sleep mode needs Android 10 or newer")
      return false
    }
    if (!hasAccess(context)) {
      setError(context, "eepy isn't allowed to control Do Not Disturb / Modes")
      return false
    }
    // Turning off never creates the rule just to switch it off.
    val id: String? = if (on) ensureRule(context) else prefs(context).getString(KEY_RULE_ID, null)
    if (id == null) return !on
    return try {
      manager(context).setAutomaticZenRuleState(id, condition(context, on, userAction))
      prefs(context).edit().putBoolean(KEY_ACTIVE, on).remove(KEY_ERROR).apply()
      true
    } catch (e: Exception) {
      setError(context, describe(e))
      false
    }
  }

  // ---- Windows and alarms -----------------------------------------------------------------------

  private fun loadWindows(context: Context): MutableList<SleepWindow> {
    val out = ArrayList<SleepWindow>()
    val text: String = prefs(context).getString(KEY_WINDOWS, null) ?: return out
    try {
      val array = JSONArray(text)
      for (i in 0 until array.length()) {
        val window = SleepWindow.fromJson(array.getJSONObject(i))
        if (window != null) out.add(window)
      }
    } catch (e: Exception) {
      // Corrupt: start over.
    }
    return out
  }

  private fun saveWindows(context: Context, windows: List<SleepWindow>) {
    val array = JSONArray()
    for (w in windows) array.put(w.toJson())
    prefs(context).edit().putString(KEY_WINDOWS, array.toString()).apply()
  }

  private fun alarmIntent(context: Context, action: String, night: String, flags: Int): PendingIntent? {
    val intent = Intent(context, SleepModeReceiver::class.java)
    intent.setAction(action)
    val kind = if (action == ACTION_ON) "on" else "off"
    intent.setData(Uri.parse("eepy-sleep://" + kind + "/" + Uri.encode(night)))
    intent.putExtra(EXTRA_NIGHT, night)
    return PendingIntent.getBroadcast(context, (action + night).hashCode(), intent, flags)
  }

  private fun setAlarm(context: Context, at: Long, pending: PendingIntent) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val exact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.canScheduleExactAlarms() else true
    try {
      if (exact) {
        // Not setAlarmClock: this isn't an alarm, it shouldn't show up as "next alarm".
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      } else {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      }
    } catch (e: Exception) {
      try {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      } catch (e2: Exception) {
        setError(context, "Couldn't schedule sleep mode: " + describe(e2))
      }
    }
  }

  private fun setAlarms(context: Context, window: SleepWindow, now: Long) {
    if (window.on > now) {
      val on = alarmIntent(context, ACTION_ON, window.night, AlarmScheduler.PI_FLAGS)
      if (on != null) setAlarm(context, window.on, on)
    }
    if (window.off > now) {
      val off = alarmIntent(context, ACTION_OFF, window.night, AlarmScheduler.PI_FLAGS)
      if (off != null) setAlarm(context, window.off, off)
    }
  }

  private fun cancelAlarms(context: Context, window: SleepWindow) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (action in listOf(ACTION_ON, ACTION_OFF)) {
      val pending = alarmIntent(context, action, window.night, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE)
      if (pending != null) {
        am.cancel(pending)
        pending.cancel()
      }
    }
  }

  /** Switches on for `night`, once: not if eepy already did, or the user stopped it for that night. */
  private fun turnOnOnce(context: Context, night: String): Boolean {
    val p = prefs(context)
    if (p.getString(KEY_STOPPED, null) == night) return false
    if (p.getString(KEY_APPLIED, null) == night) return false
    if (!setRuleState(context, true, false)) return false
    p.edit().putString(KEY_APPLIED, night).apply()
    return true
  }

  /**
   * Plans `window` (replacing any plan for another night that hasn't started). A night already in
   * progress keeps its own "off" — e.g. after 4am eepy plans tonight while this morning's alarm is
   * still to come. Already inside the window: switches on now (once per night, unless stopped).
   */
  fun schedule(context: Context, window: SleepWindow) {
    val now = System.currentTimeMillis()
    val kept = ArrayList<SleepWindow>()
    for (w in loadWindows(context)) {
      if (w.night != window.night && w.on <= now && w.off > now) kept.add(w) else cancelAlarms(context, w)
    }
    kept.add(window)
    saveWindows(context, kept)
    setAlarms(context, window, now)
    // Create the mode up front so it shows in Settings (and can be customised) before the first night.
    if (supported() && hasAccess(context)) ensureRule(context)
    if (window.on <= now && now < window.off) turnOnOnce(context, window.night)
  }

  /** Autopilot turned off: drop every plan, and switch off if eepy switched it on. */
  fun cancelAll(context: Context) {
    val now = System.currentTimeMillis()
    val applied: String? = prefs(context).getString(KEY_APPLIED, null)
    var wasOn = false
    for (w in loadWindows(context)) {
      cancelAlarms(context, w)
      if (applied == w.night && w.on <= now && now < w.off) wasOn = true
    }
    saveWindows(context, emptyList())
    dismissPrompt(context)
    if (wasOn) setRuleState(context, false, true)
  }

  /** "Start now": on until `off` (tonight's planned off time). */
  fun startNow(context: Context, night: String, off: Long): Boolean {
    val now = System.currentTimeMillis()
    if (!setRuleState(context, true, true)) return false
    val p = prefs(context)
    val edit = p.edit().putString(KEY_APPLIED, night)
    if (p.getString(KEY_STOPPED, null) == night) edit.remove(KEY_STOPPED)
    edit.apply()
    if (off > now) {
      val windows = loadWindows(context)
      val existing: SleepWindow? = windows.firstOrNull { it.night == night }
      if (existing != null) cancelAlarms(context, existing)
      val started = SleepWindow(night, if (existing != null) Math.min(existing.on, now) else now, off, existing?.sounds)
      val updated = ArrayList<SleepWindow>()
      for (w in windows) if (w.night != night) updated.add(w)
      updated.add(started)
      saveWindows(context, updated)
      setAlarms(context, started, now)
    }
    return true
  }

  /** "Stop now": off, and it stays off for the rest of this night (its "on" alarm is skipped). */
  fun stopNow(context: Context, night: String): Boolean {
    prefs(context).edit().putString(KEY_STOPPED, night).apply()
    dismissPrompt(context)
    return setRuleState(context, false, true)
  }

  /** An alarm from SleepModeReceiver. */
  fun onAlarm(context: Context, action: String?, night: String?) {
    if (night == null) return
    val now = System.currentTimeMillis()
    val windows = loadWindows(context)
    val window: SleepWindow? = windows.firstOrNull { it.night == night }
    if (action == ACTION_ON) {
      // Superseded or cancelled plans have no window any more; a very late alarm is past its night.
      if (window == null || now >= window.off) return
      val sounds = window.sounds
      if (turnOnOnce(context, night) && sounds != null) showSoundsPrompt(context, sounds)
    } else if (action == ACTION_OFF) {
      setRuleState(context, false, false)
      dismissPrompt(context)
      val remaining = ArrayList<SleepWindow>()
      for (w in windows) if (w.night != night) remaining.add(w)
      saveWindows(context, remaining)
    }
  }

  /** After a reboot or an update (AlarmManager forgot everything): put the alarms back. */
  fun restore(context: Context) {
    val now = System.currentTimeMillis()
    val applied: String? = prefs(context).getString(KEY_APPLIED, null)
    val kept = ArrayList<SleepWindow>()
    var missedOff = false
    for (w in loadWindows(context)) {
      if (w.off <= now) {
        if (applied == w.night) missedOff = true
        continue
      }
      kept.add(w)
    }
    saveWindows(context, kept)
    if (missedOff) setRuleState(context, false, false)
    for (w in kept) {
      setAlarms(context, w, now)
      if (w.on <= now) turnOnOnce(context, w.night)
    }
  }

  // ---- "Play sleep sounds?" -----------------------------------------------------------------------

  private fun showSoundsPrompt(context: Context, sounds: String) {
    try {
      val nm = manager(context)
      if (!nm.areNotificationsEnabled()) return
      if (nm.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(CHANNEL_ID, "Bedtime autopilot", NotificationManager.IMPORTANCE_DEFAULT)
        channel.setDescription("When sleep mode turns on: an offer to play your sleep sounds")
        channel.setSound(null, null)
        channel.enableVibration(false)
        nm.createNotificationChannel(channel)
      }
      val code = CHANNEL_ID.hashCode()
      val play: PendingIntent? = PendingIntent.getActivity(context, code, AppShortcuts.viewIntent(context, SOUNDS_LINK), AlarmScheduler.PI_FLAGS)
      val open: PendingIntent? = PendingIntent.getActivity(context, code + 1, AppShortcuts.viewIntent(context, WIND_DOWN_LINK), AlarmScheduler.PI_FLAGS)
      if (play == null || open == null) return
      val icon = Icon.createWithResource(context, R.drawable.eepy_ic_moon)
      val notification: Notification = Notification.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.eepy_ic_moon)
        .setColor(Color.parseColor("#9B8CFF"))
        .setContentTitle("Sleep mode on 🌙")
        .setContentText("Play sleep sounds? " + sounds)
        .setContentIntent(open)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .addAction(Notification.Action.Builder(icon, "Play sounds", play).build())
        .build()
      nm.notify(NOTIFICATION_TAG, NOTIFICATION_ID, notification)
    } catch (e: Exception) {
      // Best effort.
    }
  }

  fun dismissPrompt(context: Context) {
    try {
      manager(context).cancel(NOTIFICATION_TAG, NOTIFICATION_ID)
    } catch (e: Exception) {
      // Nothing to dismiss.
    }
  }

  // ---- Status and settings screens --------------------------------------------------------------

  fun status(context: Context): Map<String, Any?> {
    val p = prefs(context)
    val sdk = Build.VERSION.SDK_INT
    val nm = manager(context)
    val access = supported() && hasAccess(context)
    val storedId: String? = p.getString(KEY_RULE_ID, null)
    var ruleExists: Boolean? = null
    var active: Boolean? = null
    if (access && storedId != null) {
      try {
        ruleExists = nm.getAutomaticZenRule(storedId) != null
      } catch (e: Exception) {
        ruleExists = null
      }
      if (sdk >= Build.VERSION_CODES.VANILLA_ICE_CREAM && ruleExists == true) {
        try {
          active = nm.getAutomaticZenRuleState(storedId) == Condition.STATE_TRUE
        } catch (e: Exception) {
          active = null
        }
      }
    }
    // Below Android 15 the rule's state can't be read: report what eepy last asked for.
    if (active == null && ruleExists != false && storedId != null) active = p.getBoolean(KEY_ACTIVE, false)
    var userManaged = false
    if (sdk >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      try {
        userManaged = nm.areAutomaticZenRulesUserManaged()
      } catch (e: Exception) {
        userManaged = false
      }
    }
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val exact = if (sdk >= Build.VERSION_CODES.S) am.canScheduleExactAlarms() else true
    val windows = ArrayList<Map<String, Any?>>()
    for (w in loadWindows(context).sortedBy { it.on }) {
      windows.add(mapOf("night" to w.night, "onAt" to w.on.toDouble(), "offAt" to w.off.toDouble(), "sounds" to w.sounds))
    }
    return mapOf(
      "sdk" to sdk,
      "supported" to supported(),
      "deviceEffects" to (sdk >= Build.VERSION_CODES.VANILLA_ICE_CREAM),
      "access" to access,
      "ruleId" to (if (ruleExists == false) null else storedId),
      "active" to active,
      "userManaged" to userManaged,
      "exactAlarms" to exact,
      "windows" to windows,
      "appliedNight" to p.getString(KEY_APPLIED, null),
      "stoppedNight" to p.getString(KEY_STOPPED, null),
      "lastError" to p.getString(KEY_ERROR, null)
    )
  }

  private fun startFirst(context: Context, candidates: List<Intent>): Boolean {
    for (intent in candidates) {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
        return true
      } catch (e: Exception) {
        // Not on this phone: try the next one.
      }
    }
    return false
  }

  /** Where the user allows eepy to control Do Not Disturb / Modes. */
  fun openAccessSettings(context: Context): Boolean {
    return startFirst(
      context,
      listOf(
        Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
      )
    )
  }

  /** Android 15+: the "eepy sleep" mode's own page (what it silences, its effects); else DND settings. */
  fun openModeSettings(context: Context): Boolean {
    val candidates = ArrayList<Intent>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      val id: String? = ensureRule(context)
      if (id != null) {
        val intent = Intent(Settings.ACTION_AUTOMATIC_ZEN_RULE_SETTINGS)
        intent.putExtra(Settings.EXTRA_AUTOMATIC_ZEN_RULE_ID, id)
        candidates.add(intent)
      }
    }
    candidates.add(Intent(Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS))
    candidates.add(Intent(Settings.ACTION_SOUND_SETTINGS))
    return startFirst(context, candidates)
  }
}
