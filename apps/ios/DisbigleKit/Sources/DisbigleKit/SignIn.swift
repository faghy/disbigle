import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/**
 * OAuth sign-in on a Disbigle server (authorization code with PKCE), as Mastodon apps do:
 * register the app, open `authorizeURL` in a web session, then `exchange` the returned code.
 */
public struct SignIn: Sendable {
  public static let redirectURI = "disbigle://oauth"
  public static let scopes = "read write follow push"
  public static let appName = "Disbigle for iOS"
  public static let website = "https://disbigle.com"

  public let server: URL
  public let app: RegisteredApp
  public let verifier: String
  public let state: String

  /** Registers the app on the server and prepares a sign-in. */
  public static func start(on server: URL, session: URLSession = .shared) async throws -> SignIn {
    let client = Client(server: server, session: session)
    let app: RegisteredApp = try await client.call(
      "POST", "api/v1/apps",
      body: .form([
        URLQueryItem(name: "client_name", value: appName),
        URLQueryItem(name: "redirect_uris", value: redirectURI),
        URLQueryItem(name: "scopes", value: scopes),
        URLQueryItem(name: "website", value: website),
      ]))
    return SignIn(server: server, app: app, verifier: randomToken(), state: randomToken())
  }

  public init(server: URL, app: RegisteredApp, verifier: String, state: String) {
    self.server = server
    self.app = app
    self.verifier = verifier
    self.state = state
  }

  public var authorizeURL: URL {
    var components = URLComponents(
      url: server.appending(path: "oauth/authorize"), resolvingAgainstBaseURL: false)!
    components.queryItems = [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: app.clientId),
      URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
      URLQueryItem(name: "scope", value: Self.scopes),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "code_challenge", value: Self.challenge(for: verifier)),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
    ]
    return components.url!
  }

  public enum Failure: Error, Equatable {
    /** The callback is not ours, or its state does not match (a forged redirect). */
    case badCallback
    /** The person refused the authorization. */
    case denied
  }

  /** The authorization code carried by the callback URL. */
  public func code(from callback: URL) throws -> String {
    guard callback.absoluteString.hasPrefix(Self.redirectURI),
      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
    else { throw Failure.badCallback }
    let value = { (name: String) in items.first { $0.name == name }?.value }
    if value("error") != nil { throw Failure.denied }
    guard value("state") == state, let code = value("code"), !code.isEmpty else {
      throw Failure.badCallback
    }
    return code
  }

  /** Trades the code for an access token. */
  public func exchange(code: String, session: URLSession = .shared) async throws -> Token {
    try await Client(server: server, session: session).call(
      "POST", "oauth/token",
      body: .form([
        URLQueryItem(name: "grant_type", value: "authorization_code"),
        URLQueryItem(name: "code", value: code),
        URLQueryItem(name: "client_id", value: app.clientId),
        URLQueryItem(name: "client_secret", value: app.clientSecret),
        URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
        URLQueryItem(name: "code_verifier", value: verifier),
      ]))
  }

  /** Revokes a token (sign-out). */
  public static func revoke(
    _ token: String, on server: URL, app: RegisteredApp, session: URLSession = .shared
  ) async throws {
    try await Client(server: server, session: session).perform(
      "POST", "oauth/revoke",
      body: .form([
        URLQueryItem(name: "token", value: token),
        URLQueryItem(name: "client_id", value: app.clientId),
        URLQueryItem(name: "client_secret", value: app.clientSecret),
      ]))
  }

  /** PKCE S256 challenge: base64url(SHA-256(verifier)). */
  static func challenge(for verifier: String) -> String {
    base64URL(Data(SHA256.hash(Array(verifier.utf8))))
  }

  static func randomToken() -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    return base64URL(Data(bytes))
  }

  static func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /** The server address someone typed: a domain or a URL, always https. */
  public static func serverURL(from input: String) -> URL? {
    var text = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if text.hasPrefix("@"), let at = text.lastIndex(of: "@"), at != text.startIndex {
      text = String(text[text.index(after: at)...])  // @user@domain
    }
    if !text.contains("://") { text = "https://\(text)" }
    guard var components = URLComponents(string: text), let host = components.host,
      host.contains("."), !host.contains(" ")
    else { return nil }
    components.scheme = "https"
    components.path = ""
    components.query = nil
    components.fragment = nil
    return components.url
  }
}

/** SHA-256 (FIPS 180-4), for PKCE: CryptoKit is not available on every platform we build on. */
enum SHA256 {
  private static let k: [UInt32] = [
    0x428a_2f98, 0x7137_4491, 0xb5c0_fbcf, 0xe9b5_dba5, 0x3956_c25b, 0x59f1_11f1, 0x923f_82a4,
    0xab1c_5ed5, 0xd807_aa98, 0x1283_5b01, 0x2431_85be, 0x550c_7dc3, 0x72be_5d74, 0x80de_b1fe,
    0x9bdc_06a7, 0xc19b_f174, 0xe49b_69c1, 0xefbe_4786, 0x0fc1_9dc6, 0x240c_a1cc, 0x2de9_2c6f,
    0x4a74_84aa, 0x5cb0_a9dc, 0x76f9_88da, 0x983e_5152, 0xa831_c66d, 0xb003_27c8, 0xbf59_7fc7,
    0xc6e0_0bf3, 0xd5a7_9147, 0x06ca_6351, 0x1429_2967, 0x27b7_0a85, 0x2e1b_2138, 0x4d2c_6dfc,
    0x5338_0d13, 0x650a_7354, 0x766a_0abb, 0x81c2_c92e, 0x9272_2c85, 0xa2bf_e8a1, 0xa81a_664b,
    0xc24b_8b70, 0xc76c_51a3, 0xd192_e819, 0xd699_0624, 0xf40e_3585, 0x106a_a070, 0x19a4_c116,
    0x1e37_6c08, 0x2748_774c, 0x34b0_bcb5, 0x391c_0cb3, 0x4ed8_aa4a, 0x5b9c_ca4f, 0x682e_6ff3,
    0x748f_82ee, 0x78a5_636f, 0x84c8_7814, 0x8cc7_0208, 0x90be_fffa, 0xa450_6ceb, 0xbef9_a3f7,
    0xc671_78f2,
  ]

  static func hash(_ message: [UInt8]) -> [UInt8] {
    var h: [UInt32] = [
      0x6a09_e667, 0xbb67_ae85, 0x3c6e_f372, 0xa54f_f53a, 0x510e_527f, 0x9b05_688c, 0x1f83_d9ab,
      0x5be0_cd19,
    ]
    var data = message
    let bitLength = UInt64(message.count) * 8
    data.append(0x80)
    while data.count % 64 != 56 { data.append(0) }
    for shift in stride(from: 56, through: 0, by: -8) { data.append(UInt8(truncatingIfNeeded: bitLength >> UInt64(shift))) }

    func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }
    var w = [UInt32](repeating: 0, count: 64)
    for chunk in stride(from: 0, to: data.count, by: 64) {
      for i in 0..<16 {
        let j = chunk + i * 4
        w[i] = UInt32(data[j]) << 24 | UInt32(data[j + 1]) << 16 | UInt32(data[j + 2]) << 8 | UInt32(data[j + 3])
      }
      for i in 16..<64 {
        let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
        let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
        w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
      }
      var (a, b, c, d, e, f, g, hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7])
      for i in 0..<64 {
        let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
        let ch = (e & f) ^ (~e & g)
        let t1 = hh &+ s1 &+ ch &+ k[i] &+ w[i]
        let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        let maj = (a & b) ^ (a & c) ^ (b & c)
        let t2 = s0 &+ maj
        (hh, g, f, e, d, c, b, a) = (g, f, e, d &+ t1, c, b, a, t1 &+ t2)
      }
      h[0] = h[0] &+ a; h[1] = h[1] &+ b; h[2] = h[2] &+ c; h[3] = h[3] &+ d
      h[4] = h[4] &+ e; h[5] = h[5] &+ f; h[6] = h[6] &+ g; h[7] = h[7] &+ hh
    }
    return h.flatMap { word in (0..<4).map { UInt8(truncatingIfNeeded: word >> UInt32(24 - $0 * 8)) } }
  }
}
