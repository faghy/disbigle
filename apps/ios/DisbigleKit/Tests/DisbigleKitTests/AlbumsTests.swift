import Foundation
import XCTest

@testable import DisbigleKit

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class AlbumsTests: XCTestCase {
  static let media = """
    {"id":"m1","type":"image","url":"https://x.test/media/x.webp","preview_url":"https://x.test/media/x-small.webp",
    "remote_url":null,"description":"Una tazza","blurhash":null,"meta":null}
    """

  static let album = """
    {"id":"al1","account_id":"0192a000-0000-7000-8000-000000000001","name":"Viaggi","description":"",
    "media_count":3,"cover":\(media),"updated_at":"2026-10-30T09:00:00.000Z"}
    """

  func testDecodesAnAlbumAndItsDetail() throws {
    let album = try Client.decoder.decode(Album.self, from: Data(Self.album.utf8))
    XCTAssertEqual(album.name, "Viaggi")
    XCTAssertEqual(album.mediaCount, 3)
    XCTAssertEqual(album.cover?.previewUrl, "https://x.test/media/x-small.webp")
    XCTAssertNil(album.includes)

    let listed = Self.album.replacingOccurrences(of: "\"cover\":\(Self.media)", with: "\"cover\":null,\"includes\":true")
    let own = try Client.decoder.decode([Album].self, from: Data("[\(listed)]".utf8))
    XCTAssertEqual(own.first?.includes, true)
    XCTAssertNil(own.first?.cover)

    let detail = String(Self.album.dropLast()) + """
      ,"account":\(Fixtures.account),"items":[{"media_attachment":\(Self.media),"status_id":"s1",
      "sensitive":true,"created_at":"2026-10-29T08:00:00Z"}]}
      """
    let decoded = try Client.decoder.decode(AlbumDetail.self, from: Data(detail.utf8))
    XCTAssertEqual(decoded.album.id, "al1")
    XCTAssertEqual(decoded.account.acct, "faghy")
    XCTAssertEqual(decoded.items.map(\.id), ["m1"])
    XCTAssertEqual(decoded.items.first?.statusId, "s1")
    XCTAssertEqual(decoded.items.first?.sensitive, true)
    XCTAssertEqual(decoded.items.first?.thumbnailURL?.absoluteString, "https://x.test/media/x-small.webp")
  }

  func testMediaOfPostsIsFlattened() throws {
    let status = try Client.decoder.decode(Status.self, from: Data(Fixtures.status.utf8))
    let reblog = try Client.decoder.decode(Status.self, from: Data(Fixtures.reblog(of: Fixtures.status).utf8))
    let items = MediaItem.items(of: [status, reblog])
    XCTAssertEqual(items.map(\.id), ["m1"])
    XCTAssertEqual(items.first?.statusId, status.id)
    XCTAssertEqual(items.first?.sensitive, false)
  }

  func testDraftValidation() {
    XCTAssertFalse(AlbumDraft(name: "  ").isValid)
    XCTAssertTrue(AlbumDraft(name: " Viaggi ", description: "Estate").isValid)
    XCTAssertFalse(AlbumDraft(name: String(repeating: "a", count: 101)).isValid)
    XCTAssertFalse(AlbumDraft(name: "a", description: String(repeating: "b", count: 501)).isValid)
    let json = AlbumDraft(name: " Viaggi ", description: " Estate\n").json
    XCTAssertEqual(json["name"].map(string), "Viaggi")
    XCTAssertEqual(json["description"].map(string), "Estate")
  }

  func testAlbumRequests() async throws {
    let log = RequestLog()
    let session = StubProtocol.session { request in
      let path = request.url?.path ?? ""
      log.add("\(request.httpMethod ?? "") \(path)\(request.url?.query.map { "?\($0)" } ?? "")")
      switch (request.httpMethod, path) {
      case ("GET", "/api/v1/accounts/a1/albums"): return (200, "[\(AlbumsTests.album)]", [:])
      case ("POST", "/api/v1/albums"), ("PUT", "/api/v1/albums/al1"): return (200, AlbumsTests.album, [:])
      case ("GET", "/api/v1/albums/gone"): return (404, "{\"error\":\"Record not found\"}", [:])
      default: return (200, "{}", [:])
      }
    }
    let client = Client(server: URL(string: "https://x.test")!, token: "t", session: session)
    _ = try await client.albums(of: "a1")
    let own = try await client.albums(of: "a1", containing: "m1")
    XCTAssertEqual(own.first?.name, "Viaggi")
    _ = try await client.createAlbum(AlbumDraft(name: "Viaggi"))
    _ = try await client.updateAlbum("al1", AlbumDraft(name: "Viaggi"))
    try await client.deleteAlbum("al1")
    try await client.addMedia("m1", to: "al1")
    try await client.removeMedia("m1", from: "al1")
    do {
      _ = try await client.album("gone")
      XCTFail("expected an error")
    } catch {
      XCTAssertEqual(error as? APIError, .server(status: 404, message: "Record not found"))
    }
    XCTAssertEqual(log.lines, [
      "GET /api/v1/accounts/a1/albums",
      "GET /api/v1/accounts/a1/albums?media_id=m1",
      "POST /api/v1/albums",
      "PUT /api/v1/albums/al1",
      "DELETE /api/v1/albums/al1",
      "PUT /api/v1/albums/al1/media/m1",
      "DELETE /api/v1/albums/al1/media/m1",
      "GET /api/v1/albums/gone",
    ])
  }

  func testProfileMediaPagesByTheLastPost() async throws {
    let log = RequestLog()
    let session = StubProtocol.session { request in
      log.add(request.url?.query ?? "")
      let older = request.url?.query?.contains("max_id") == true
      return (200, older ? "[]" : "[\(Fixtures.status)]", [:])
    }
    let client = Client(server: URL(string: "https://x.test")!, token: "t", session: session)
    let first = try await client.media(of: "a1")
    XCTAssertEqual(first.items.map(\.id), ["m1"])
    XCTAssertEqual(first.next, [URLQueryItem(name: "max_id", value: "0192a000-0000-7000-8000-0000000000aa")])
    let second = try await client.media(of: "a1", query: first.next ?? [])
    XCTAssertTrue(second.items.isEmpty)
    XCTAssertNil(second.next)
    XCTAssertEqual(log.lines, [
      "only_media=true&limit=40",
      "only_media=true&limit=40&max_id=0192a000-0000-7000-8000-0000000000aa",
    ])
  }

  private func string(_ value: JSONValue) -> String? {
    if case .string(let s) = value { return s }
    return nil
  }
}

final class TranslationTests: XCTestCase {
  func testLanguageCodes() {
    XCTAssertEqual(Translations.baseLanguage("it-IT"), "it")
    XCTAssertEqual(Translations.baseLanguage("pt_BR"), "pt")
    XCTAssertEqual(Translations.baseLanguage("EN"), "en")
    XCTAssertNil(Translations.baseLanguage(""))
    XCTAssertNil(Translations.baseLanguage(nil))
    XCTAssertEqual(Translations.readerLanguage(preferred: ["es-ES", "en"]), "es")
    XCTAssertEqual(Translations.readerLanguage(preferred: []), "en")
  }

  func testWhenAPostCanBeTranslated() {
    let languages = ["it": ["en", "es"], "en": ["it"]]
    XCTAssertTrue(Translations.canTranslate(from: "it-IT", to: "en", languages: languages))
    XCTAssertTrue(Translations.canTranslate(from: "en", to: "it", languages: languages))
    XCTAssertFalse(Translations.canTranslate(from: "en", to: "es", languages: languages))
    XCTAssertFalse(Translations.canTranslate(from: "it", to: "it", languages: languages))
    XCTAssertFalse(Translations.canTranslate(from: nil, to: "en", languages: languages))
    XCTAssertFalse(Translations.canTranslate(from: "de", to: "en", languages: languages))
  }

  func testInstanceSaysWhetherTranslationIsOn() throws {
    let on = """
      {"domain":"x.test","title":"X","description":"","configuration":{"statuses":{"max_characters":500},
      "translation":{"enabled":true}}}
      """
    XCTAssertTrue(try Client.decoder.decode(Instance.self, from: Data(on.utf8)).translationEnabled)
    let old = """
      {"domain":"x.test","title":"X","description":"","configuration":{"statuses":{"max_characters":500}}}
      """
    XCTAssertFalse(try Client.decoder.decode(Instance.self, from: Data(old.utf8)).translationEnabled)
  }

  func testTranslateRequest() async throws {
    let session = StubProtocol.session { request in
      switch request.url?.path {
      case "/api/v1/statuses/s1/translate":
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        return (
          200,
          "{\"content\":\"<p>Tea or coffee?</p>\",\"spoiler_text\":\"\",\"detected_source_language\":\"it\",\"provider\":\"Bergamot\",\"poll\":null,\"media_attachments\":[]}",
          [:]
        )
      case "/api/v1/statuses/s2/translate":
        return (422, "{\"error\":\"Translation is not available\"}", [:])
      case "/api/v1/instance/translation_languages":
        return (200, "{\"it\":[\"en\",\"es\"],\"en\":[\"it\"]}", [:])
      default:
        return (404, "{}", [:])
      }
    }
    let client = Client(server: URL(string: "https://x.test")!, token: "t", session: session)
    let translation = try await client.translate("s1", to: "en")
    XCTAssertEqual(translation.content, "<p>Tea or coffee?</p>")
    XCTAssertEqual(translation.detectedSourceLanguage, "it")
    XCTAssertEqual(translation.provider, "Bergamot")
    let languages = try await client.translationLanguages()
    XCTAssertEqual(languages["it"], ["en", "es"])
    do {
      _ = try await client.translate("s2")
      XCTFail("expected an error")
    } catch {
      XCTAssertEqual(error as? APIError, .server(status: 422, message: "Translation is not available"))
    }
  }

  func testTranslateBody() throws {
    let encode = { (language: String?) in
      String(decoding: try JSONEncoder().encode(Client.translationBody(language)), as: UTF8.self)
    }
    XCTAssertEqual(try encode("en"), "{\"lang\":\"en\"}")
    XCTAssertEqual(try encode(nil), "{}")
  }
}

/** Requests seen by a stub session, in order. */
final class RequestLog: @unchecked Sendable {
  private let lock = NSLock()
  private var seen: [String] = []

  func add(_ line: String) {
    lock.lock()
    seen.append(line)
    lock.unlock()
  }

  var lines: [String] {
    lock.lock()
    defer { lock.unlock() }
    return seen
  }
}
