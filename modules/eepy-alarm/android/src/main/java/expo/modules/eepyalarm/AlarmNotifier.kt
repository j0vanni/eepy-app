package expo.modules.eepyalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * The ringing alarm is a full-screen-intent notification. Its channel carries the sound (the
 * bundled wake.wav, else the phone's alarm tone) with USAGE_ALARM, so it plays on the alarm
 * volume even in silent mode, and FLAG_INSISTENT loops sound + vibration until the notification
 * is cancelled. Because the system owns the ringing, it keeps going if eepy's process is frozen
 * or killed, rings even when Android only shows a heads-up (phone in use, or full-screen intents
 * not allowed on Android 14+), and stops after RING_TIMEOUT_MS via setTimeoutAfter.
 */
internal object AlarmNotifier {
  const val CHANNEL_ID = "eepy-fullscreen-alarm"
  const val RING_TIMEOUT_MS = 5 * 60_000L
  private const val TAG = "eepy-alarm"
  private val VIBRATION = longArrayOf(0, 600, 400, 600, 400, 600)

  private fun manager(context: Context): NotificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      return manager(context).canUseFullScreenIntent()
    }
    return true
  }

  /** wake.wav is copied to res/raw by the expo-notifications config plugin (app.json → sounds). */
  private fun soundUri(context: Context): Uri {
    val pkg = context.packageName
    if (context.resources.getIdentifier("wake", "raw", pkg) != 0) {
      // By name, not id: the channel stores this URI and resource ids can change between builds.
      return Uri.parse("android.resource://$pkg/raw/wake")
    }
    val alarm: Uri? = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    return alarm ?: Settings.System.DEFAULT_ALARM_ALERT_URI
  }

  /** Channels are immutable once created (the user owns them), so this only runs the first time. */
  private fun ensureChannel(context: Context) {
    val nm = manager(context)
    val existing: NotificationChannel? = nm.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Full-screen alarms", NotificationManager.IMPORTANCE_HIGH)
    channel.setDescription("Nap and wake alarms that take over the lock screen")
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    channel.setSound(soundUri(context), attributes)
    channel.enableVibration(true)
    channel.setVibrationPattern(VIBRATION)
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC)
    channel.setBypassDnd(true)
    nm.createNotificationChannel(channel)
  }

  /** Posts the ringing alarm; Android launches AlarmActivity from it when the screen is off or locked. */
  fun show(context: Context, alarm: AlarmSpec) {
    ensureChannel(context)
    val code = alarm.requestCode
    val open: PendingIntent? = PendingIntent.getActivity(
      context,
      code,
      AlarmActivity.intentFor(context, alarm, null),
      AlarmScheduler.PI_FLAGS
    )
    val wakeUp: PendingIntent? = PendingIntent.getActivity(
      context,
      code,
      AlarmActivity.intentFor(context, alarm, AlarmActivity.ACTION_WAKE_UP),
      AlarmScheduler.PI_FLAGS
    )
    val snooze: PendingIntent? = PendingIntent.getBroadcast(
      context,
      code,
      alarm.putInto(AlarmScheduler.receiverIntent(context, AlarmScheduler.ACTION_SNOOZE, alarm.id)),
      AlarmScheduler.PI_FLAGS
    )
    if (open == null || wakeUp == null || snooze == null) return

    val icon = Icon.createWithResource(context, android.R.drawable.ic_lock_idle_alarm)
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setColor(Color.parseColor("#9B8CFF"))
      .setContentTitle(alarm.title)
      .setContentText(alarm.body)
      .setCategory(Notification.CATEGORY_ALARM)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setShowWhen(true)
      .setWhen(System.currentTimeMillis())
      .setTimeoutAfter(RING_TIMEOUT_MS)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .addAction(Notification.Action.Builder(icon, "Snooze ${AlarmSpec.SNOOZE_MINUTES} min", snooze).build())
      .addAction(Notification.Action.Builder(icon, "I'm up", wakeUp).build())
    val notification = builder.build()
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    manager(context).notify(TAG, code, notification)
  }

  /** Removes the alarm notification, which also stops its sound and vibration. */
  fun dismiss(context: Context, id: String) {
    manager(context).cancel(TAG, id.hashCode())
  }

  /** Builds the intent that re-opens the app (deep link, else its launcher activity). */
  fun appIntent(context: Context, link: String): Intent {
    val view = Intent(Intent.ACTION_VIEW, Uri.parse(link))
    view.setPackage(context.packageName)
    view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return view
  }
}
