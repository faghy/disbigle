import Foundation
import XCTest

@testable import DisbigleKit

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class SignInTests: XCTestCase {
  func testSHA256MatchesKnownVectors() {
    let hex = { (bytes: [UInt8]) in bytes.map { String(format: "%02x", $0) }.joined() }
    XCTAssertEqual(
      hex(SHA256.hash(Array("abc".utf8))),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    XCTAssertEqual(
      hex(SHA256.hash([])), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    // Two blocks.
    XCTAssertEqual(
      hex(SHA256.hash(Array("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8))),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
  }

  func testPKCEChallengeFollowsRFC7636() {
    XCTAssertEqual(
      SignIn.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    let token = SignIn.randomToken()
    XCTAssertEqual(token.count, 43)
    XCTAssertFalse(token.contains("="))
    XCTAssertNotEqual(token, SignIn.randomToken())
  }

  func testServerAddressesAreNormalised() {
    XCTAssertEqual(SignIn.serverURL(from: "app.disbigle.com")?.absoluteString, "https://app.disbigle.com")
    XCTAssertEqual(
      SignIn.serverURL(from: " HTTP://App.Disbigle.com/@faghy?x=1 ")?.absoluteString,
      "https://app.disbigle.com")
    XCTAssertEqual(
      SignIn.serverURL(from: "@faghy@disbigle.com")?.absoluteString, "https://disbigle.com")
    XCTAssertNil(SignIn.serverURL(from: "localhost"))
    XCTAssertNil(SignIn.serverURL(from: ""))
  }

  func testCallbackNeedsTheSameState() throws {
    let signIn = SignIn(
      server: URL(string: "https://app.disbigle.com")!,
      app: RegisteredApp(clientId: "id", clientSecret: "secret"), verifier: "v", state: "s1")
    XCTAssertEqual(try signIn.code(from: URL(string: "disbigle://oauth?code=abc&state=s1")!), "abc")
    XCTAssertThrowsError(try signIn.code(from: URL(string: "disbigle://oauth?code=abc&state=other")!)) {
      XCTAssertEqual($0 as? SignIn.Failure, .badCallback)
    }
    XCTAssertThrowsError(try signIn.code(from: URL(string: "evil://oauth?code=abc&state=s1")!))
    XCTAssertThrowsError(
      try signIn.code(from: URL(string: "disbigle://oauth?error=access_denied&state=s1")!)
    ) { XCTAssertEqual($0 as? SignIn.Failure, .denied) }

    let items = URLComponents(url: signIn.authorizeURL, resolvingAgainstBaseURL: false)?.queryItems
    let value = { (name: String) in items?.first { $0.name == name }?.value }
    XCTAssertEqual(signIn.authorizeURL.path, "/oauth/authorize")
    XCTAssertEqual(value("client_id"), "id")
    XCTAssertEqual(value("redirect_uri"), "disbigle://oauth")
    XCTAssertEqual(value("code_challenge_method"), "S256")
    XCTAssertEqual(value("code_challenge"), SignIn.challenge(for: "v"))
  }
}

final class ClientTests: XCTestCase {
  func testLinkHeaderGivesTheNextCursor() {
    let header =
      "<https://app.disbigle.com/api/v1/timelines/home?max_id=0199>; rel=\"next\", <https://app.disbigle.com/api/v1/timelines/home?min_id=01a0>; rel=\"prev\""
    XCTAssertEqual(LinkHeader.next(header), [URLQueryItem(name: "max_id", value: "0199")])
    XCTAssertNil(LinkHeader.next("<https://x.test/?min_id=1>; rel=\"prev\""))
    XCTAssertNil(LinkHeader.next(nil))
  }

  func testDatesWithAndWithoutFractions() {
    XCTAssertNotNil(Client.parseDate("2026-10-22T08:15:30.123Z"))
    XCTAssertNotNil(Client.parseDate("2026-10-22T08:15:30Z"))
    XCTAssertNil(Client.parseDate("yesterday"))
  }

  func testDecodesAStatusAsTheServerSendsIt() throws {
    let status = try Client.decoder.decode(Status.self, from: Data(Fixtures.status.utf8))
    XCTAssertEqual(status.account.acct, "faghy")
    XCTAssertEqual(status.visibility, .public)
    XCTAssertEqual(status.mediaAttachments.first?.type, .image)
    XCTAssertEqual(status.mediaAttachments.first?.aspectRatio, 2)
    XCTAssertEqual(status.poll?.options.map(\.title), ["Tè", "Caffè"])
    XCTAssertEqual(status.poll.map { $0.share(of: $0.options[0]) }, 0.75)
    XCTAssertEqual(status.favourited, true)
    XCTAssertNotNil(status.editedAt)
    XCTAssertNil(status.account.headerURL)
    XCTAssertEqual(status.account.avatarURL?.absoluteString, "https://app.disbigle.com/media/a.webp")
    XCTAssertEqual(status.account.initials, "F")

    let reblog = try Client.decoder.decode(
      Status.self, from: Data(Fixtures.reblog(of: Fixtures.status).utf8))
    XCTAssertEqual(reblog.shown.id, status.id)
  }

  func testUnknownEnumValuesDoNotBreakDecoding() throws {
    let json = Fixtures.notification.replacingOccurrences(of: "\"mention\"", with: "\"admin.sign_up\"")
    let notification = try Client.decoder.decode(Notification.self, from: Data(json.utf8))
    XCTAssertEqual(notification.type, .unknown)
  }

  func testDraftBodies() {
    let plain = PostDraft(text: "Ciao", visibility: .unlisted, inReplyToId: "42").json
    XCTAssertEqual(plain["visibility"].map(describe), "unlisted")
    XCTAssertEqual(plain["in_reply_to_id"].map(describe), "42")
    let aspects = PostDraft(text: "Solo amici", aspectIds: ["a1"]).json
    XCTAssertEqual(aspects["visibility"].map(describe), "limited")
    XCTAssertEqual(aspects["aspect_ids"].map(describe), "[a1]")
  }

  func testRequestsCarryTheTokenAndDecodeErrors() async throws {
    let session = StubProtocol.session { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer t0k")
      switch request.url?.path {
      case "/api/v1/statuses/1/favourite":
        XCTAssertEqual(request.httpMethod, "POST")
        return (200, Fixtures.status, [:])
      case "/api/v1/timelines/home":
        return (
          200, "[\(Fixtures.status)]",
          ["Link": "<https://x.test/api/v1/timelines/home?max_id=0001>; rel=\"next\""]
        )
      case "/api/v1/statuses/404":
        return (404, "{\"error\":\"Record not found\"}", [:])
      default:
        return (401, "{\"error\":\"The access token is invalid\"}", [:])
      }
    }
    let client = Client(server: URL(string: "https://x.test")!, token: "t0k", session: session)
    let liked = try await client.act(.favourite, on: "1")
    XCTAssertEqual(liked.favourited, true)
    let page = try await client.timeline(.home)
    XCTAssertEqual(page.items.count, 1)
    XCTAssertEqual(page.next, [URLQueryItem(name: "max_id", value: "0001")])
    do {
      _ = try await client.status("404")
      XCTFail("expected an error")
    } catch {
      XCTAssertEqual(error as? APIError, .server(status: 404, message: "Record not found"))
    }
    do {
      _ = try await client.me()
      XCTFail("expected an error")
    } catch {
      XCTAssertEqual(error as? APIError, .unauthorized)
    }
  }

  private func describe(_ value: JSONValue) -> String {
    switch value {
    case .string(let s): s
    case .bool(let b): String(b)
    case .int(let i): String(i)
    case .array(let a): "[" + a.map(describe).joined(separator: ",") + "]"
    case .object: "{…}"
    case .null: "null"
    }
  }
}

final class RichTextTests: XCTestCase {
  func testParagraphsLinksAndMentions() {
    let html = """
      <p>Ciao <span class="h-card"><a href="https://app.disbigle.com/@alice" class="u-url mention">@<span>alice</span></a></span> &amp; tutti!</p>\
      <p>Guarda <a href="https://example.com/very/long/path" rel="nofollow"><span class="invisible">https://</span><span class="ellipsis">example.com/very/lo</span><span class="invisible">ng/path</span></a><br>a capo</p>
      """
    let text = RichText.attributed(html)
    XCTAssertEqual(String(text.characters), "Ciao @alice & tutti!\n\nGuarda example.com/very/lo…\na capo")
    let links = text.runs.compactMap(\.link)
    XCTAssertEqual(links.map(\.absoluteString), [
      "https://app.disbigle.com/@alice", "https://example.com/very/long/path",
    ])
  }

  func testListsQuotesAndEntities() {
    XCTAssertEqual(
      String(RichText.attributed("<ul><li>uno</li><li>due</li></ul><p>&#x1F600; &lt;3</p>").characters),
      "• uno\n• due\n\n😀 <3")
    XCTAssertEqual(RichText.plain("<p>a</p><p>b</p>"), "a\nb")
  }

  func testOnlyWebLinksAreKept() {
    let text = RichText.attributed("<a href=\"javascript:alert(1)\">x</a>")
    XCTAssertTrue(text.runs.compactMap(\.link).isEmpty)
  }
}

/** Answers requests of a URLSession from a closure. */
final class StubProtocol: URLProtocol, @unchecked Sendable {
  typealias Handler = @Sendable (URLRequest) -> (Int, String, [String: String])
  nonisolated(unsafe) static var handler: Handler?

  static func session(_ handler: @escaping Handler) -> URLSession {
    Self.handler = handler
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    return URLSession(configuration: configuration)
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func stopLoading() {}

  override func startLoading() {
    guard let handler = Self.handler, let url = request.url else { return }
    let (status, body, headers) = handler(request)
    let response = HTTPURLResponse(
      url: url, statusCode: status, httpVersion: "HTTP/1.1",
      headerFields: headers.merging(["Content-Type": "application/json"]) { a, _ in a })!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
}

enum Fixtures {
  static let account = """
    {"id":"0192a000-0000-7000-8000-000000000001","username":"faghy","acct":"faghy",
    "display_name":"Faghy","locked":false,"bot":false,"discoverable":true,"indexable":true,
    "group":false,"noindex":false,"hide_collections":false,"created_at":"2026-10-11T20:40:00.000Z",
    "note":"<p>Sistemista</p>","url":"https://app.disbigle.com/@faghy","uri":"https://app.disbigle.com/users/faghy",
    "avatar":"https://app.disbigle.com/media/a.webp","avatar_static":"https://app.disbigle.com/media/a.webp",
    "header":"https://app.disbigle.com/headers/original/missing.png","header_static":"https://app.disbigle.com/headers/original/missing.png",
    "followers_count":3,"following_count":5,"statuses_count":10,"last_status_at":"2026-10-21",
    "emojis":[],"roles":[],"fields":[{"name":"Sito","value":"<a href=\\"https://faghy.it\\">faghy.it</a>","verified_at":null}]}
    """

  static let status = """
    {"id":"0192a000-0000-7000-8000-0000000000aa","uri":"https://app.disbigle.com/users/faghy/statuses/aa",
    "url":"https://app.disbigle.com/@faghy/aa","created_at":"2026-10-21T10:00:00.000Z",
    "edited_at":"2026-10-21T10:05:00.000Z","account":\(account),"content":"<p>Tè o caffè?</p>",
    "visibility":"public","sensitive":false,"spoiler_text":"",
    "media_attachments":[{"id":"m1","type":"image","url":"https://app.disbigle.com/media/x.webp",
    "preview_url":"https://app.disbigle.com/media/x-small.webp","remote_url":null,"preview_remote_url":null,
    "text_url":null,"meta":{"original":{"width":800,"height":400,"size":"800x400","aspect":2}},
    "description":"Una tazza","blurhash":null}],
    "application":null,"mentions":[],"tags":[{"name":"caffe","url":"https://app.disbigle.com/tags/caffe","history":[]}],
    "emojis":[],"reblogs_count":1,"favourites_count":2,"replies_count":0,"in_reply_to_id":null,
    "in_reply_to_account_id":null,"reblog":null,
    "poll":{"id":"p1","expires_at":"2026-10-22T10:00:00.000Z","expired":false,"multiple":false,
    "votes_count":4,"voters_count":4,"options":[{"title":"Tè","votes_count":3},{"title":"Caffè","votes_count":1}],
    "emojis":[],"voted":true,"own_votes":[0]},
    "card":null,"language":"it","favourited":true,"reblogged":false,"muted":false,"bookmarked":false,"pinned":false}
    """

  static func reblog(of original: String) -> String {
    """
    {"id":"0192a000-0000-7000-8000-0000000000bb","uri":"u","url":null,"created_at":"2026-10-21T11:00:00Z",
    "edited_at":null,"account":\(account),"content":"","visibility":"public","sensitive":false,
    "spoiler_text":"","media_attachments":[],"application":null,"mentions":[],"tags":[],"emojis":[],
    "reblogs_count":0,"favourites_count":0,"replies_count":0,"in_reply_to_id":null,
    "in_reply_to_account_id":null,"reblog":\(original),"poll":null,"card":null,"language":null}
    """
  }

  static let notification = """
    {"id":"n1","type":"mention","group_key":"n1","created_at":"2026-10-21T10:00:00.000Z",
    "account":\(account),"status":\(status)}
    """
}
