package expo.modules.eepyalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Bedtime autopilot's exact alarms: switches the "eepy sleep" mode on at bedtime and off at the alarm. */
class SleepModeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action: String? = intent.getAction()
    val night: String? = intent.getStringExtra(SleepMode.EXTRA_NIGHT)
    try {
      SleepMode.onAlarm(context, action, night)
    } catch (e: Exception) {
      // Never crash in the background; the status shown in Settings carries the error.
    }
  }
}
