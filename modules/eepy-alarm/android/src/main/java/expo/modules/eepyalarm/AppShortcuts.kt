package expo.modules.eepyalarm

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/**
 * Long-press app-icon shortcuts. They are dynamic (published at runtime through ShortcutManager),
 * so no manifest or shortcuts.xml is needed; each one opens an eepy:// deep link that expo-router
 * turns into a screen (src/app/quick/[action].tsx).
 */
internal object AppShortcuts {
  /** eepy's launcher activity (MainActivity): deep links, shortcuts and the sleep mode's settings link point here. */
  fun launchComponent(context: Context): ComponentName? {
    val launch: Intent? = context.packageManager.getLaunchIntentForPackage(context.packageName)
    return launch?.component
  }

  /**
   * ACTION_VIEW on an eepy:// link, aimed at eepy's own activity. SINGLE_TOP + CLEAR_TOP reuse the
   * running activity (it gets the link through onNewIntent) instead of restarting the app.
   */
  fun viewIntent(context: Context, link: String): Intent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link))
    val component: ComponentName? = launchComponent(context)
    if (component != null) {
      intent.setComponent(component)
    } else {
      intent.setPackage(context.packageName)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return intent
  }

  private fun iconRes(name: String): Int {
    return when (name) {
      "coffee" -> R.drawable.eepy_shortcut_coffee
      "nap" -> R.drawable.eepy_shortcut_nap
      "late" -> R.drawable.eepy_shortcut_late
      else -> R.drawable.eepy_shortcut_checkin
    }
  }

  /**
   * Replaces eepy's dynamic shortcuts with `json`: [{ id, shortLabel, longLabel, link, icon }].
   * Returns false if Android refused (rate-limited in the background, or no ShortcutManager).
   */
  fun publish(context: Context, json: String): Boolean {
    val manager: ShortcutManager = context.getSystemService(ShortcutManager::class.java) ?: return false
    val items = JSONArray(json)
    val max: Int = manager.getMaxShortcutCountPerActivity()
    val shortcuts = ArrayList<ShortcutInfo>()
    for (i in 0 until items.length()) {
      if (shortcuts.size >= max) break
      val item: JSONObject = items.getJSONObject(i)
      val id: String = item.getString("id")
      val shortLabel: String = item.getString("shortLabel")
      val longLabel: String = item.optString("longLabel", shortLabel)
      val link: String = item.getString("link")
      val icon: String = item.optString("icon", id)
      val shortcut: ShortcutInfo = ShortcutInfo.Builder(context, id)
        .setShortLabel(shortLabel)
        .setLongLabel(longLabel)
        .setIcon(Icon.createWithResource(context, iconRes(icon)))
        .setIntent(viewIntent(context, link))
        .setRank(i)
        .build()
      shortcuts.add(shortcut)
    }
    return manager.setDynamicShortcuts(shortcuts)
  }
}
