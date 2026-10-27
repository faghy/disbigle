package com.disbigle.kit

import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * OAuth sign-in on a Disbigle server (authorization code with PKCE), as Mastodon apps do:
 * register the app, open `authorizeUrl` in the browser, then `exchange` the returned code.
 */
data class SignIn(val server: String, val app: RegisteredApp, val verifier: String, val state: String) {
  val authorizeUrl: String
    get() = "${server.trimEnd('/')}/oauth/authorize".toHttpUrl().newBuilder()
      .addQueryParameter("response_type", "code")
      .addQueryParameter("client_id", app.clientId)
      .addQueryParameter("redirect_uri", REDIRECT_URI)
      .addQueryParameter("scope", SCOPES)
      .addQueryParameter("state", state)
      .addQueryParameter("code_challenge", challenge(verifier))
      .addQueryParameter("code_challenge_method", "S256")
      .build().toString()

  sealed class Failure(message: String) : Exception(message) {
    /** The callback is not ours, or its state does not match (a forged redirect). */
    class BadCallback : Failure("bad callback")

    /** The person refused the authorization. */
    class Denied : Failure("denied")
  }

  /** The authorization code carried by the callback URL. */
  fun code(callback: String): String {
    if (!callback.startsWith(REDIRECT_URI)) throw Failure.BadCallback()
    val query = runCatching { URI(callback).rawQuery }.getOrNull() ?: throw Failure.BadCallback()
    val values = query.split("&").mapNotNull {
      val (name, value) = it.split("=", limit = 2).let { p -> p[0] to p.getOrElse(1) { "" } }
      java.net.URLDecoder.decode(name, "UTF-8") to java.net.URLDecoder.decode(value, "UTF-8")
    }.toMap()
    if (values["error"] != null) throw Failure.Denied()
    val code = values["code"]
    if (values["state"] != state || code.isNullOrEmpty()) throw Failure.BadCallback()
    return code
  }

  /** Trades the code for an access token. */
  suspend fun exchange(code: String): Token = Client(server).call(
    "POST", "oauth/token",
    body = Client.Body.Form(listOf(
      "grant_type" to "authorization_code",
      "code" to code,
      "client_id" to app.clientId,
      "client_secret" to app.clientSecret,
      "redirect_uri" to REDIRECT_URI,
      "code_verifier" to verifier,
    )),
  )

  companion object {
    const val REDIRECT_URI = "disbigle://oauth"
    const val SCOPES = "read write follow push"
    const val APP_NAME = "Disbigle for Android"
    const val WEBSITE = "https://disbigle.com"

    /** Registers the app on the server and prepares a sign-in. */
    suspend fun start(server: String): SignIn {
      val app: RegisteredApp = Client(server).call(
        "POST", "api/v1/apps",
        body = Client.Body.Form(listOf(
          "client_name" to APP_NAME,
          "redirect_uris" to REDIRECT_URI,
          "scopes" to SCOPES,
          "website" to WEBSITE,
        )),
      )
      return SignIn(server, app, randomToken(), randomToken())
    }

    /** Revokes a token (sign-out). */
    suspend fun revoke(token: String, server: String, app: RegisteredApp) = Client(server).perform(
      "POST", "oauth/revoke",
      body = Client.Body.Form(listOf("token" to token, "client_id" to app.clientId, "client_secret" to app.clientSecret)),
    )

    /** PKCE S256 challenge: base64url(SHA-256(verifier)). */
    fun challenge(verifier: String): String =
      base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))

    fun randomToken(): String = base64Url(ByteArray(32).also { SecureRandom().nextBytes(it) })

    private fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** The server address someone typed: a domain or a URL, always https. */
    fun serverUrl(input: String): String? {
      var text = input.trim().lowercase()
      if (text.startsWith("@")) {
        val at = text.lastIndexOf('@')
        if (at > 0) text = text.substring(at + 1) // @user@domain
      }
      if (!text.contains("://")) text = "https://$text"
      val url = text.toHttpUrlOrNull() ?: return null
      if (!url.host.contains('.') || url.host.contains(' ')) return null
      return "https://${url.host}" + if (url.port != 443 && url.port != 80) ":${url.port}" else ""
    }
  }
}
