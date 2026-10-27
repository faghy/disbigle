package com.disbigle.kit

import java.time.Instant
import java.time.OffsetDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Entities of the Mastodon-compatible API (https://docs.joinmastodon.org/entities/), as
// Disbigle produces them. Keys are snake_case (the JSON naming strategy maps them); fields that
// other servers or older versions may leave out have defaults. Enum-like fields stay strings
// with a typed accessor, so a value added by a newer server never breaks decoding.

/** ISO 8601 with or without fractional seconds or an offset. */
fun parseDate(text: String?): Instant? =
  text?.let { runCatching { Instant.parse(it) }.getOrNull() ?: runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() }

@Serializable
data class Account(
  val id: String,
  val username: String,
  val acct: String,
  val displayName: String = "",
  val locked: Boolean = false,
  val bot: Boolean = false,
  val createdAt: String? = null,
  val note: String = "",
  val url: String = "",
  val avatar: String = "",
  val header: String = "",
  val followersCount: Int = 0,
  val followingCount: Int = 0,
  val statusesCount: Int = 0,
  val fields: List<Field> = emptyList(),
) {
  @Serializable
  data class Field(val name: String, val value: String)

  /** The display name, or the username when there is none. */
  val name: String get() = displayName.ifEmpty { username }

  /** A header that is a real image (the API sends a placeholder when there is none). */
  val headerUrl: String? get() = header.takeUnless(::isPlaceholder)

  /** An avatar the person chose (null for the server's default picture). */
  val avatarUrl: String? get() = avatar.takeUnless(::isPlaceholder)

  /** Initials for a picture-less avatar. */
  val initials: String
    get() = name.split(' ', '_', '.').filter { it.isNotEmpty() }.take(2)
      .joinToString("") { it.first().uppercase() }

  companion object {
    /** Default pictures of Disbigle (`/assets/user/default.png`, `missing-header.png`) and Mastodon (`missing.png`). */
    fun isPlaceholder(url: String): Boolean =
      url.isEmpty() || url.endsWith("/missing.png") || url.endsWith("/missing-header.png") ||
        url.endsWith("/assets/user/default.png")
  }
}

enum class Visibility(val raw: String) {
  PUBLIC("public"), UNLISTED("unlisted"), PRIVATE("private"), DIRECT("direct");

  companion object {
    /** Disbigle's `limited` (aspects) reads as private here, as on Mastodon apps. */
    fun of(raw: String): Visibility = entries.firstOrNull { it.raw == raw } ?: PRIVATE
  }
}

@Serializable
data class MediaAttachment(
  val id: String,
  val type: String = "unknown",
  val url: String = "",
  val previewUrl: String? = null,
  val description: String? = null,
  val blurhash: String? = null,
  val meta: Meta? = null,
) {
  @Serializable
  data class Meta(val original: Size? = null)

  @Serializable
  data class Size(val width: Int? = null, val height: Int? = null)

  val isVideo: Boolean get() = type == "video" || type == "gifv"

  /** Width / height of the original, when known. */
  val aspectRatio: Float?
    get() {
      val w = meta?.original?.width ?: return null
      val h = meta.original.height ?: return null
      return if (w > 0 && h > 0) w.toFloat() / h else null
    }
}

@Serializable
data class Mention(val id: String, val username: String, val acct: String, val url: String)

@Serializable
data class Tag(val name: String, val url: String = "")

@Serializable
data class Poll(
  val id: String,
  val expiresAt: String? = null,
  val expired: Boolean = false,
  val multiple: Boolean = false,
  val votesCount: Int = 0,
  val votersCount: Int? = null,
  val options: List<Option> = emptyList(),
  val voted: Boolean? = null,
  val ownVotes: List<Int>? = null,
) {
  @Serializable
  data class Option(val title: String, val votesCount: Int? = null)

  val expires: Instant? get() = parseDate(expiresAt)

  /** Share of the votes for an option, 0..1. */
  fun share(option: Option): Float {
    val total = if (multiple) votersCount ?: votesCount else votesCount
    val votes = option.votesCount ?: return 0f
    return if (total > 0) votes.toFloat() / total else 0f
  }
}

@Serializable
data class Status(
  val id: String,
  val uri: String = "",
  val url: String? = null,
  val createdAt: String,
  val editedAt: String? = null,
  val account: Account,
  val content: String = "",
  @SerialName("visibility") val visibilityRaw: String = "public",
  val sensitive: Boolean = false,
  val spoilerText: String = "",
  val mediaAttachments: List<MediaAttachment> = emptyList(),
  val mentions: List<Mention> = emptyList(),
  val tags: List<Tag> = emptyList(),
  val reblogsCount: Int = 0,
  val favouritesCount: Int = 0,
  val repliesCount: Int = 0,
  val inReplyToId: String? = null,
  val inReplyToAccountId: String? = null,
  val reblog: Status? = null,
  val poll: Poll? = null,
  val language: String? = null,
  val favourited: Boolean? = null,
  val reblogged: Boolean? = null,
  val bookmarked: Boolean? = null,
  val pinned: Boolean? = null,
) {
  val visibility: Visibility get() = Visibility.of(visibilityRaw)
  val created: Instant get() = parseDate(createdAt) ?: Instant.EPOCH
  val edited: Instant? get() = parseDate(editedAt)

  /** The post to show: the original of a reblog, or this one. */
  val shown: Status get() = reblog ?: this
}

@Serializable
data class StatusContext(val ancestors: List<Status> = emptyList(), val descendants: List<Status> = emptyList())

@Serializable
data class Notification(
  val id: String,
  @SerialName("type") val typeRaw: String,
  val createdAt: String,
  val account: Account,
  val status: Status? = null,
) {
  enum class Kind(val raw: String) {
    MENTION("mention"), STATUS("status"), REBLOG("reblog"), FOLLOW("follow"),
    FOLLOW_REQUEST("follow_request"), FAVOURITE("favourite"), POLL("poll"), UPDATE("update"),
    UNKNOWN("unknown");

    companion object {
      fun of(raw: String): Kind = entries.firstOrNull { it.raw == raw } ?: UNKNOWN
    }
  }

  val type: Kind get() = Kind.of(typeRaw)
  val created: Instant get() = parseDate(createdAt) ?: Instant.EPOCH
}

@Serializable
data class Conversation(
  val id: String,
  val unread: Boolean = false,
  val accounts: List<Account> = emptyList(),
  val lastStatus: Status? = null,
)

@Serializable
data class Relationship(
  val id: String,
  val following: Boolean = false,
  val followedBy: Boolean = false,
  val requested: Boolean = false,
  val blocking: Boolean = false,
  val muting: Boolean = false,
)

/** An aspect, presented by the API as a list. */
@Serializable
data class AspectList(val id: String, val title: String)

@Serializable
data class SearchResults(
  val accounts: List<Account> = emptyList(),
  val statuses: List<Status> = emptyList(),
  val hashtags: List<Tag> = emptyList(),
)

@Serializable
data class Instance(
  val domain: String = "",
  val title: String = "",
  val description: String = "",
  val configuration: Configuration? = null,
) {
  @Serializable
  data class Configuration(val statuses: Statuses? = null)

  @Serializable
  data class Statuses(val maxCharacters: Int? = null, val maxMediaAttachments: Int? = null)

  val maxCharacters: Int get() = configuration?.statuses?.maxCharacters ?: 5000
  val maxMediaAttachments: Int get() = configuration?.statuses?.maxMediaAttachments ?: 4
}

/** An app registered with a server (`POST /api/v1/apps`). */
@Serializable
data class RegisteredApp(val clientId: String, val clientSecret: String)

@Serializable
data class Token(val accessToken: String, val scope: String? = null)
