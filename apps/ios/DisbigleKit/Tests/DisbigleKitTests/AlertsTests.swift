import Foundation
import XCTest

@testable import DisbigleKit

final class AlertsTests: XCTestCase {
  private func notification(_ id: String, _ type: String, minutes: Int) throws -> DisbigleKit.Notification {
    let json = Fixtures.notification
      .replacingOccurrences(of: "\"id\":\"n1\"", with: "\"id\":\"\(id)\"")
      .replacingOccurrences(of: "\"type\":\"mention\"", with: "\"type\":\"\(type)\"")
      .replacingOccurrences(
        of: "\"created_at\":\"2026-10-21T10:00:00.000Z\",\n\"account\"",
        with: "\"created_at\":\"2026-10-21T10:\(String(format: "%02d", minutes)):00.000Z\",\n\"account\"")
    return try Client.decoder.decode(DisbigleKit.Notification.self, from: Data(json.utf8))
  }

  func testOnlyNewerNotificationsOfChosenKindsOldestFirst() throws {
    // Newest first, as the API lists them.
    let list = [
      try notification("n5", "favourite", minutes: 5),
      try notification("n4", "follow", minutes: 4),
      try notification("n3", "mention", minutes: 3),
      try notification("n2", "reblog", minutes: 2),
    ]
    let alerts = Alerts.newAlerts(in: list, after: "n2", kinds: [.mention, .favourite])
    XCTAssertEqual(alerts.map(\.id), ["n3", "n5"])
    XCTAssertEqual(alerts.first?.statusId, list[2].status?.id)
    // First run: old notifications are not announced.
    XCTAssertTrue(Alerts.newAlerts(in: list, after: nil, kinds: Set(Alerts.kinds)).isEmpty)
  }

  func testAlertTexts() throws {
    let mention = Alerts.alert(for: try notification("n1", "mention", minutes: 1))
    XCTAssertEqual(mention.title, "Faghy mentioned you")
    XCTAssertEqual(mention.body, "Tè o caffè?")
    let follow = Alerts.alert(for: try notification("n2", "follow", minutes: 1))
    XCTAssertEqual(follow.title, "Faghy follows you")
    XCTAssertEqual(follow.body, "@faghy")
    XCTAssertEqual(Alerts.label(for: .followRequest), "Follow requests")
  }

  func testProfileFormSendsEveryFieldSlot() throws {
    let account = try Client.decoder.decode(
      CredentialAccount.self,
      from: Data(
        #"{"id":"1","display_name":"Faghy","note":"<p>Ciao</p>","locked":true,"bot":false,"discoverable":true,"source":{"note":"Ciao","fields":[{"name":"Sito","value":"faghy.it"}],"language":"it","follow_requests_count":2}}"#
          .utf8))
    var draft = ProfileDraft(account: account)
    XCTAssertEqual(draft.note, "Ciao")
    XCTAssertEqual(draft.fields, [Account.Field(name: "Sito", value: "faghy.it")])
    draft.fields = []
    let body = String(decoding: draft.multipart.data, as: UTF8.self)
    XCTAssertTrue(body.contains("name=\"fields_attributes[0][name]\"\r\n\r\n\r\n"))
    XCTAssertTrue(body.contains("name=\"fields_attributes[3][value]\""))
    XCTAssertTrue(body.contains("name=\"locked\"\r\n\r\ntrue"))
    XCTAssertTrue(body.contains("name=\"source[language]\"\r\n\r\nit"))
    XCTAssertFalse(body.contains("name=\"avatar\""))
  }
}
