package expo.modules.eepyalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build

/**
 * Exact alarm-clock scheduling (rings in Doze, shows in the status bar / lock screen as the next
 * alarm). Pending alarms are also kept in SharedPreferences so AlarmBootReceiver can restore them.
 */
internal object AlarmScheduler {
  const val ACTION_FIRE = "expo.modules.eepyalarm.FIRE"
  const val ACTION_SNOOZE = "expo.modules.eepyalarm.SNOOZE"
  val PI_FLAGS: Int = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
  private const val PREFS = "expo.modules.eepyalarm.alarms"

  /** Makes each alarm's intents distinct even if two ids ever shared a hash code. */
  fun idUri(id: String): Uri = Uri.parse("eepy-alarm://alarm/" + Uri.encode(id))

  fun receiverIntent(context: Context, action: String, id: String): Intent {
    val intent = Intent(context, AlarmReceiver::class.java)
    intent.setAction(action)
    intent.setData(idUri(id))
    return intent
  }

  /** Schedules (or replaces) the alarm with this id. Returns false if Android refused it. */
  fun schedule(context: Context, alarm: AlarmSpec): Boolean {
    val fire: PendingIntent? = PendingIntent.getBroadcast(
      context,
      alarm.requestCode,
      alarm.putInto(receiverIntent(context, ACTION_FIRE, alarm.id)),
      PI_FLAGS
    )
    if (fire == null) return false
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val exactAllowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.canScheduleExactAlarms() else true
    try {
      val show = showIntent(context, alarm)
      if (exactAllowed && show != null) {
        am.setAlarmClock(AlarmManager.AlarmClockInfo(alarm.triggerAt, show), fire)
      } else {
        // Exact alarms revoked: still ring, a little late if the phone is dozing.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.triggerAt, fire)
      }
    } catch (e: SecurityException) {
      try {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.triggerAt, fire)
      } catch (e2: Exception) {
        return false
      }
    }
    prefs(context).edit().putString(alarm.id, alarm.toJson()).apply()
    return true
  }

  /** Cancels the alarm and its snooze, and stops it if it's ringing right now. */
  fun cancel(context: Context, id: String) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (key in listOf(id, AlarmSpec.snoozeId(id)).distinct()) {
      val pending: PendingIntent? = PendingIntent.getBroadcast(
        context,
        key.hashCode(),
        receiverIntent(context, ACTION_FIRE, key),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
      )
      if (pending != null) {
        am.cancel(pending)
        pending.cancel()
      }
      AlarmNotifier.dismiss(context, key)
      forget(context, key)
    }
  }

  /** Stops the ringing alarm and rings again in AlarmSpec.SNOOZE_MINUTES. */
  fun snooze(context: Context, alarm: AlarmSpec) {
    AlarmNotifier.dismiss(context, alarm.id)
    forget(context, alarm.id)
    schedule(context, alarm.snoozed(System.currentTimeMillis()))
  }

  /** Stops the ringing alarm for good. */
  fun dismiss(context: Context, alarm: AlarmSpec) {
    AlarmNotifier.dismiss(context, alarm.id)
    forget(context, alarm.id)
  }

  fun forget(context: Context, id: String) {
    prefs(context).edit().remove(id).apply()
  }

  /** After a reboot (or an app update): schedule the stored alarms that are still in the future. */
  fun restore(context: Context) {
    val now = System.currentTimeMillis()
    val stored: Map<String, *> = prefs(context).all ?: emptyMap<String, Any?>()
    for ((key, value) in stored) {
      val alarm = if (value is String) AlarmSpec.fromJson(value) else null
      if (alarm == null || alarm.triggerAt <= now) {
        forget(context, key)
      } else {
        schedule(context, alarm)
      }
    }
  }

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** What the system opens when the user taps the upcoming alarm (status bar / quick settings). */
  private fun showIntent(context: Context, alarm: AlarmSpec): PendingIntent? {
    val launch: Intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, alarm.requestCode, launch, PI_FLAGS)
  }
}
