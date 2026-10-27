package com.disbigle.kit

import java.util.Base64
import java.util.UUID
import kotlinx.coroutines.test.runTest
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * The whole sign-in and the main calls against a real Disbigle server, to check that what it
 * sends decodes. Runs only with `DISBIGLE_TEST_SERVER` (e.g. http://localhost:3300) pointing at
 * a development server seeded with `apps/server/src/seed.ts`.
 */
class LiveServerTest {
  @Test fun signInAndUseTheApi() = runTest {
    val server = System.getenv("DISBIGLE_TEST_SERVER").orEmpty()
    assumeTrue("DISBIGLE_TEST_SERVER not set", server.isNotEmpty())

    // A browser session (what the web sign-in page leaves behind).
    val browser = OkHttpClient.Builder().followRedirects(false).build()
    val cookie = browser.newCall(
      Request.Builder().url("$server/api/v1/auth/login")
        .post("""{"login":"alice","password":"disbigle-demo"}""".toRequestBody("application/json".toMediaType())).build(),
    ).execute().use { it.header("Set-Cookie")!!.substringBefore(";") }

    // The app's part: register, open the consent page, approve, get the code back.
    val signIn = SignIn.start(server)
    val html = browser.newCall(Request.Builder().url(signIn.authorizeUrl).header("Cookie", cookie).build())
      .execute().use { it.body!!.string() }
    val fields = hiddenFields(html)
    assertEquals(signIn.state, fields["state"])
    val form = FormBody.Builder().apply {
      fields.forEach { (name, value) -> add(name, value) }
      add("decision", "approve")
    }.build()
    val location = browser.newCall(
      Request.Builder().url("$server/oauth/authorize").header("Cookie", cookie).header("Origin", server).post(form).build(),
    ).execute().use { it.header("Location")!! }
    val token = signIn.exchange(signIn.code(location))

    val client = Client(server, token.accessToken)
    val me = client.me()
    assertEquals("alice", me.username)
    client.instance()
    client.aspects()

    // Post with a poll, edit it, like it, read it back in the timeline and its thread.
    val poll = PostDraft.PollDraft(listOf("Sì", "No"), 3600, false)
    val posted = client.publish(PostDraft(text = "Dall'app **Android** #prova", poll = poll), Client.newIdempotencyKey())
    assertEquals(2, posted.poll?.options?.size)
    val edited = client.edit(posted.id, PostDraft(text = "Dall'app Android, modificato", poll = poll))
    assertNotNull(edited.edited)
    assertEquals("Dall'app Android, modificato", client.source(posted.id))
    assertEquals(true, client.act(StatusAction.FAVOURITE, posted.id).favourited)
    val reply = client.publish(PostDraft(text = "Risposta", inReplyToId = posted.id), Client.newIdempotencyKey())
    assertEquals(listOf(reply.id), client.context(posted.id).descendants.map { it.id })
    val home = client.timeline(Timeline.Home, listOf("limit" to "2"))
    assertEquals(reply.id, home.items.first().id)
    assertNotNull(home.next)
    assertFalse(client.timeline(Timeline.Home, home.next!!).items.any { it.id == reply.id })
    client.timeline(Timeline.Local)
    client.timeline(Timeline.Federated)
    client.timeline(Timeline.Hashtag("prova"))

    // An image, sent and attached.
    val media = client.upload(PNG, "pixel.png", "image/png", "Un pixel")
    val withImage = client.publish(PostDraft(text = "Foto", mediaIds = listOf(media.id)), Client.newIdempotencyKey())
    assertEquals("Un pixel", withImage.mediaAttachments.first().description)

    // The rest of what the app shows.
    client.notifications()
    client.conversations()
    assertTrue(client.statuses(me.id).items.isNotEmpty())
    val bruno = client.search("bruno").accounts.first { it.username == "bruno" }
    client.relationship(bruno.id)
    client.follow(bruno.id)
    assertFalse(client.unfollow(bruno.id).following)

    // Settings: profile, people lists, saved posts, aspects, read marker.
    val draft = ProfileDraft(client.credentials()).copy(
      displayName = "Alice dall'app",
      fields = listOf(Account.Field("Sito", "https://example.com")),
      avatar = ProfileDraft.Upload(PNG, "image/png"),
    )
    val updated = client.updateProfile(draft)
    assertEquals("Alice dall'app", updated.displayName)
    assertEquals(listOf("Sito"), updated.fields.map { it.name })
    assertNotNull(updated.avatarUrl)
    client.act(AccountAction.BLOCK, bruno.id)
    assertTrue(client.accounts(AccountList.BLOCKS).items.any { it.id == bruno.id })
    client.act(AccountAction.UNBLOCK, bruno.id)
    client.accounts(AccountList.MUTES)
    client.accounts(AccountList.FOLLOW_REQUESTS)
    assertTrue(client.favourites().items.any { it.id == posted.id })
    client.act(StatusAction.BOOKMARK, posted.id)
    assertEquals(posted.id, client.bookmarks().items.first().id)
    val suffix = UUID.randomUUID().toString().take(6)
    val aspect = client.createAspect("Dall'app $suffix")
    assertEquals("Rinominato $suffix", client.renameAspect(aspect.id, "Rinominato $suffix").title)
    assertTrue(client.members(aspect.id).isEmpty())
    client.addMember(bruno.id, aspect.id)
    assertTrue(client.aspectsContaining(bruno.id).any { it.id == aspect.id })
    client.removeMember(bruno.id, aspect.id)
    client.deleteAspect(aspect.id)
    client.notifications().items.firstOrNull()?.let { newest ->
      client.markNotificationsRead(newest.id)
      assertEquals(newest.id, client.notificationsReadMarker())
    }

    client.delete(withImage.id)
    SignIn.revoke(token.accessToken, server, signIn.app)
    try {
      client.me()
      throw AssertionError("the revoked token still works")
    } catch (_: ApiException.Unauthorized) {
    }
  }

  private fun hiddenFields(html: String): Map<String, String> =
    html.split("<input").drop(1).mapNotNull { part ->
      val attributes = RichText.attributes("input" + part.substringBefore(">"))
      val name = attributes["name"]
      if (attributes["type"] == "hidden" && name != null) name to (attributes["value"] ?: "") else null
    }.toMap()

  companion object {
    /** A 1×1 PNG. */
    val PNG: ByteArray = Base64.getDecoder().decode(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    )
  }
}
