import Foundation
import XCTest

@testable import DisbigleKit

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/**
 * The whole sign-in and the main calls against a real Disbigle server, to check that what it
 * sends decodes. Runs only with `DISBIGLE_TEST_SERVER` (e.g. http://localhost:3300) pointing at
 * a development server seeded with `apps/server/src/seed.ts`.
 */
final class LiveServerTests: XCTestCase {
  func testSignInAndUseTheAPI() async throws {
    guard let address = ProcessInfo.processInfo.environment["DISBIGLE_TEST_SERVER"],
      let server = URL(string: address)
    else { throw XCTSkip("DISBIGLE_TEST_SERVER not set") }

    // A browser session (what the web sign-in page leaves behind).
    let noRedirects = NoRedirects()
    let browser = URLSession(configuration: .ephemeral, delegate: noRedirects, delegateQueue: nil)
    var login = URLRequest(url: server.appending(path: "api/v1/auth/login"))
    login.httpMethod = "POST"
    login.setValue("application/json", forHTTPHeaderField: "Content-Type")
    login.httpBody = Data(#"{"login":"alice","password":"disbigle-demo"}"#.utf8)
    let (_, loginResponse) = try await browser.data(for: login)
    let cookie = try XCTUnwrap(
      (loginResponse as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie")?
        .split(separator: ";").first.map(String.init))

    // The app's part: register, open the consent page, approve, get the code back.
    let signIn = try await SignIn.start(on: server)
    var consent = URLRequest(url: signIn.authorizeURL)
    consent.setValue(cookie, forHTTPHeaderField: "Cookie")
    let (page, _) = try await browser.data(for: consent)
    let html = String(decoding: page, as: UTF8.self)
    let fields = hiddenFields(in: html)
    XCTAssertEqual(fields["state"], signIn.state)
    var approve = URLRequest(url: server.appending(path: "oauth/authorize"))
    approve.httpMethod = "POST"
    approve.setValue(cookie, forHTTPHeaderField: "Cookie")
    approve.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    approve.httpBody = Data(
      formEncode(
        (fields.map { URLQueryItem(name: $0.key, value: $0.value) })
          + [URLQueryItem(name: "decision", value: "approve")]
      ).utf8)
    let (_, approved) = try await browser.data(for: approve)
    let location = try XCTUnwrap((approved as? HTTPURLResponse)?.value(forHTTPHeaderField: "Location"))
    let code = try signIn.code(from: try XCTUnwrap(URL(string: location)))
    let token = try await signIn.exchange(code: code)

    let client = Client(server: server, token: token.accessToken)
    let me = try await client.me()
    XCTAssertEqual(me.username, "alice")
    _ = try await client.instance()
    _ = try await client.aspects()

    // Post with a poll, edit it, like it, read it back in the timeline and its thread.
    let posted = try await client.publish(
      PostDraft(
        text: "Dall'app **iOS** #prova", visibility: .public,
        poll: .init(options: ["Sì", "No"], expiresIn: 3600, multiple: false)))
    XCTAssertEqual(posted.poll?.options.count, 2)
    let edited = try await client.edit(
      posted.id,
      PostDraft(
        text: "Dall'app iOS, modificato",
        poll: .init(options: ["Sì", "No"], expiresIn: 3600, multiple: false)))
    XCTAssertNotNil(edited.editedAt)
    let source = try await client.source(of: posted.id)
    XCTAssertEqual(source, "Dall'app iOS, modificato")
    let liked = try await client.act(.favourite, on: posted.id)
    XCTAssertEqual(liked.favourited, true)
    let reply = try await client.publish(PostDraft(text: "Risposta", inReplyToId: posted.id))
    let thread = try await client.context(of: posted.id)
    XCTAssertEqual(thread.descendants.map(\.id), [reply.id])
    let home = try await client.timeline(.home, query: [URLQueryItem(name: "limit", value: "2")])
    XCTAssertEqual(home.items.first?.id, reply.id)
    XCTAssertNotNil(home.next)
    let older = try await client.timeline(.home, query: home.next ?? [])
    XCTAssertFalse(older.items.contains { $0.id == reply.id })
    _ = try await client.timeline(.local)
    _ = try await client.timeline(.federated)
    _ = try await client.timeline(.tag("prova"))

    // An image, sent and attached.
    let media = try await client.upload(
      Self.png, filename: "pixel.png", mimeType: "image/png", description: "Un pixel")
    let withImage = try await client.publish(PostDraft(text: "Foto", mediaIds: [media.id]))
    XCTAssertEqual(withImage.mediaAttachments.first?.description, "Un pixel")

    // The rest of what the app shows.
    _ = try await client.notifications()
    _ = try await client.conversations()
    let profile = try await client.statuses(of: me.id)
    XCTAssertFalse(profile.items.isEmpty)
    let results = try await client.search("bruno")
    let bruno = try XCTUnwrap(results.accounts.first { $0.username == "bruno" })
    _ = try await client.relationship(with: bruno.id)
    _ = try await client.follow(bruno.id)
    let unfollowed = try await client.unfollow(bruno.id)
    XCTAssertFalse(unfollowed.following)

    try await client.delete(withImage.id)
    try await SignIn.revoke(token.accessToken, on: server, app: signIn.app)
    do {
      _ = try await client.me()
      XCTFail("the revoked token still works")
    } catch {
      XCTAssertEqual(error as? APIError, .unauthorized)
    }
  }

  private func hiddenFields(in html: String) -> [String: String] {
    var fields: [String: String] = [:]
    for part in html.components(separatedBy: "<input").dropFirst() {
      let tag = String(part.prefix { $0 != ">" })
      let attributes = RichText.attributes("input" + tag)
      if attributes["type"] == "hidden", let name = attributes["name"] {
        fields[name] = attributes["value"] ?? ""
      }
    }
    return fields
  }

  /** A 1×1 PNG. */
  static let png = Data(
    base64Encoded:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  )!
}

/** Keeps the redirect to `disbigle://` for the test to read, instead of following it. */
final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
