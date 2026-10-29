package expo.modules.eepyalarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Date

/**
 * Full-screen alarm shown over the lock screen: the time, the alarm's title and body, and
 * "I'm up" / "Snooze 9 min". The sound and vibration belong to the alarm notification (see
 * AlarmNotifier), so both buttons stop them by cancelling it; leaving with Back or Home keeps
 * the alarm ringing until a button is pressed (on this screen or on the notification).
 */
class AlarmActivity : Activity() {
  private var alarm: AlarmSpec? = null
  private var handled = false
  private var clock: TextView? = null
  private val handler = Handler(Looper.getMainLooper())

  private val tick = object : Runnable {
    override fun run() {
      clock?.setText(DateFormat.getTimeFormat(this@AlarmActivity).format(Date()))
      handler.postDelayed(this, 10_000L)
    }
  }

  /** Matches the notification's own timeout: give the lock screen back. */
  private val timeout = Runnable {
    val current = alarm
    if (current != null) AlarmScheduler.dismiss(this, current)
    finish()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()
    handle(getIntent())
  }

  // A second alarm while this one is showing (launchMode singleInstance).
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handle(intent)
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  private fun handle(intent: Intent?) {
    val next = AlarmSpec.fromIntent(intent)
    if (next == null) {
      if (alarm == null) finish()
      return
    }
    alarm = next
    handled = false
    render(next)
    handler.removeCallbacksAndMessages(null)
    handler.post(tick)
    handler.postDelayed(timeout, AlarmNotifier.RING_TIMEOUT_MS)
    // "I'm up" pressed on the notification itself.
    if (intent?.getAction() == ACTION_WAKE_UP) wakeUp()
  }

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window?.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun snooze() {
    val current = alarm ?: return
    if (handled) return
    handled = true
    AlarmScheduler.snooze(this, current)
    finish()
  }

  private fun wakeUp() {
    val current = alarm ?: return
    if (handled) return
    handled = true
    AlarmScheduler.dismiss(this, current)
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (!keyguard.isKeyguardLocked()) {
      openApp(current.link)
      return
    }
    // Ask for the PIN / fingerprint now; the app opens behind the lock screen either way.
    keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
      override fun onDismissSucceeded() {
        openApp(current.link)
      }

      override fun onDismissCancelled() {
        openApp(current.link)
      }

      override fun onDismissError() {
        openApp(current.link)
      }
    })
  }

  /** Opens eepy at the alarm's deep link (e.g. eepy://checkin), else its launcher screen. */
  private fun openApp(link: String) {
    val opened = try {
      startActivity(AlarmNotifier.appIntent(this, link))
      true
    } catch (e: Exception) {
      false
    }
    if (!opened) {
      val launch: Intent? = getPackageManager().getLaunchIntentForPackage(getPackageName())
      if (launch != null) {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          startActivity(launch)
        } catch (e: Exception) {
          // Nothing else to try; the alarm is already off.
        }
      }
    }
    finish()
  }

  private fun render(current: AlarmSpec) {
    val root = LinearLayout(this)
    root.setOrientation(LinearLayout.VERTICAL)
    root.setGravity(Gravity.CENTER)
    root.setBackgroundColor(BACKGROUND)
    root.setPadding(dp(32), dp(48), dp(32), dp(48))

    val time = TextView(this)
    time.setText(DateFormat.getTimeFormat(this).format(Date()))
    time.setTextColor(Color.WHITE)
    time.setTextSize(72f)
    time.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL))
    time.setGravity(Gravity.CENTER)
    root.addView(time, wrap(0))
    clock = time

    val title = TextView(this)
    title.setText(current.title)
    title.setTextColor(Color.WHITE)
    title.setTextSize(26f)
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD)
    title.setGravity(Gravity.CENTER)
    root.addView(title, wrap(dp(16)))

    if (current.body.isNotEmpty()) {
      val body = TextView(this)
      body.setText(current.body)
      body.setTextColor(DIM)
      body.setTextSize(17f)
      body.setGravity(Gravity.CENTER)
      root.addView(body, wrap(dp(12)))
    }

    root.addView(button("I'm up", ACCENT, BACKGROUND) { wakeUp() }, wrap(dp(56)))
    root.addView(button("Snooze ${AlarmSpec.SNOOZE_MINUTES} min", SURFACE, Color.WHITE) { snooze() }, wrap(dp(14)))
    setContentView(root)
  }

  private fun button(label: String, fill: Int, textColor: Int, onClick: () -> Unit): Button {
    val background = GradientDrawable()
    background.setColor(fill)
    background.setCornerRadius(dp(32).toFloat())
    val b = Button(this)
    b.setText(label)
    b.setAllCaps(false)
    b.setTextSize(20f)
    b.setTextColor(textColor)
    b.setBackground(background)
    b.setMinHeight(dp(64))
    b.setPadding(dp(24), dp(16), dp(24), dp(16))
    b.setOnClickListener { onClick() }
    return b
  }

  private fun wrap(topMargin: Int): LinearLayout.LayoutParams {
    val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    params.topMargin = topMargin
    return params
  }

  private fun dp(value: Int): Int = (value * getResources().getDisplayMetrics().density).toInt()

  companion object {
    const val ACTION_WAKE_UP = "expo.modules.eepyalarm.WAKE_UP"
    private val BACKGROUND = Color.parseColor("#0B1020")
    private val SURFACE = Color.parseColor("#1F2740")
    private val ACCENT = Color.parseColor("#9B8CFF")
    private val DIM = Color.parseColor("#B8BCD6")

    internal fun intentFor(context: Context, alarm: AlarmSpec, action: String?): Intent {
      val intent = Intent(context, AlarmActivity::class.java)
      if (action != null) intent.setAction(action)
      intent.setData(AlarmScheduler.idUri(alarm.id))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return alarm.putInto(intent)
    }
  }
}
