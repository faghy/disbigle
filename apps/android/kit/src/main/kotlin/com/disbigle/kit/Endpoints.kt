package com.disbigle.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

sealed interface Timeline {
  data object Home : Timeline
  /** Public posts of this server. */
  data object Local : Timeline
  /** Public posts of every server this one knows. */
  data object Federated : Timeline
  data class Hashtag(val name: String) : Timeline
  /** An aspect (a list in the API). */
  data class Aspect(val id: String) : Timeline

  val path: String
    get() = when (this) {
      Home -> "api/v1/timelines/home"
      Local, Federated -> "api/v1/timelines/public"
      is Hashtag -> "api/v1/timelines/tag/$name"
      is Aspect -> "api/v1/timelines/list/$id"
    }

  val query: Query get() = if (this == Local) listOf("local" to "true") else emptyList()
}

/** What a new post (or an edit) contains. */
data class PostDraft(
  val text: String = "",
  val visibility: Visibility = Visibility.PUBLIC,
  val spoilerText: String = "",
  val sensitive: Boolean = false,
  val inReplyToId: String? = null,
  val mediaIds: List<String> = emptyList(),
  val poll: PollDraft? = null,
  /** Aspects to share with (Disbigle extension; the visibility is then `limited`). */
  val aspectIds: List<String> = emptyList(),
) {
  data class PollDraft(val options: List<String>, val expiresIn: Int, val multiple: Boolean)

  fun json(forEdit: Boolean = false): JsonObject = buildJsonObject {
    put("status", text)
    put("spoiler_text", spoilerText)
    put("sensitive", sensitive)
    put("media_ids", JsonArray(mediaIds.map(::JsonPrimitive)))
    if (!forEdit) {
      if (aspectIds.isEmpty()) {
        put("visibility", visibility.raw)
      } else {
        put("visibility", "limited")
        put("aspect_ids", JsonArray(aspectIds.map(::JsonPrimitive)))
      }
      inReplyToId?.let { put("in_reply_to_id", it) }
    }
    poll?.let {
      put("poll", buildJsonObject {
        put("options", JsonArray(it.options.map(::JsonPrimitive)))
        put("expires_in", it.expiresIn)
        put("multiple", it.multiple)
      })
    }
  }
}

enum class StatusAction { FAVOURITE, UNFAVOURITE, REBLOG, UNREBLOG, BOOKMARK, UNBOOKMARK, PIN, UNPIN }

enum class AccountAction { BLOCK, UNBLOCK, MUTE, UNMUTE }

enum class AccountList(val path: String) { BLOCKS("blocks"), MUTES("mutes"), FOLLOW_REQUESTS("follow_requests") }

private fun json(vararg pairs: Pair<String, JsonElement>) = Client.Body.Json(JsonObject(mapOf(*pairs)))

// Timelines and posts

suspend fun Client.timeline(timeline: Timeline, query: Query = emptyList()): Page<Status> =
  page(timeline.path, timeline.query + query)

suspend fun Client.status(id: String): Status = get("api/v1/statuses/$id")

suspend fun Client.context(id: String): StatusContext = get("api/v1/statuses/$id/context")

/** Likes, reshares, bookmarks or pins a post (or undoes it); returns the updated post. */
suspend fun Client.act(action: StatusAction, id: String): Status =
  call("POST", "api/v1/statuses/$id/${action.name.lowercase()}")

suspend fun Client.publish(draft: PostDraft, idempotencyKey: String): Status {
  val (text, _) = send(request("POST", "api/v1/statuses", body = Client.Body.Json(draft.json()), headers = mapOf("Idempotency-Key" to idempotencyKey)))
  return Client.json.decodeFromString(Status.serializer(), text)
}

/** Edits a post. As on Mastodon the draft describes the whole post: attachments and a poll left out are removed. */
suspend fun Client.edit(id: String, draft: PostDraft): Status =
  call("PUT", "api/v1/statuses/$id", body = Client.Body.Json(draft.json(forEdit = true)))

@Serializable
private data class Source(val text: String)

/** The markdown source of one of your posts, to edit it. */
suspend fun Client.source(id: String): String = get<Source>("api/v1/statuses/$id/source").text

suspend fun Client.delete(id: String) = perform("DELETE", "api/v1/statuses/$id")

suspend fun Client.vote(pollId: String, choices: List<Int>): Poll =
  call("POST", "api/v1/polls/$pollId/votes", body = json("choices" to JsonArray(choices.map(::JsonPrimitive))))

suspend fun Client.upload(data: ByteArray, filename: String, mimeType: String, description: String = ""): MediaAttachment {
  val parts = buildList {
    if (description.isNotEmpty()) add(Client.Part("description", description))
    add(Client.Part("file", filename = filename, mimeType = mimeType, content = data))
  }
  return call("POST", "api/v2/media", body = Client.Body.Multipart(parts))
}

suspend fun Client.describeMedia(id: String, description: String) =
  perform("PUT", "api/v1/media/$id", body = json("description" to JsonPrimitive(description)))

// Notifications and messages

suspend fun Client.notifications(query: Query = emptyList()): Page<Notification> = page("api/v1/notifications", query)

suspend fun Client.conversations(query: Query = emptyList()): Page<Conversation> = page("api/v1/conversations", query)

suspend fun Client.markConversationRead(id: String) = perform("POST", "api/v1/conversations/$id/read")

// Accounts

suspend fun Client.me(): Account = get("api/v1/accounts/verify_credentials")

suspend fun Client.account(id: String): Account = get("api/v1/accounts/$id")

suspend fun Client.statuses(accountId: String, query: Query = emptyList()): Page<Status> =
  page("api/v1/accounts/$accountId/statuses", query)

suspend fun Client.relationship(accountId: String): Relationship? =
  get<List<Relationship>>("api/v1/accounts/relationships", listOf("id[]" to accountId)).firstOrNull()

suspend fun Client.follow(accountId: String): Relationship = call("POST", "api/v1/accounts/$accountId/follow")

suspend fun Client.unfollow(accountId: String): Relationship = call("POST", "api/v1/accounts/$accountId/unfollow")

suspend fun Client.act(action: AccountAction, accountId: String): Relationship =
  call("POST", "api/v1/accounts/$accountId/${action.name.lowercase()}")

suspend fun Client.accounts(list: AccountList, query: Query = emptyList()): Page<Account> = page("api/v1/${list.path}", query)

suspend fun Client.answerFollowRequest(accountId: String, accept: Boolean) =
  perform("POST", "api/v1/follow_requests/$accountId/${if (accept) "authorize" else "reject"}")

suspend fun Client.search(text: String): SearchResults = get("api/v2/search", listOf("q" to text, "resolve" to "true"))

suspend fun Client.instance(): Instance = get("api/v2/instance")

// Saved posts

suspend fun Client.bookmarks(query: Query = emptyList()): Page<Status> = page("api/v1/bookmarks", query)

suspend fun Client.favourites(query: Query = emptyList()): Page<Status> = page("api/v1/favourites", query)

// Aspects (lists)

suspend fun Client.aspects(): List<AspectList> = get("api/v1/lists")

suspend fun Client.createAspect(title: String): AspectList = call("POST", "api/v1/lists", body = json("title" to JsonPrimitive(title)))

suspend fun Client.renameAspect(id: String, title: String): AspectList =
  call("PUT", "api/v1/lists/$id", body = json("title" to JsonPrimitive(title)))

suspend fun Client.deleteAspect(id: String) = perform("DELETE", "api/v1/lists/$id")

suspend fun Client.members(aspectId: String): List<Account> = get("api/v1/lists/$aspectId/accounts", listOf("limit" to "0"))

/** The aspects of yours this account is in. */
suspend fun Client.aspectsContaining(accountId: String): List<AspectList> = get("api/v1/accounts/$accountId/lists")

suspend fun Client.addMember(accountId: String, aspectId: String) =
  perform("POST", "api/v1/lists/$aspectId/accounts", body = json("account_ids" to JsonArray(listOf(JsonPrimitive(accountId)))))

suspend fun Client.removeMember(accountId: String, aspectId: String) =
  perform("DELETE", "api/v1/lists/$aspectId/accounts", body = json("account_ids" to JsonArray(listOf(JsonPrimitive(accountId)))))

// Read markers

@Serializable
private data class Marker(val lastReadId: String)

/** The last notification read (on any device), or null. */
suspend fun Client.notificationsReadMarker(): String? =
  get<Map<String, Marker>>("api/v1/markers", listOf("timeline[]" to "notifications"))["notifications"]?.lastReadId

suspend fun Client.markNotificationsRead(upTo: String) =
  perform("POST", "api/v1/markers", body = json("notifications" to JsonObject(mapOf("last_read_id" to JsonPrimitive(upTo)))))
