import Foundation
import XCTest

@testable import DisbigleKit

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class ChatTests: XCTestCase {
  func testChatPagesSeenAndPresence() async throws {
    let log = RequestLog()
    let session = StubProtocol.session { request in
      let path = request.url?.path ?? ""
      log.add("\(request.httpMethod ?? "") \(path)\(request.url?.query.map { "?\($0)" } ?? "")")
      switch path {
      case "/api/v1/conversations/c1/messages":
        return (
          200,
          #"{"id":"c1","accounts":[\#(Fixtures.account)],"messages":[],"seen":[{"account_id":"1","last_read_id":"m9"}],"presence":{"1":"busy"}}"#,
          [:]
        )
      default:
        return (200, "{}", [:])
      }
    }
    let client = Client(server: URL(string: "https://x.test")!, token: "t", session: session)
    let page = try await client.chat("c1")
    XCTAssertEqual(page.accounts.map(\.acct), ["faghy"])
    XCTAssertEqual(page.seen, [ChatPage.Seen(accountId: "1", lastReadId: "m9")])
    XCTAssertEqual(page.presence, ["1": "busy"])
    _ = try await client.chat("c1", maxId: "m1")
    try await client.presence(active: true)
    XCTAssertEqual(log.lines, [
      "GET /api/v1/conversations/c1/messages",
      "GET /api/v1/conversations/c1/messages?max_id=m1",
      "POST /api/v1/disbigle/presence",
    ])
  }

  func testBubblesDropTheAddressingMentions() {
    let mention =
      #"<span class="h-card" translate="no"><a href="https://x.test/@bob" class="u-url mention">@<span>bob</span></a></span>"#
    XCTAssertEqual(RichText.withoutLeadingMentions("<p>\(mention) Ciao Bob</p>"), "<p>Ciao Bob</p>")
    XCTAssertEqual(RichText.withoutLeadingMentions("<p>ciao \(mention)</p>"), "<p>ciao \(mention)</p>")
  }

  func testLinkCardsDecode() throws {
    let card = try Client.decoder.decode(
      Card.self,
      from: Data(
        #"{"url":"https://www.example.org/x","title":"T","description":"D","type":"link","provider_name":"","image":null,"width":0,"height":0}"#
          .utf8))
    XCTAssertEqual(card.site, "example.org")
  }
}
