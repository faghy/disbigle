package com.disbigle.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.disbigle.kit.Alerts
import com.disbigle.kit.Client
import com.disbigle.kit.Notification
import com.disbigle.kit.Visibility
import com.disbigle.kit.markNotificationsRead
import com.disbigle.kit.notifications
import com.disbigle.kit.notificationsReadMarker
import java.util.concurrent.TimeUnit

/** App preferences kept on this device. */
class Preferences(context: Context) {
  private val prefs = context.getSharedPreferences("preferences", Context.MODE_PRIVATE)

  private val visibilityState = mutableStateOf(Visibility.of(prefs.getString("defaultVisibility", "public")!!))
  private val sensitiveState = mutableStateOf(prefs.getBoolean("sensitiveMedia", false))
  private val notificationsState = mutableStateOf(prefs.getBoolean("notificationsOn", false))

  var defaultVisibility: Visibility
    get() = visibilityState.value
    set(value) {
      visibilityState.value = value
      prefs.edit().putString("defaultVisibility", value.raw).apply()
    }
  var sensitiveMedia: Boolean
    get() = sensitiveState.value
    set(value) {
      sensitiveState.value = value
      prefs.edit().putBoolean("sensitiveMedia", value).apply()
    }
  /** System notifications for new server notifications. */
  var notificationsOn: Boolean
    get() = notificationsState.value
    set(value) {
      notificationsState.value = value
      prefs.edit().putBoolean("notificationsOn", value).apply()
    }
  var alertKinds by mutableStateOf(
    prefs.getStringSet("alertKinds", null)?.map(Notification.Kind::of)?.toSet() ?: Alerts.defaultKinds,
  )
    private set

  fun setAlertKind(kind: Notification.Kind, on: Boolean) {
    alertKinds = if (on) alertKinds + kind else alertKinds - kind
    prefs.edit().putStringSet("alertKinds", alertKinds.map { it.raw }.toSet()).apply()
  }
}

/**
 * Turns server notifications into system notifications. Android runs a background job about every
 * 15 minutes (WorkManager) that looks for new notifications; while the app is open it checks
 * every minute and only updates the unread count.
 */
class Notifier(private val context: Context) {
  private val prefs = context.getSharedPreferences("notifier", Context.MODE_PRIVATE)

  /** Unread notifications (for the tab badge). */
  var unread by mutableIntStateOf(0)
    private set

  /** The newest notification already announced (or seen in the app). */
  private var lastAlertedId: String?
    get() = prefs.getString("lastAlertedId", null)
    set(value) = prefs.edit().putString("lastAlertedId", value).apply()

  val permitted: Boolean
    get() = Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  /** Runs the background check from now on (or stops it). */
  fun schedule(on: Boolean) {
    val work = WorkManager.getInstance(context)
    if (!on) {
      work.cancelUniqueWork(WORK)
      return
    }
    val request = PeriodicWorkRequestBuilder<CheckWorker>(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    work.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
  }

  /**
   * Fetches the latest notifications. In the background, new ones of the chosen kinds become
   * system notifications; in the foreground they are only counted (the app shows them).
   */
  suspend fun check(client: Client?, preferences: Preferences, announce: Boolean) {
    client ?: return
    val notifications = runCatching { client.notifications(listOf("limit" to "30")).items }.getOrNull() ?: return
    val marker = runCatching { client.notificationsReadMarker() }.getOrNull()
    unread = notifications.count { marker == null || it.id > marker }
    val newest = notifications.firstOrNull()?.id
    try {
      if (!announce || !preferences.notificationsOn || !permitted) return
      ensureChannel()
      for (alert in Alerts.newAlerts(notifications, lastAlertedId, preferences.alertKinds)) {
        val open = Intent(context, MainActivity::class.java)
          .setAction(Intent.ACTION_VIEW)
          .putExtra(MainActivity.EXTRA_STATUS, alert.statusId)
          .putExtra(MainActivity.EXTRA_ACCOUNT, alert.accountId)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(
          context, alert.id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
          .setSmallIcon(R.drawable.ic_notification)
          .setColor(ContextCompat.getColor(context, R.color.brand))
          .setContentTitle(title(alert.kind, alert.name))
          .setContentText(alert.body)
          .setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
          .setGroup(alert.threadId)
          .setAutoCancel(true)
          .setContentIntent(pending)
          .setNumber(unread)
          .build()
        try {
          NotificationManagerCompat.from(context).notify(alert.id, 0, notification)
        } catch (_: SecurityException) {
          return
        }
      }
    } finally {
      if (newest != null) lastAlertedId = newest
    }
  }

  /** Everything up to the newest notification is read, here and on other devices. */
  suspend fun markAllRead(client: Client?, newestId: String?) {
    unread = 0
    NotificationManagerCompat.from(context).cancelAll()
    client ?: return
    newestId ?: return
    lastAlertedId = maxOf(lastAlertedId ?: "", newestId)
    runCatching { client.markNotificationsRead(newestId) }
  }

  fun signedOut() {
    unread = 0
    lastAlertedId = null
    schedule(false)
    NotificationManagerCompat.from(context).cancelAll()
  }

  private fun title(kind: Notification.Kind, name: String): String = when (kind) {
    Notification.Kind.MENTION -> context.getString(R.string.alert_mention, name)
    Notification.Kind.STATUS -> context.getString(R.string.alert_status, name)
    Notification.Kind.REBLOG -> context.getString(R.string.alert_reblog, name)
    Notification.Kind.FAVOURITE -> context.getString(R.string.alert_favourite, name)
    Notification.Kind.FOLLOW -> context.getString(R.string.alert_follow, name)
    Notification.Kind.FOLLOW_REQUEST -> context.getString(R.string.alert_follow_request, name)
    Notification.Kind.POLL -> context.getString(R.string.alert_poll)
    Notification.Kind.UPDATE -> context.getString(R.string.alert_update, name)
    Notification.Kind.UNKNOWN -> name
  }

  private fun ensureChannel() {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, context.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT),
      )
    }
  }

  companion object {
    const val WORK = "notifications-check"
    const val CHANNEL = "notifications"
  }
}

/** What Android runs in the background about every 15 minutes. */
class CheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val preferences = Preferences(applicationContext)
    val session = SessionStore.load(applicationContext)
    if (!preferences.notificationsOn || session == null) return Result.success()
    Notifier(applicationContext).check(Client(session.server, session.token), preferences, announce = true)
    return Result.success()
  }
}
