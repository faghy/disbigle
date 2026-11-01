import Foundation
import XCTest

@testable import DisbigleKit

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class ReactionsTests: XCTestCase {
  func testWhoLikedAndResharedAPost() async throws {
    let log = RequestLog()
    let session = StubProtocol.session { request in
      let path = request.url?.path ?? ""
      log.add("\(request.httpMethod ?? "") \(path)\(request.url?.query.map { "?\($0)" } ?? "")")
      switch path {
      case "/api/v1/statuses/s1/favourited_by":
        if request.url?.query == nil {
          return (
            200, "[\(Fixtures.account)]",
            ["Link": "<https://x.test/api/v1/statuses/s1/favourited_by?max_id=l1>; rel=\"next\""]
          )
        }
        return (200, "[]", [:])
      case "/api/v1/statuses/s1/reblogged_by":
        return (200, "[\(Fixtures.account)]", [:])
      default:
        return (404, "{\"error\":\"Record not found\"}", [:])
      }
    }
    let client = Client(server: URL(string: "https://x.test")!, token: "t", session: session)

    let likes = try await client.accounts(.likes, on: "s1")
    XCTAssertEqual(likes.items.map(\.acct), ["faghy"])
    XCTAssertEqual(likes.next, [URLQueryItem(name: "max_id", value: "l1")])
    let more = try await client.accounts(.likes, on: "s1", query: likes.next ?? [])
    XCTAssertTrue(more.items.isEmpty)
    XCTAssertNil(more.next)

    let reshares = try await client.accounts(.reshares, on: "s1")
    XCTAssertEqual(reshares.items.first?.name, "Faghy")
    XCTAssertNil(reshares.next)

    do {
      _ = try await client.accounts(.likes, on: "gone")
      XCTFail("expected an error")
    } catch {
      XCTAssertEqual(error as? APIError, .server(status: 404, message: "Record not found"))
    }
    XCTAssertEqual(log.lines, [
      "GET /api/v1/statuses/s1/favourited_by",
      "GET /api/v1/statuses/s1/favourited_by?max_id=l1",
      "GET /api/v1/statuses/s1/reblogged_by",
      "GET /api/v1/statuses/gone/favourited_by",
    ])
  }
}
