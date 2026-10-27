package com.disbigle.kit

/** A notification of the server, as a system notification on the device. */
data class LocalAlert(
  /** The server notification id (also used for the system notification: no duplicates). */
  val id: String,
  val kind: Notification.Kind,
  /** Who did it, for the title the app writes in its language. */
  val name: String,
  val body: String,
  /** Groups alerts of the same thread (or person). */
  val threadId: String,
  val statusId: String?,
  val accountId: String,
)

/** Which notifications become system notifications, and what they say. */
object Alerts {
  /** Kinds people can turn on or off, in the order the settings show them. */
  val kinds = listOf(
    Notification.Kind.MENTION, Notification.Kind.REBLOG, Notification.Kind.FAVOURITE, Notification.Kind.FOLLOW,
    Notification.Kind.FOLLOW_REQUEST, Notification.Kind.POLL, Notification.Kind.UPDATE, Notification.Kind.STATUS,
  )

  /** Kinds on by default: what someone usually wants to hear about. */
  val defaultKinds = setOf(
    Notification.Kind.MENTION, Notification.Kind.REBLOG, Notification.Kind.FAVOURITE, Notification.Kind.FOLLOW,
    Notification.Kind.FOLLOW_REQUEST, Notification.Kind.POLL,
  )

  /**
   * Alerts for the notifications newer than `lastAlertedId`, oldest first, only of the chosen
   * kinds. With no `lastAlertedId` (first run) nothing is announced: old notifications are not news.
   */
  fun newAlerts(notifications: List<Notification>, lastAlertedId: String?, kinds: Set<Notification.Kind>): List<LocalAlert> {
    lastAlertedId ?: return emptyList()
    val cutoff = notifications.firstOrNull { it.id == lastAlertedId }?.created
    return notifications
      .filter { n ->
        if (n.id == lastAlertedId || n.type !in kinds) return@filter false
        // Ids are time-ordered on Disbigle (UUIDv7); dates cover other servers.
        if (cutoff != null) n.created > cutoff else n.id > lastAlertedId
      }
      .sortedBy { it.created }
      .map(::alert)
  }

  fun alert(notification: Notification): LocalAlert {
    val text = notification.status?.let { RichText.plain(it.shown.content) } ?: ""
    val body = when (notification.type) {
      Notification.Kind.FOLLOW, Notification.Kind.FOLLOW_REQUEST -> "@${notification.account.acct}"
      else -> if (text.length > 240) text.take(239) + "…" else text
    }
    return LocalAlert(
      id = notification.id,
      kind = notification.type,
      name = notification.account.name,
      body = body,
      threadId = notification.status?.shown?.id ?: "account-${notification.account.id}",
      statusId = notification.status?.shown?.id,
      accountId = notification.account.id,
    )
  }
}
