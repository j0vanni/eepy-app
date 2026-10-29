package expo.modules.eepyalarm

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS API: see modules/eepy-alarm/index.ts. */
class EepyAlarmModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("EepyAlarm")

    AsyncFunction("scheduleAlarm") { id: String, triggerAtMs: Double, title: String, body: String, link: String? ->
      AlarmScheduler.schedule(context, AlarmSpec(id, triggerAtMs.toLong(), title, body, link ?: AlarmSpec.DEFAULT_LINK))
    }

    AsyncFunction("cancelAlarm") { id: String ->
      AlarmScheduler.cancel(context, id)
    }

    AsyncFunction<Boolean>("canUseFullScreenIntent") {
      AlarmNotifier.canUseFullScreenIntent(context)
    }

    AsyncFunction("openFullScreenIntentSettings") {
      openFullScreenIntentSettings(context)
    }.runOnQueue(Queues.MAIN)
  }

  /** Android 14+: the per-app "Allow full-screen notifications" switch; older: notification settings. */
  private fun openFullScreenIntentSettings(ctx: Context) {
    val pkg = ctx.packageName
    val candidates = mutableListOf<Intent>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      candidates.add(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$pkg")))
    }
    val notificationSettings = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
    notificationSettings.putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
    candidates.add(notificationSettings)
    candidates.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
    for (intent in candidates) {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(intent)
        return
      } catch (e: Exception) {
        // Not on this phone: try the next one.
      }
    }
  }
}
