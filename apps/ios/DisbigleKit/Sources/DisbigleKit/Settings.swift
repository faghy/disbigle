import Foundation

/** The editable profile (`PATCH /api/v1/accounts/update_credentials`). */
public struct ProfileDraft: Sendable, Equatable {
  public var displayName: String
  /** Plain text: the server turns it into HTML. */
  public var note: String
  public var fields: [Account.Field]
  /** Followers need approval. */
  public var locked: Bool
  public var bot: Bool
  public var discoverable: Bool
  /** Language of the emails and notifications the server sends (en or it). */
  public var language: String?
  public var avatar: Upload?
  public var header: Upload?

  public struct Upload: Sendable, Equatable {
    public let data: Data
    public let mimeType: String

    public init(data: Data, mimeType: String) {
      self.data = data
      self.mimeType = mimeType
    }
  }

  public init(account: CredentialAccount) {
    displayName = account.displayName
    note = account.source?.note ?? RichText.plain(account.note)
    fields = account.source?.fields ?? []
    locked = account.locked
    bot = account.bot
    discoverable = account.discoverable ?? true
    language = account.source?.language
  }

  var multipart: Multipart {
    var form = Multipart()
    form.add(name: "display_name", value: displayName)
    form.add(name: "note", value: note)
    form.add(name: "locked", value: String(locked))
    form.add(name: "bot", value: String(bot))
    form.add(name: "discoverable", value: String(discoverable))
    let kept = fields.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
    // Every slot is sent, so fields removed here are removed on the server too.
    for index in 0..<4 {
      let field = index < kept.count ? kept[index] : Account.Field(name: "", value: "")
      form.add(name: "fields_attributes[\(index)][name]", value: field.name)
      form.add(name: "fields_attributes[\(index)][value]", value: field.value)
    }
    if let language { form.add(name: "source[language]", value: language) }
    if let avatar {
      form.add(name: "avatar", filename: "avatar.jpg", mimeType: avatar.mimeType, content: avatar.data)
    }
    if let header {
      form.add(name: "header", filename: "header.jpg", mimeType: header.mimeType, content: header.data)
    }
    return form.finished()
  }
}

/** The signed-in account with what only its owner sees (`verify_credentials`). */
public struct CredentialAccount: Codable, Sendable {
  public let id: String
  public let displayName: String
  public let note: String
  public let locked: Bool
  public let bot: Bool
  public let discoverable: Bool?
  public let source: Source?

  public struct Source: Codable, Sendable {
    public let note: String?
    public let fields: [Account.Field]?
    public let language: String?
    public let followRequestsCount: Int?
  }
}

extension Client {
  public func credentials() async throws -> CredentialAccount {
    try await get("api/v1/accounts/verify_credentials")
  }

  public func updateProfile(_ draft: ProfileDraft) async throws -> Account {
    try await call("PATCH", "api/v1/accounts/update_credentials", body: .multipart(draft.multipart))
  }

  // MARK: People

  public enum AccountList: String, Sendable {
    case blocks, mutes
    case followRequests = "follow_requests"
  }

  public func accounts(_ list: AccountList, query: [URLQueryItem] = []) async throws -> Page<Account> {
    try await page("api/v1/\(list.rawValue)", query: query)
  }

  public enum AccountAction: String, Sendable {
    case block, unblock, mute, unmute
  }

  public func act(_ action: AccountAction, on accountId: String) async throws -> Relationship {
    try await call("POST", "api/v1/accounts/\(accountId)/\(action.rawValue)")
  }

  public func answerFollowRequest(from accountId: String, accept: Bool) async throws {
    try await perform("POST", "api/v1/follow_requests/\(accountId)/\(accept ? "authorize" : "reject")")
  }

  // MARK: Saved posts

  public func bookmarks(query: [URLQueryItem] = []) async throws -> Page<Status> {
    try await page("api/v1/bookmarks", query: query)
  }

  public func favourites(query: [URLQueryItem] = []) async throws -> Page<Status> {
    try await page("api/v1/favourites", query: query)
  }

  // MARK: Aspects (lists)

  public func createAspect(_ title: String) async throws -> AspectList {
    try await call("POST", "api/v1/lists", body: .json(["title": .string(title)]))
  }

  public func renameAspect(_ id: String, to title: String) async throws -> AspectList {
    try await call("PUT", "api/v1/lists/\(id)", body: .json(["title": .string(title)]))
  }

  public func deleteAspect(_ id: String) async throws {
    try await perform("DELETE", "api/v1/lists/\(id)")
  }

  public func members(of aspectId: String) async throws -> [Account] {
    try await get("api/v1/lists/\(aspectId)/accounts", query: [URLQueryItem(name: "limit", value: "0")])
  }

  /** The aspects of yours this account is in. */
  public func aspects(containing accountId: String) async throws -> [AspectList] {
    try await get("api/v1/accounts/\(accountId)/lists")
  }

  public func addMember(_ accountId: String, to aspectId: String) async throws {
    try await perform(
      "POST", "api/v1/lists/\(aspectId)/accounts",
      body: .json(["account_ids": .array([.string(accountId)])]))
  }

  public func removeMember(_ accountId: String, from aspectId: String) async throws {
    try await perform(
      "DELETE", "api/v1/lists/\(aspectId)/accounts",
      body: .json(["account_ids": .array([.string(accountId)])]))
  }

  // MARK: Read markers

  /** The last notification read (on any device), or nil. */
  public func notificationsReadMarker() async throws -> String? {
    struct Marker: Decodable { let lastReadId: String }
    let markers: [String: Marker] = try await get(
      "api/v1/markers", query: [URLQueryItem(name: "timeline[]", value: "notifications")])
    return markers["notifications"]?.lastReadId
  }

  public func markNotificationsRead(upTo id: String) async throws {
    try await perform(
      "POST", "api/v1/markers",
      body: .json(["notifications": .object(["last_read_id": .string(id)])]))
  }
}
