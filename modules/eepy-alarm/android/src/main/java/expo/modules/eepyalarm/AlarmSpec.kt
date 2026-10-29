package expo.modules.eepyalarm

import android.content.Intent
import org.json.JSONObject

/** One alarm: everything needed to ring it, snooze it and put it back after a reboot. */
internal data class AlarmSpec(
  val id: String,
  val triggerAt: Long,
  val title: String,
  val body: String,
  val link: String
) {
  /**
   * PendingIntent request code and notification id. String.hashCode() is fixed by the Java spec,
   * so it's the same on every launch (mirrored by alarmRequestCode() in src/notifications/fullScreenAlarm.ts).
   */
  val requestCode: Int
    get() = id.hashCode()

  fun putInto(intent: Intent): Intent {
    intent.putExtra(EXTRA_ID, id)
    intent.putExtra(EXTRA_TRIGGER_AT, triggerAt)
    intent.putExtra(EXTRA_TITLE, title)
    intent.putExtra(EXTRA_BODY, body)
    intent.putExtra(EXTRA_LINK, link)
    return intent
  }

  fun toJson(): String {
    val json = JSONObject()
    json.put("id", id)
    json.put("triggerAt", triggerAt)
    json.put("title", title)
    json.put("body", body)
    json.put("link", link)
    return json.toString()
  }

  /** The snooze rings under its own id, so re-planning the original alarm can't overwrite it. */
  fun snoozed(now: Long): AlarmSpec = copy(id = snoozeId(id), triggerAt = now + SNOOZE_MS)

  companion object {
    const val SNOOZE_MINUTES = 9
    const val SNOOZE_MS = SNOOZE_MINUTES * 60_000L
    const val DEFAULT_LINK = "eepy://checkin"
    private const val SNOOZE_SUFFIX = ":snooze"

    private const val EXTRA_ID = "expo.modules.eepyalarm.ID"
    private const val EXTRA_TRIGGER_AT = "expo.modules.eepyalarm.TRIGGER_AT"
    private const val EXTRA_TITLE = "expo.modules.eepyalarm.TITLE"
    private const val EXTRA_BODY = "expo.modules.eepyalarm.BODY"
    private const val EXTRA_LINK = "expo.modules.eepyalarm.LINK"

    fun snoozeId(id: String): String = if (id.endsWith(SNOOZE_SUFFIX)) id else id + SNOOZE_SUFFIX

    fun fromIntent(intent: Intent?): AlarmSpec? {
      if (intent == null) return null
      val id: String = intent.getStringExtra(EXTRA_ID) ?: return null
      val title: String = intent.getStringExtra(EXTRA_TITLE) ?: "Alarm"
      val body: String = intent.getStringExtra(EXTRA_BODY) ?: ""
      val link: String = intent.getStringExtra(EXTRA_LINK) ?: DEFAULT_LINK
      return AlarmSpec(id, intent.getLongExtra(EXTRA_TRIGGER_AT, 0L), title, body, link)
    }

    fun fromJson(text: String): AlarmSpec? {
      return try {
        val json = JSONObject(text)
        AlarmSpec(
          json.getString("id"),
          json.getLong("triggerAt"),
          json.optString("title", "Alarm"),
          json.optString("body", ""),
          json.optString("link", DEFAULT_LINK)
        )
      } catch (e: Exception) {
        null
      }
    }
  }
}
