import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public enum APIError: Error, LocalizedError, Equatable {
  /** The server answered with an error (`{"error": "..."}` on Mastodon-style APIs). */
  case server(status: Int, message: String)
  /** The token was refused: the person must sign in again. */
  case unauthorized
  case invalidResponse

  public var errorDescription: String? {
    switch self {
    case .server(_, let message): message
    case .unauthorized: localized("session.ended")
    case .invalidResponse: localized("response.unexpected")
    }
  }
}

func localized(_ key: String) -> String {
  NSLocalizedString(key, bundle: .module, comment: "")
}

/** One page of a list, with the cursors of the `Link` header. */
public struct Page<Item: Sendable>: Sendable {
  public let items: [Item]
  /** Query for the next (older) page, if any. */
  public let next: [URLQueryItem]?
}

/** Sends requests to a server's Mastodon-compatible API with an access token. */
public final class Client: Sendable {
  public let server: URL
  let token: String?
  let session: URLSession

  public init(server: URL, token: String? = nil, session: URLSession = .shared) {
    self.server = server
    self.token = token
    self.session = session
  }

  public static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    decoder.dateDecodingStrategy = .custom { decoder in
      let text = try decoder.singleValueContainer().decode(String.self)
      if let date = parseDate(text) { return date }
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Not a date: \(text)"))
    }
    return decoder
  }()

  /** ISO 8601 with or without fractional seconds. */
  static func parseDate(_ text: String) -> Date? {
    let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    let plain = Date.ISO8601FormatStyle()
    return (try? withFraction.parse(text)) ?? (try? plain.parse(text))
  }

  // MARK: Requests

  public enum Body: Sendable {
    case json([String: JSONValue])
    case form([URLQueryItem])
    case multipart(Multipart)
  }

  func request(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Body? = nil
  ) throws -> URLRequest {
    var components = URLComponents(
      url: server.appending(path: path), resolvingAgainstBaseURL: false)
    if !query.isEmpty { components?.queryItems = query }
    guard let url = components?.url else { throw APIError.invalidResponse }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    switch body {
    case .json(let object):
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONEncoder().encode(object)
    case .form(let items):
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      request.httpBody = formEncode(items).data(using: .utf8)
    case .multipart(let form):
      request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
      request.httpBody = form.data
    case nil:
      break
    }
    return request
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
    if http.statusCode == 401 { throw APIError.unauthorized }
    guard (200..<300).contains(http.statusCode) else {
      let message =
        (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
      throw APIError.server(status: http.statusCode, message: message)
    }
    return (data, http)
  }

  public func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
    try await call("GET", path, query: query)
  }

  public func call<T: Decodable>(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Body? = nil
  ) async throws -> T {
    let (data, _) = try await send(try request(method, path, query: query, body: body))
    return try Self.decoder.decode(T.self, from: data)
  }

  /** A request whose answer is not needed. */
  public func perform(
    _ method: String, _ path: String, query: [URLQueryItem] = [], body: Body? = nil
  ) async throws {
    _ = try await send(try request(method, path, query: query, body: body))
  }

  public func page<T: Decodable & Sendable>(
    _ path: String, query: [URLQueryItem] = []
  ) async throws -> Page<T> {
    let (data, response) = try await send(try request("GET", path, query: query))
    let items = try Self.decoder.decode([T].self, from: data)
    let next = LinkHeader.next(response.value(forHTTPHeaderField: "Link"))
    return Page(items: items, next: items.isEmpty ? nil : next)
  }

  private struct ErrorBody: Decodable { let error: String }
}

func formEncode(_ items: [URLQueryItem]) -> String {
  var allowed = CharacterSet.alphanumerics
  allowed.insert(charactersIn: "-._~")
  return items.map { item in
    let name = item.name.addingPercentEncoding(withAllowedCharacters: allowed) ?? item.name
    let value = (item.value ?? "").addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    return "\(name)=\(value)"
  }.joined(separator: "&")
}

/** A JSON value for request bodies. */
public enum JSONValue: Encodable, Sendable, ExpressibleByStringLiteral, ExpressibleByBooleanLiteral,
  ExpressibleByIntegerLiteral, ExpressibleByArrayLiteral, ExpressibleByNilLiteral
{
  case string(String), bool(Bool), int(Int), array([JSONValue]), object([String: JSONValue]), null

  public init(stringLiteral value: String) { self = .string(value) }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(integerLiteral value: Int) { self = .int(value) }
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
  public init(nilLiteral: ()) { self = .null }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let v): try container.encode(v)
    case .bool(let v): try container.encode(v)
    case .int(let v): try container.encode(v)
    case .array(let v): try container.encode(v)
    case .object(let v): try container.encode(v)
    case .null: try container.encodeNil()
    }
  }
}

/** Reads the `rel="next"` cursor of a Mastodon `Link` header. */
enum LinkHeader {
  static func next(_ header: String?) -> [URLQueryItem]? {
    guard let header else { return nil }
    for part in header.split(separator: ",") {
      let pieces = part.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
      guard pieces.count >= 2, pieces.dropFirst().contains(where: { $0 == "rel=\"next\"" }),
        pieces[0].hasPrefix("<"), pieces[0].hasSuffix(">")
      else { continue }
      let link = String(pieces[0].dropFirst().dropLast())
      return URLComponents(string: link)?.queryItems
    }
    return nil
  }
}

/** A multipart/form-data body (for media uploads). */
public struct Multipart: Sendable {
  public let boundary = "disbigle-\(UUID().uuidString)"
  public private(set) var data = Data()

  public init() {}

  public var contentType: String { "multipart/form-data; boundary=\(boundary)" }

  public mutating func add(name: String, value: String) {
    data.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
    data.append(Data("\(value)\r\n".utf8))
  }

  public mutating func add(name: String, filename: String, mimeType: String, content: Data) {
    data.append(
      Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\nContent-Type: \(mimeType)\r\n\r\n"
          .utf8))
    data.append(content)
    data.append(Data("\r\n".utf8))
  }

  /** The body with its closing boundary. */
  public func finished() -> Multipart {
    var copy = self
    copy.data.append(Data("--\(boundary)--\r\n".utf8))
    return copy
  }
}
