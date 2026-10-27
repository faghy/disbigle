package com.disbigle.kit

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SignInTest {
  @Test fun pkceChallengeFollowsRfc7636() {
    assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", SignIn.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    val token = SignIn.randomToken()
    assertEquals(43, token.length)
    assertFalse(token.contains("="))
    assertNotEquals(token, SignIn.randomToken())
  }

  @Test fun serverAddressesAreNormalised() {
    assertEquals("https://app.disbigle.com", SignIn.serverUrl("app.disbigle.com"))
    assertEquals("https://app.disbigle.com", SignIn.serverUrl(" HTTP://App.Disbigle.com/@faghy?x=1 "))
    assertEquals("https://disbigle.com", SignIn.serverUrl("@faghy@disbigle.com"))
    assertNull(SignIn.serverUrl("localhost"))
    assertNull(SignIn.serverUrl(""))
  }

  @Test fun callbackNeedsTheSameState() {
    val signIn = SignIn("https://app.disbigle.com", RegisteredApp("id", "secret"), "v", "s1")
    assertEquals("abc", signIn.code("disbigle://oauth?code=abc&state=s1"))
    assertThrows<SignIn.Failure.BadCallback> { signIn.code("disbigle://oauth?code=abc&state=other") }
    assertThrows<SignIn.Failure.BadCallback> { signIn.code("evil://oauth?code=abc&state=s1") }
    assertThrows<SignIn.Failure.Denied> { signIn.code("disbigle://oauth?error=access_denied&state=s1") }

    val url = okhttp3.HttpUrl.Builder().scheme("https").host("x").build().resolve(signIn.authorizeUrl)!!
    assertEquals("/oauth/authorize", url.encodedPath)
    assertEquals("id", url.queryParameter("client_id"))
    assertEquals("disbigle://oauth", url.queryParameter("redirect_uri"))
    assertEquals("S256", url.queryParameter("code_challenge_method"))
    assertEquals(SignIn.challenge("v"), url.queryParameter("code_challenge"))
  }
}

class ClientTest {
  @Test fun linkHeaderGivesTheNextCursor() {
    val header = "<https://app.disbigle.com/api/v1/timelines/home?max_id=0199>; rel=\"next\", " +
      "<https://app.disbigle.com/api/v1/timelines/home?min_id=01a0>; rel=\"prev\""
    assertEquals(listOf("max_id" to "0199"), LinkHeader.next(header))
    assertNull(LinkHeader.next("<https://x.test/?min_id=1>; rel=\"prev\""))
    assertNull(LinkHeader.next(null))
  }

  @Test fun datesWithAndWithoutFractions() {
    assertNotNull(parseDate("2026-10-22T08:15:30.123Z"))
    assertNotNull(parseDate("2026-10-22T08:15:30Z"))
    assertNotNull(parseDate("2026-10-22T08:15:30+02:00"))
    assertNull(parseDate("yesterday"))
  }

  @Test fun decodesAStatusAsTheServerSendsIt() {
    val status = Client.json.decodeFromString(Status.serializer(), Fixtures.status)
    assertEquals("faghy", status.account.acct)
    assertEquals(Visibility.PUBLIC, status.visibility)
    assertEquals("image", status.mediaAttachments.first().type)
    assertEquals(2f, status.mediaAttachments.first().aspectRatio)
    assertEquals(listOf("Tè", "Caffè"), status.poll?.options?.map { it.title })
    assertEquals(0.75f, status.poll!!.share(status.poll!!.options[0]))
    assertEquals(true, status.favourited)
    assertNotNull(status.edited)
    assertNull(status.account.headerUrl)
    assertEquals("https://app.disbigle.com/media/a.webp", status.account.avatarUrl)
    assertEquals("F", status.account.initials)

    val reblog = Client.json.decodeFromString(Status.serializer(), Fixtures.reblog(Fixtures.status))
    assertEquals(status.id, reblog.shown.id)
  }

  @Test fun unknownValuesDoNotBreakDecoding() {
    val json = Fixtures.notification.replace("\"mention\"", "\"admin.sign_up\"")
    assertEquals(Notification.Kind.UNKNOWN, Client.json.decodeFromString(Notification.serializer(), json).type)
    val limited = Fixtures.status.replace("\"visibility\":\"public\"", "\"visibility\":\"limited\"")
    assertEquals(Visibility.PRIVATE, Client.json.decodeFromString(Status.serializer(), limited).visibility)
  }

  @Test fun draftBodies() {
    val plain = PostDraft(text = "Ciao", visibility = Visibility.UNLISTED, inReplyToId = "42").json()
    assertEquals("unlisted", plain["visibility"]!!.jsonPrimitive.content)
    assertEquals("42", plain["in_reply_to_id"]!!.jsonPrimitive.content)
    val aspects = PostDraft(text = "Solo amici", aspectIds = listOf("a1")).json()
    assertEquals("limited", aspects["visibility"]!!.jsonPrimitive.content)
    assertEquals("a1", (aspects["aspect_ids"] as JsonArray)[0].jsonPrimitive.content)
    val edit = PostDraft(text = "Nuovo", inReplyToId = "42", aspectIds = listOf("a1")).json(forEdit = true)
    assertFalse(edit.containsKey("visibility") || edit.containsKey("in_reply_to_id") || edit.containsKey("aspect_ids"))
  }

  @Test fun requestsCarryTheTokenAndDecodeErrors() = runTest {
    val server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        assertEquals("Bearer t0k", request.getHeader("Authorization"))
        return when (request.path) {
          "/api/v1/statuses/1/favourite" -> {
            assertEquals("POST", request.method)
            MockResponse().setBody(Fixtures.status)
          }
          "/api/v1/timelines/home" -> MockResponse().setBody("[${Fixtures.status}]")
            .setHeader("Link", "<https://x.test/api/v1/timelines/home?max_id=0001>; rel=\"next\"")
          "/api/v1/statuses/404" -> MockResponse().setResponseCode(404).setBody("{\"error\":\"Record not found\"}")
          else -> MockResponse().setResponseCode(401).setBody("{\"error\":\"The access token is invalid\"}")
        }
      }
    }
    server.start()
    try {
      val client = Client(server.url("/").toString(), "t0k")
      assertEquals(true, client.act(StatusAction.FAVOURITE, "1").favourited)
      val page = client.timeline(Timeline.Home)
      assertEquals(1, page.items.size)
      assertEquals(listOf("max_id" to "0001"), page.next)
      try {
        client.status("404")
        fail("expected an error")
      } catch (e: ApiException.Server) {
        assertEquals(404, e.status)
        assertEquals("Record not found", e.message)
      }
      try {
        client.me()
        fail("expected an error")
      } catch (_: ApiException.Unauthorized) {
      }
    } finally {
      server.shutdown()
    }
  }
}

class RichTextTest {
  @Test fun paragraphsLinksAndMentions() {
    val html = "<p>Ciao <span class=\"h-card\"><a href=\"https://app.disbigle.com/@alice\" class=\"u-url mention\">@<span>alice</span></a></span> &amp; tutti!</p>" +
      "<p>Guarda <a href=\"https://example.com/very/long/path\" rel=\"nofollow\"><span class=\"invisible\">https://</span><span class=\"ellipsis\">example.com/very/lo</span><span class=\"invisible\">ng/path</span></a><br>a capo</p>"
    val text = RichText.parse(html)
    assertEquals("Ciao @alice & tutti!\n\nGuarda example.com/very/lo…\na capo", text.text)
    val links = text.spans.mapNotNull { it.url }.distinct()
    assertEquals(listOf("https://app.disbigle.com/@alice", "https://example.com/very/long/path"), links)
    val mention = text.spans.first { it.url == "https://app.disbigle.com/@alice" }
    assertEquals("@", text.text.substring(mention.start, mention.end))
  }

  @Test fun listsQuotesAndEntities() {
    assertEquals("• uno\n• due\n\n😀 <3", RichText.parse("<ul><li>uno</li><li>due</li></ul><p>&#x1F600; &lt;3</p>").text)
    assertEquals("a\nb", RichText.plain("<p>a</p><p>b</p>"))
    val bold = RichText.parse("<p>a <strong>b</strong></p>")
    assertEquals(listOf(RichText.Span(2, 3, RichText.Style.BOLD)), bold.spans)
  }

  @Test fun onlyWebLinksAreKept() {
    assertTrue(RichText.parse("<a href=\"javascript:alert(1)\">x</a>").spans.none { it.url != null })
  }
}

class AlertsTest {
  private fun notification(id: String, type: String, minutes: Int): Notification {
    val json = Fixtures.notification
      .replace("\"id\":\"n1\"", "\"id\":\"$id\"")
      .replace("\"type\":\"mention\"", "\"type\":\"$type\"")
      // Only the notification's own date (the one followed by the account), not the post's.
      .replace(Regex("\"created_at\":\"2026-10-21T10:00:00.000Z\",(\\s*)\"account\""), "\"created_at\":\"2026-10-21T10:%02d:00.000Z\",$1\"account\"".format(minutes))
    return Client.json.decodeFromString(Notification.serializer(), json)
  }

  @Test fun onlyNewerNotificationsOfChosenKindsOldestFirst() {
    // Newest first, as the API lists them.
    val list = listOf(
      notification("n5", "favourite", 5),
      notification("n4", "follow", 4),
      notification("n3", "mention", 3),
      notification("n2", "reblog", 2),
    )
    val alerts = Alerts.newAlerts(list, "n2", setOf(Notification.Kind.MENTION, Notification.Kind.FAVOURITE))
    assertEquals(listOf("n3", "n5"), alerts.map { it.id })
    assertEquals(list[2].status?.id, alerts.first().statusId)
    // First run: old notifications are not announced.
    assertTrue(Alerts.newAlerts(list, null, Alerts.kinds.toSet()).isEmpty())
  }

  @Test fun alertTexts() {
    val mention = Alerts.alert(notification("n1", "mention", 1))
    assertEquals("Faghy", mention.name)
    assertEquals("Tè o caffè?", mention.body)
    assertEquals("@faghy", Alerts.alert(notification("n2", "follow", 1)).body)
  }

  @Test fun profileFormSendsEveryFieldSlot() {
    val account = Client.json.decodeFromString(
      CredentialAccount.serializer(),
      """{"id":"1","display_name":"Faghy","note":"<p>Ciao</p>","locked":true,"bot":false,"discoverable":true,"source":{"note":"Ciao","fields":[{"name":"Sito","value":"faghy.it"}],"language":"it","follow_requests_count":2}}""",
    )
    val draft = ProfileDraft(account)
    assertEquals("Ciao", draft.note)
    assertEquals(listOf(Account.Field("Sito", "faghy.it")), draft.fields)
    assertEquals(2, account.source?.followRequestsCount)
    val parts = draft.copy(fields = emptyList()).parts.associate { it.name to it.value }
    assertEquals("", parts["fields_attributes[0][name]"])
    assertTrue(parts.containsKey("fields_attributes[3][value]"))
    assertEquals("true", parts["locked"])
    assertEquals("it", parts["source[language]"])
    assertFalse(parts.containsKey("avatar"))
  }
}

inline fun <reified E : Throwable> assertThrows(block: () -> Unit) {
  try {
    block()
  } catch (e: Throwable) {
    if (e is E) return
    throw AssertionError("expected ${E::class.simpleName}, got $e")
  }
  throw AssertionError("expected ${E::class.simpleName}")
}

object Fixtures {
  val account = """
    {"id":"0192a000-0000-7000-8000-000000000001","username":"faghy","acct":"faghy",
    "display_name":"Faghy","locked":false,"bot":false,"discoverable":true,"indexable":true,
    "group":false,"noindex":false,"hide_collections":false,"created_at":"2026-10-11T20:40:00.000Z",
    "note":"<p>Sistemista</p>","url":"https://app.disbigle.com/@faghy","uri":"https://app.disbigle.com/users/faghy",
    "avatar":"https://app.disbigle.com/media/a.webp","avatar_static":"https://app.disbigle.com/media/a.webp",
    "header":"https://app.disbigle.com/headers/original/missing.png","header_static":"https://app.disbigle.com/headers/original/missing.png",
    "followers_count":3,"following_count":5,"statuses_count":10,"last_status_at":"2026-10-21",
    "emojis":[],"roles":[],"fields":[{"name":"Sito","value":"<a href=\"https://faghy.it\">faghy.it</a>","verified_at":null}]}
  """.trimIndent()

  val status = """
    {"id":"0192a000-0000-7000-8000-0000000000aa","uri":"https://app.disbigle.com/users/faghy/statuses/aa",
    "url":"https://app.disbigle.com/@faghy/aa","created_at":"2026-10-21T10:00:00.000Z",
    "edited_at":"2026-10-21T10:05:00.000Z","account":$account,"content":"<p>Tè o caffè?</p>",
    "visibility":"public","sensitive":false,"spoiler_text":"",
    "media_attachments":[{"id":"m1","type":"image","url":"https://app.disbigle.com/media/x.webp",
    "preview_url":"https://app.disbigle.com/media/x-small.webp","remote_url":null,"preview_remote_url":null,
    "text_url":null,"meta":{"original":{"width":800,"height":400,"size":"800x400","aspect":2}},
    "description":"Una tazza","blurhash":null}],
    "application":null,"mentions":[],"tags":[{"name":"caffe","url":"https://app.disbigle.com/tags/caffe","history":[]}],
    "emojis":[],"reblogs_count":1,"favourites_count":2,"replies_count":0,"in_reply_to_id":null,
    "in_reply_to_account_id":null,"reblog":null,
    "poll":{"id":"p1","expires_at":"2026-10-22T10:00:00.000Z","expired":false,"multiple":false,
    "votes_count":4,"voters_count":4,"options":[{"title":"Tè","votes_count":3},{"title":"Caffè","votes_count":1}],
    "emojis":[],"voted":true,"own_votes":[0]},
    "card":null,"language":"it","favourited":true,"reblogged":false,"muted":false,"bookmarked":false,"pinned":false}
  """.trimIndent()

  fun reblog(original: String) = """
    {"id":"0192a000-0000-7000-8000-0000000000bb","uri":"u","url":null,"created_at":"2026-10-21T11:00:00Z",
    "edited_at":null,"account":$account,"content":"","visibility":"public","sensitive":false,
    "spoiler_text":"","media_attachments":[],"application":null,"mentions":[],"tags":[],"emojis":[],
    "reblogs_count":0,"favourites_count":0,"replies_count":0,"in_reply_to_id":null,
    "in_reply_to_account_id":null,"reblog":$original,"poll":null,"card":null,"language":null}
  """.trimIndent()

  val notification = """
    {"id":"n1","type":"mention","group_key":"n1","created_at":"2026-10-21T10:00:00.000Z",
    "account":$account,"status":$status}
  """.trimIndent()
}
