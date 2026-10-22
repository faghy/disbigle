import DisbigleKit
import Foundation
import Observation
import Security

/** A signed-in account: where it lives and the token the app was given. */
struct StoredSession: Codable, Equatable {
  var server: URL
  var token: String
  var clientId: String
  var clientSecret: String
}

/** What the compose sheet is for. */
enum ComposeTarget: Identifiable {
  case new
  case reply(Status)
  case edit(Status)

  var id: String {
    switch self {
    case .new: "new"
    case .reply(let status): "reply-\(status.id)"
    case .edit(let status): "edit-\(status.id)"
    }
  }
}

@MainActor @Observable
final class AppModel {
  static let defaultServer = "app.disbigle.com"

  private(set) var session: StoredSession?
  private(set) var me: Account?
  private(set) var instance: Instance?
  var composing: ComposeTarget?
  /** The last post published or edited from this app, for lists to show at once. */
  private(set) var lastSaved: Status?

  var client: Client? {
    session.map { Client(server: $0.server, token: $0.token) }
  }

  init() {
    session = Keychain.load()
    #if DEBUG
      // Screenshots and UI checks: `-DisbigleServer <url> -DisbigleToken <token>` signs in
      // without the web page (and without touching the Keychain).
      let defaults = UserDefaults.standard
      if let server = defaults.string(forKey: "DisbigleServer").flatMap(URL.init(string:)),
        let token = defaults.string(forKey: "DisbigleToken")
      {
        session = StoredSession(server: server, token: token, clientId: "", clientSecret: "")
      }
    #endif
  }

  /** The screen to open first (Debug builds, `-DisbigleScreen <name>`), for screenshots. */
  var debugScreen: String? {
    #if DEBUG
      UserDefaults.standard.string(forKey: "DisbigleScreen")
    #else
      nil
    #endif
  }

  /** Loads the account and the server limits; signs out if the token was revoked. */
  func refresh() async {
    guard let client else { return }
    do {
      me = try await client.me()
      instance = try? await client.instance()
    } catch APIError.unauthorized {
      forget()
    } catch {
      // Offline or server down: keep the session, the lists show the error.
    }
  }

  /** Runs the OAuth sign-in in a web session; `authenticate` opens the page and returns the callback. */
  func signIn(server input: String, authenticate: (URL) async throws -> URL) async throws {
    guard let server = SignIn.serverURL(from: input) else { throw SignInError.badAddress }
    let signIn = try await SignIn.start(on: server)
    let callback = try await authenticate(signIn.authorizeURL)
    let token = try await signIn.exchange(code: try signIn.code(from: callback))
    let stored = StoredSession(
      server: server, token: token.accessToken, clientId: signIn.app.clientId,
      clientSecret: signIn.app.clientSecret)
    Keychain.save(stored)
    session = stored
    await refresh()
  }

  func signOut() async {
    if let session {
      try? await SignIn.revoke(
        session.token, on: session.server,
        app: RegisteredApp(clientId: session.clientId, clientSecret: session.clientSecret))
    }
    forget()
  }

  private func forget() {
    Keychain.delete()
    session = nil
    me = nil
    instance = nil
  }

  func saved(_ status: Status) {
    lastSaved = status
  }

  enum SignInError: LocalizedError {
    case badAddress

    var errorDescription: String? {
      String(localized: "That doesn't look like a server address.")
    }
  }
}

/** The session in the Keychain, readable only on this device once it has been unlocked. */
enum Keychain {
  private static let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.disbigle.app",
    kSecAttrAccount as String: "session",
  ]

  static func load() -> StoredSession? {
    var search = query
    search[kSecReturnData as String] = true
    search[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return try? JSONDecoder().decode(StoredSession.self, from: data)
  }

  static func save(_ session: StoredSession) {
    guard let data = try? JSONEncoder().encode(session) else { return }
    delete()
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }

  static func delete() {
    SecItemDelete(query as CFDictionary)
  }
}
