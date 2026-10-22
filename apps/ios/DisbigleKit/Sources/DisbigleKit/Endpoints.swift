import Foundation

public enum Timeline: Hashable, Sendable {
  case home
  /** Public posts of this server. */
  case local
  /** Public posts of every server this one knows. */
  case federated
  case tag(String)
  /** An aspect (a list in the API). */
  case aspect(String)

  var path: String {
    switch self {
    case .home: "api/v1/timelines/home"
    case .local, .federated: "api/v1/timelines/public"
    case .tag(let name): "api/v1/timelines/tag/\(name)"
    case .aspect(let id): "api/v1/timelines/list/\(id)"
    }
  }

  var query: [URLQueryItem] {
    self == .local ? [URLQueryItem(name: "local", value: "true")] : []
  }
}

/** What a new post (or an edit) contains. */
public struct PostDraft: Sendable {
  public var text: String
  public var visibility: Visibility
  public var spoilerText: String
  public var sensitive: Bool
  public var inReplyToId: String?
  public var mediaIds: [String]
  public var poll: PollDraft?
  /** Aspects to share with (Disbigle extension; the visibility is then `private`). */
  public var aspectIds: [String]

  public init(
    text: String = "", visibility: Visibility = .public, spoilerText: String = "",
    sensitive: Bool = false, inReplyToId: String? = nil, mediaIds: [String] = [],
    poll: PollDraft? = nil, aspectIds: [String] = []
  ) {
    self.text = text
    self.visibility = visibility
    self.spoilerText = spoilerText
    self.sensitive = sensitive
    self.inReplyToId = inReplyToId
    self.mediaIds = mediaIds
    self.poll = poll
    self.aspectIds = aspectIds
  }

  public struct PollDraft: Sendable, Equatable {
    public var options: [String]
    public var expiresIn: Int
    public var multiple: Bool

    public init(options: [String], expiresIn: Int, multiple: Bool) {
      self.options = options
      self.expiresIn = expiresIn
      self.multiple = multiple
    }
  }

  var json: [String: JSONValue] {
    var body: [String: JSONValue] = [
      "status": .string(text),
      "spoiler_text": .string(spoilerText),
      "sensitive": .bool(sensitive),
      "media_ids": .array(mediaIds.map(JSONValue.string)),
    ]
    if aspectIds.isEmpty {
      body["visibility"] = .string(visibility.rawValue)
    } else {
      body["visibility"] = "limited"
      body["aspect_ids"] = .array(aspectIds.map(JSONValue.string))
    }
    if let inReplyToId { body["in_reply_to_id"] = .string(inReplyToId) }
    if let poll {
      body["poll"] = .object([
        "options": .array(poll.options.map(JSONValue.string)),
        "expires_in": .int(poll.expiresIn),
        "multiple": .bool(poll.multiple),
      ])
    }
    return body
  }
}

extension Client {
  // MARK: Timelines and posts

  public func timeline(_ timeline: Timeline, query: [URLQueryItem] = []) async throws -> Page<Status> {
    try await page(timeline.path, query: timeline.query + query)
  }

  public func status(_ id: String) async throws -> Status {
    try await get("api/v1/statuses/\(id)")
  }

  public func context(of id: String) async throws -> StatusContext {
    try await get("api/v1/statuses/\(id)/context")
  }

  public enum Action: String, Sendable {
    case favourite, unfavourite, reblog, unreblog, bookmark, unbookmark, pin, unpin
  }

  /** Likes, reshares, bookmarks or pins a post (or undoes it); returns the updated post. */
  public func act(_ action: Action, on id: String) async throws -> Status {
    try await call("POST", "api/v1/statuses/\(id)/\(action.rawValue)")
  }

  public func publish(_ draft: PostDraft, idempotencyKey: String = UUID().uuidString) async throws -> Status {
    var request = try request("POST", "api/v1/statuses", body: .json(draft.json))
    request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
    let (data, _) = try await send(request)
    return try Self.decoder.decode(Status.self, from: data)
  }

  /**
   * Edits a post. As on Mastodon the draft describes the whole post: attachments and a poll
   * left out are removed.
   */
  public func edit(_ id: String, _ draft: PostDraft) async throws -> Status {
    var body = draft.json
    body.removeValue(forKey: "visibility")
    body.removeValue(forKey: "in_reply_to_id")
    body.removeValue(forKey: "aspect_ids")
    return try await call("PUT", "api/v1/statuses/\(id)", body: .json(body))
  }

  /** The markdown source of one of your posts, to edit it. */
  public func source(of id: String) async throws -> String {
    struct Source: Decodable { let text: String }
    let source: Source = try await get("api/v1/statuses/\(id)/source")
    return source.text
  }

  public func delete(_ id: String) async throws {
    try await perform("DELETE", "api/v1/statuses/\(id)")
  }

  public func vote(in pollId: String, choices: [Int]) async throws -> Poll {
    try await call(
      "POST", "api/v1/polls/\(pollId)/votes",
      body: .json(["choices": .array(choices.map(JSONValue.int))]))
  }

  public func upload(
    _ data: Data, filename: String, mimeType: String, description: String = ""
  ) async throws -> MediaAttachment {
    var form = Multipart()
    if !description.isEmpty { form.add(name: "description", value: description) }
    form.add(name: "file", filename: filename, mimeType: mimeType, content: data)
    return try await call("POST", "api/v2/media", body: .multipart(form.finished()))
  }

  // MARK: Notifications and messages

  public func notifications(query: [URLQueryItem] = []) async throws -> Page<Notification> {
    try await page("api/v1/notifications", query: query)
  }

  public func conversations(query: [URLQueryItem] = []) async throws -> Page<Conversation> {
    try await page("api/v1/conversations", query: query)
  }

  public func markRead(conversation id: String) async throws {
    try await perform("POST", "api/v1/conversations/\(id)/read")
  }

  // MARK: Accounts

  public func me() async throws -> Account {
    try await get("api/v1/accounts/verify_credentials")
  }

  public func account(_ id: String) async throws -> Account {
    try await get("api/v1/accounts/\(id)")
  }

  public func statuses(of accountId: String, query: [URLQueryItem] = []) async throws -> Page<Status> {
    try await page("api/v1/accounts/\(accountId)/statuses", query: query)
  }

  public func relationship(with accountId: String) async throws -> Relationship? {
    let list: [Relationship] = try await get(
      "api/v1/accounts/relationships", query: [URLQueryItem(name: "id[]", value: accountId)])
    return list.first
  }

  public func follow(_ accountId: String) async throws -> Relationship {
    try await call("POST", "api/v1/accounts/\(accountId)/follow")
  }

  public func unfollow(_ accountId: String) async throws -> Relationship {
    try await call("POST", "api/v1/accounts/\(accountId)/unfollow")
  }

  public func aspects() async throws -> [AspectList] {
    try await get("api/v1/lists")
  }

  public func search(_ query: String) async throws -> SearchResults {
    try await get(
      "api/v2/search",
      query: [URLQueryItem(name: "q", value: query), URLQueryItem(name: "resolve", value: "true")])
  }

  public func instance() async throws -> Instance {
    try await get("api/v2/instance")
  }
}
