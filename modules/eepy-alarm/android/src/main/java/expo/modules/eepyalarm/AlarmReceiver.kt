package expo.modules.eepyalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The alarm going off (from AlarmManager) and the notification's Snooze button. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val alarm = AlarmSpec.fromIntent(intent) ?: return
    val action: String? = intent.getAction()
    if (action == AlarmScheduler.ACTION_FIRE) {
      AlarmScheduler.forget(context, alarm.id)
      AlarmNotifier.show(context, alarm)
    } else if (action == AlarmScheduler.ACTION_SNOOZE) {
      AlarmScheduler.snooze(context, alarm)
    }
  }
}

/** AlarmManager drops every alarm on reboot; put back the ones that haven't rung yet. */
class AlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action: String? = intent.getAction()
    if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      AlarmScheduler.restore(context)
    }
  }
}
