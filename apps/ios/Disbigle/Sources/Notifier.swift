import BackgroundTasks
import DisbigleKit
import Foundation
import Observation
import UIKit
import UserNotifications

/** App preferences kept on this device. */
@MainActor @Observable
final class Preferences {
  private let defaults = UserDefaults.standard

  var defaultVisibility: DisbigleKit.Visibility {
    didSet { defaults.set(defaultVisibility.rawValue, forKey: "defaultVisibility") }
  }
  var sensitiveMedia: Bool {
    didSet { defaults.set(sensitiveMedia, forKey: "sensitiveMedia") }
  }
  /** System notifications for new server notifications. */
  var notificationsOn: Bool {
    didSet { defaults.set(notificationsOn, forKey: "notificationsOn") }
  }
  var alertKinds: Set<DisbigleKit.Notification.Kind> {
    didSet { defaults.set(alertKinds.map(\.rawValue), forKey: "alertKinds") }
  }
  /** Unread notifications on the app icon. */
  var badge: Bool {
    didSet { defaults.set(badge, forKey: "badge") }
  }

  init() {
    defaultVisibility =
      defaults.string(forKey: "defaultVisibility").flatMap(DisbigleKit.Visibility.init(rawValue:)) ?? .public
    sensitiveMedia = defaults.bool(forKey: "sensitiveMedia")
    notificationsOn = defaults.bool(forKey: "notificationsOn")
    badge = defaults.object(forKey: "badge") as? Bool ?? true
    alertKinds =
      (defaults.stringArray(forKey: "alertKinds")?.compactMap(DisbigleKit.Notification.Kind.init(rawValue:)))
      .map(Set.init) ?? Alerts.defaultKinds
  }
}

/**
 * Turns server notifications into system notifications. There is no push service for apps
 * installed with SideStore, so iOS wakes the app from time to time (Background App Refresh)
 * and the app looks for new notifications; while the app is open it checks every minute.
 */
@MainActor @Observable
final class Notifier {
  static let refreshTask = "com.disbigle.app.refresh"
  private let defaults = UserDefaults.standard

  /** Unread notifications (for the tab badge). */
  private(set) var unread = 0
  private(set) var authorization: UNAuthorizationStatus = .notDetermined

  /** The newest notification already announced (or seen in the app). */
  private var lastAlertedId: String? {
    get { defaults.string(forKey: "lastAlertedId") }
    set { defaults.set(newValue, forKey: "lastAlertedId") }
  }

  func refreshAuthorization() async {
    authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  /** Asks iOS for permission; true if notifications can be shown. */
  func requestPermission() async -> Bool {
    let granted =
      (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]))
      ?? false
    await refreshAuthorization()
    return granted
  }

  /** Asks iOS to wake the app again in a while. */
  func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: Self.refreshTask)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    try? BGTaskScheduler.shared.submit(request)
  }

  /**
   * Fetches the latest notifications. In the background, new ones of the chosen kinds become
   * system notifications; in the foreground they are only counted (the app shows them).
   */
  func check(client: Client?, preferences: Preferences, announce: Bool) async {
    guard let client else { return }
    guard let page = try? await client.notifications(query: [URLQueryItem(name: "limit", value: "30")])
    else { return }
    let notifications = page.items
    let marker = try? await client.notificationsReadMarker()
    unread = notifications.filter { marker == nil || $0.id > marker! }.count
    if preferences.badge {
      try? await UNUserNotificationCenter.current().setBadgeCount(unread)
    }
    defer { if let newest = notifications.first?.id { lastAlertedId = newest } }
    guard announce, preferences.notificationsOn else { return }
    let alerts = Alerts.newAlerts(in: notifications, after: lastAlertedId, kinds: preferences.alertKinds)
    for alert in alerts {
      let content = UNMutableNotificationContent()
      content.title = alert.title
      content.body = alert.body
      content.threadIdentifier = alert.threadId
      content.sound = .default
      content.userInfo = ["statusId": alert.statusId ?? "", "accountId": alert.accountId]
      try? await UNUserNotificationCenter.current().add(
        UNNotificationRequest(identifier: alert.id, content: content, trigger: nil))
    }
  }

  /** Everything up to the newest notification is read, here and on other devices. */
  func markAllRead(client: Client?, newestId: String?) async {
    unread = 0
    try? await UNUserNotificationCenter.current().setBadgeCount(0)
    UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    guard let client, let newestId else { return }
    lastAlertedId = max(lastAlertedId ?? "", newestId)
    try? await client.markNotificationsRead(upTo: newestId)
  }

  func signedOut() {
    unread = 0
    lastAlertedId = nil
    UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    Task { try? await UNUserNotificationCenter.current().setBadgeCount(0) }
  }
}

/** Receives taps on system notifications. */
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  /** Set by the app: opens what a tapped notification is about. */
  @MainActor var onOpen: ((_ statusId: String?, _ accountId: String?) -> Void)?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    let statusId = (info["statusId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let accountId = info["accountId"] as? String
    await MainActor.run { onOpen?(statusId, accountId) }
  }

  /** In the app the notifications tab already shows them: no banner. */
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    []
  }
}
