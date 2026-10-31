package expo.modules.eepyalarm

import android.app.PendingIntent
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import java.util.function.Consumer

/**
 * Quick Settings tile "Log coffee": opens eepy://quick/coffee (logs the usual drink at its usual
 * time, with Undo / Change time) and collapses the shade. Declared in this module's manifest.
 */
class CoffeeTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val tile: Tile? = getQsTile()
    if (tile != null) {
      // A one-shot action, not an on/off switch: shown as an available (inactive) tile.
      tile.setState(Tile.STATE_INACTIVE)
      tile.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    if (isLocked()) {
      // eepy's screens don't show over the lock screen: ask for the PIN first.
      unlockAndRun(Runnable { open() })
    } else {
      open()
    }
  }

  private fun open() {
    val intent: Intent = AppShortcuts.viewIntent(this, LINK)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        // Android 14+: only the PendingIntent overload is allowed (the Intent one throws).
        val pending: PendingIntent? = PendingIntent.getActivity(this, REQUEST_CODE, intent, AlarmScheduler.PI_FLAGS)
        if (pending != null) startActivityAndCollapse(pending)
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(intent)
      }
    } catch (e: Exception) {
      try {
        startActivity(intent)
      } catch (e2: Exception) {
        // Nothing else to try.
      }
    }
  }

  companion object {
    const val LINK = "eepy://quick/coffee"
    private const val REQUEST_CODE = 0x0C0FFEE

    /**
     * Android 13+: asks the user to add the tile to Quick Settings (the system shows nothing if
     * it's already there or the user declined it too often). False below Android 13.
     */
    fun requestAdd(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
      val statusBar: StatusBarManager = context.getSystemService(StatusBarManager::class.java) ?: return false
      val icon: Icon = Icon.createWithResource(context, R.drawable.eepy_tile_coffee)
      val component = ComponentName(context, CoffeeTileService::class.java)
      return try {
        statusBar.requestAddTileService(component, "Log coffee", icon, context.getMainExecutor(), Consumer<Int> { _ -> })
        true
      } catch (e: Exception) {
        false
      }
    }
  }
}
