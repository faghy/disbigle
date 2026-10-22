import Foundation

/** A notification of the server, as a system notification on the device. */
public struct LocalAlert: Equatable, Sendable {
  /** The server notification id (also the system notification id: no duplicates). */
  public let id: String
  public let title: String
  public let body: String
  /** Groups alerts of the same thread (or person) in Notification Center. */
  public let threadId: String
  public let statusId: String?
  public let accountId: String
}

/** Which notifications become system notifications, and how they read. */
public enum Alerts {
  /** Kinds people can turn on or off, in the order the settings show them. */
  public static let kinds: [Notification.Kind] = [
    .mention, .reblog, .favourite, .follow, .followRequest, .poll, .update, .status,
  ]

  /** Kinds on by default: what someone usually wants to hear about. */
  public static let defaultKinds: Set<Notification.Kind> = [
    .mention, .reblog, .favourite, .follow, .followRequest, .poll,
  ]

  /**
   * Alerts for the notifications newer than `lastAlertedId`, oldest first, only of the chosen
   * kinds. With no `lastAlertedId` (first run) nothing is announced: old notifications are not news.
   */
  public static func newAlerts(
    in notifications: [Notification], after lastAlertedId: String?, kinds: Set<Notification.Kind>
  ) -> [LocalAlert] {
    guard let lastAlertedId else { return [] }
    let cutoff = notifications.first { $0.id == lastAlertedId }?.createdAt
    return
      notifications
      .filter { notification in
        guard notification.id != lastAlertedId, kinds.contains(notification.type) else { return false }
        // Ids are time-ordered on Disbigle (UUIDv7); dates cover other servers.
        if let cutoff { return notification.createdAt > cutoff }
        return notification.id > lastAlertedId
      }
      .sorted { $0.createdAt < $1.createdAt }
      .map(alert(for:))
  }

  public static func alert(for notification: Notification) -> LocalAlert {
    let name = notification.account.name
    let text = notification.status.map { RichText.plain($0.shown.content) } ?? ""
    let body: String
    switch notification.type {
    case .follow, .followRequest:
      body = "@\(notification.account.acct)"
    default:
      body = text.count > 240 ? String(text.prefix(239)) + "…" : text
    }
    return LocalAlert(
      id: notification.id,
      title: title(for: notification.type, name: name),
      body: body,
      threadId: notification.status?.shown.id ?? "account-\(notification.account.id)",
      statusId: notification.status?.shown.id,
      accountId: notification.account.id)
  }

  public static func title(for kind: Notification.Kind, name: String) -> String {
    let key =
      switch kind {
      case .mention: "alert.mention"
      case .status: "alert.status"
      case .reblog: "alert.reblog"
      case .favourite: "alert.favourite"
      case .follow: "alert.follow"
      case .followRequest: "alert.follow_request"
      case .poll: "alert.poll"
      case .update: "alert.update"
      case .unknown: "alert.other"
      }
    return String(format: localized(key), name)
  }

  /** The label of a kind in the settings. */
  public static func label(for kind: Notification.Kind) -> String {
    localized("kind.\(kind.rawValue)")
  }
}
