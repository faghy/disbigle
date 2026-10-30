import Foundation

// Pictures of a profile and photo albums. Albums are a Disbigle extension of the Mastodon
// API, for accounts of the same server only.

/** A photo or video of a profile, with the post it belongs to. */
public struct MediaItem: Codable, Hashable, Identifiable, Sendable {
  public let mediaAttachment: MediaAttachment
  public let statusId: String
  /** The post is marked sensitive: the thumbnail stays blurred. */
  public let sensitive: Bool
  public let createdAt: Date

  public var id: String { mediaAttachment.id }

  public init(mediaAttachment: MediaAttachment, statusId: String, sensitive: Bool, createdAt: Date) {
    self.mediaAttachment = mediaAttachment
    self.statusId = statusId
    self.sensitive = sensitive
    self.createdAt = createdAt
  }

  /** The thumbnail to show (the preview, or the file itself). */
  public var thumbnailURL: URL? {
    URL(string: mediaAttachment.previewUrl.flatMap { $0.isEmpty ? nil : $0 } ?? mediaAttachment.url)
  }

  /** The photos and videos of some posts, in their order (reshares are left out). */
  public static func items(of statuses: [Status]) -> [MediaItem] {
    statuses.filter { $0.reblog == nil }.flatMap { status in
      status.mediaAttachments
        .filter { [.image, .gifv, .video].contains($0.type) }
        .map {
          MediaItem(
            mediaAttachment: $0, statusId: status.id, sensitive: status.sensitive,
            createdAt: status.createdAt)
        }
    }
  }
}

public struct Album: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let accountId: String
  public let name: String
  public let description: String?
  public let mediaCount: Int
  public let cover: MediaAttachment?
  public let updatedAt: Date
  /** Whether it holds the attachment asked about (`media_id`, own albums only). */
  public let includes: Bool?
}

/** An album with its owner and its pictures, latest addition first. */
public struct AlbumDetail: Decodable, Sendable {
  public let album: Album
  public let account: Account
  public let items: [MediaItem]

  private enum CodingKeys: String, CodingKey { case account, items }

  public init(from decoder: Decoder) throws {
    album = try Album(from: decoder)
    let container = try decoder.container(keyedBy: CodingKeys.self)
    account = try container.decode(Account.self, forKey: .account)
    items = try container.decode([MediaItem].self, forKey: .items)
  }
}

/** Name and description of a new or edited album. */
public struct AlbumDraft: Sendable, Equatable {
  public static let maxName = 100
  public static let maxDescription = 500

  public var name: String
  public var description: String

  public init(name: String = "", description: String = "") {
    self.name = name
    self.description = description
  }

  public init(album: Album) {
    self.init(name: album.name, description: album.description ?? "")
  }

  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  /** A name is required; both have a length limit. */
  public var isValid: Bool {
    !trimmedName.isEmpty && trimmedName.count <= Self.maxName
      && description.count <= Self.maxDescription
  }

  var json: [String: JSONValue] {
    [
      "name": .string(trimmedName),
      "description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
    ]
  }
}

extension Client {
  // MARK: Profile media and albums

  /** One page of the photos and videos of an account, newest first. */
  public func media(of accountId: String, query: [URLQueryItem] = []) async throws -> Page<MediaItem> {
    var cursor = query
    // A page of posts can hold no photo or video (only audio): look further, a few times.
    for _ in 0..<3 {
      let page: Page<Status> = try await statuses(
        of: accountId, query: Self.mediaQuery + cursor.filter { $0.name == "max_id" })
      guard let last = page.items.last else { return Page(items: [], next: nil) }
      cursor = [URLQueryItem(name: "max_id", value: last.id)]
      let items = MediaItem.items(of: page.items)
      if !items.isEmpty { return Page(items: items, next: cursor) }
    }
    return Page(items: [], next: cursor)
  }

  static let mediaQuery = [
    URLQueryItem(name: "only_media", value: "true"), URLQueryItem(name: "limit", value: "40"),
  ]

  /** The albums of an account; with `mediaId` (own account) each says if it holds that attachment. */
  public func albums(of accountId: String, containing mediaId: String? = nil) async throws -> [Album] {
    try await get(
      "api/v1/accounts/\(accountId)/albums",
      query: mediaId.map { [URLQueryItem(name: "media_id", value: $0)] } ?? [])
  }

  public func album(_ id: String) async throws -> AlbumDetail {
    try await get("api/v1/albums/\(id)")
  }

  public func createAlbum(_ draft: AlbumDraft) async throws -> Album {
    try await call("POST", "api/v1/albums", body: .json(draft.json))
  }

  public func updateAlbum(_ id: String, _ draft: AlbumDraft) async throws -> Album {
    try await call("PUT", "api/v1/albums/\(id)", body: .json(draft.json))
  }

  /** Deletes an album; its pictures stay in their posts. */
  public func deleteAlbum(_ id: String) async throws {
    try await perform("DELETE", "api/v1/albums/\(id)")
  }

  public func addMedia(_ mediaId: String, to albumId: String) async throws {
    try await perform("PUT", "api/v1/albums/\(albumId)/media/\(mediaId)")
  }

  public func removeMedia(_ mediaId: String, from albumId: String) async throws {
    try await perform("DELETE", "api/v1/albums/\(albumId)/media/\(mediaId)")
  }
}
