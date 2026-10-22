import Foundation

// Entities of the Mastodon-compatible API (https://docs.joinmastodon.org/entities/), as
// Disbigle produces them. Decoded with `convertFromSnakeCase`; fields that other servers or
// older versions may leave out are optional.

public struct Account: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let username: String
  public let acct: String
  public let displayName: String
  public let locked: Bool
  public let bot: Bool
  public let createdAt: Date
  public let note: String
  public let url: String
  public let avatar: String
  public let header: String
  public let followersCount: Int
  public let followingCount: Int
  public let statusesCount: Int
  public let fields: [Field]

  public struct Field: Codable, Hashable, Sendable {
    public let name: String
    public let value: String
  }

  /** The display name, or the username when there is none. */
  public var name: String { displayName.isEmpty ? username : displayName }

  /** A header that is a real image (the API sends a placeholder path when there is none). */
  public var headerURL: URL? {
    header.isEmpty || header.hasSuffix("/missing.png") ? nil : URL(string: header)
  }
}

public enum Visibility: String, Codable, CaseIterable, Sendable {
  case `public`, unlisted, `private`, direct
}

public struct MediaAttachment: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let type: Kind
  public let url: String
  public let previewUrl: String?
  public let description: String?
  public let blurhash: String?
  public let meta: Meta?

  public enum Kind: String, Codable, Sendable {
    case image, gifv, video, audio, unknown

    public init(from decoder: Decoder) throws {
      let raw = try decoder.singleValueContainer().decode(String.self)
      self = Kind(rawValue: raw) ?? .unknown
    }
  }

  public struct Meta: Codable, Hashable, Sendable {
    public let original: Size?
  }

  public struct Size: Codable, Hashable, Sendable {
    public let width: Int?
    public let height: Int?
  }

  /** Width / height of the original, when known. */
  public var aspectRatio: Double? {
    guard let w = meta?.original?.width, let h = meta?.original?.height, w > 0, h > 0 else {
      return nil
    }
    return Double(w) / Double(h)
  }
}

public struct Mention: Codable, Hashable, Sendable {
  public let id: String
  public let username: String
  public let acct: String
  public let url: String
}

public struct Tag: Codable, Hashable, Sendable {
  public let name: String
  public let url: String
}

public struct Poll: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let expiresAt: Date?
  public let expired: Bool
  public let multiple: Bool
  public let votesCount: Int
  public let votersCount: Int?
  public let options: [Option]
  public let voted: Bool?
  public let ownVotes: [Int]?

  public struct Option: Codable, Hashable, Sendable {
    public let title: String
    public let votesCount: Int?
  }

  /** Share of the votes for an option, 0...1. */
  public func share(of option: Option) -> Double {
    let total = multiple ? (votersCount ?? votesCount) : votesCount
    guard total > 0, let votes = option.votesCount else { return 0 }
    return Double(votes) / Double(total)
  }
}

public final class Status: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let uri: String
  public let url: String?
  public let createdAt: Date
  public let editedAt: Date?
  public let account: Account
  public let content: String
  public let visibility: Visibility
  public let sensitive: Bool
  public let spoilerText: String
  public let mediaAttachments: [MediaAttachment]
  public let mentions: [Mention]
  public let tags: [Tag]
  public let reblogsCount: Int
  public let favouritesCount: Int
  public let repliesCount: Int
  public let inReplyToId: String?
  public let inReplyToAccountId: String?
  public let reblog: Status?
  public let poll: Poll?
  public let language: String?
  public let favourited: Bool?
  public let reblogged: Bool?
  public let bookmarked: Bool?
  public let pinned: Bool?

  public static func == (lhs: Status, rhs: Status) -> Bool {
    lhs.id == rhs.id && lhs.editedAt == rhs.editedAt && lhs.favourited == rhs.favourited
      && lhs.reblogged == rhs.reblogged && lhs.bookmarked == rhs.bookmarked
      && lhs.favouritesCount == rhs.favouritesCount && lhs.reblogsCount == rhs.reblogsCount
      && lhs.repliesCount == rhs.repliesCount && lhs.poll == rhs.poll
      && lhs.reblog == rhs.reblog
  }

  public func hash(into hasher: inout Hasher) { hasher.combine(id) }

  /** The post to show: the original of a reblog, or this one. */
  public var shown: Status { reblog ?? self }
}

public struct StatusContext: Codable, Sendable {
  public let ancestors: [Status]
  public let descendants: [Status]
}

public struct Notification: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let type: Kind
  public let createdAt: Date
  public let account: Account
  public let status: Status?

  public enum Kind: String, Codable, Sendable {
    case mention, status, reblog, follow, followRequest = "follow_request", favourite, poll, update
    case unknown

    public init(from decoder: Decoder) throws {
      let raw = try decoder.singleValueContainer().decode(String.self)
      self = Kind(rawValue: raw) ?? .unknown
    }
  }
}

public struct Conversation: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let unread: Bool
  public let accounts: [Account]
  public let lastStatus: Status?
}

public struct Relationship: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let following: Bool
  public let followedBy: Bool
  public let requested: Bool
  public let blocking: Bool
  public let muting: Bool
}

/** An aspect, presented by the API as a list. */
public struct AspectList: Codable, Hashable, Identifiable, Sendable {
  public let id: String
  public let title: String
}

public struct SearchResults: Codable, Sendable {
  public let accounts: [Account]
  public let statuses: [Status]
  public let hashtags: [Tag]
}

public struct Instance: Codable, Sendable {
  public let domain: String
  public let title: String
  public let description: String
  public let configuration: Configuration?

  public struct Configuration: Codable, Sendable {
    public let statuses: Statuses?
  }

  public struct Statuses: Codable, Sendable {
    public let maxCharacters: Int?
    public let maxMediaAttachments: Int?
  }

  public var maxCharacters: Int { configuration?.statuses?.maxCharacters ?? 5000 }
  public var maxMediaAttachments: Int { configuration?.statuses?.maxMediaAttachments ?? 4 }
}

/** An app registered with a server (`POST /api/v1/apps`). */
public struct RegisteredApp: Codable, Sendable {
  public let clientId: String
  public let clientSecret: String

  public init(clientId: String, clientSecret: String) {
    self.clientId = clientId
    self.clientSecret = clientSecret
  }
}

public struct Token: Codable, Sendable {
  public let accessToken: String
  public let scope: String?
}
