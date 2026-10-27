package com.disbigle.kit

import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** An error of the API, with a message to show. */
sealed class ApiException(message: String) : IOException(message) {
  /** The server answered with an error (`{"error": "..."}` on Mastodon-style APIs). */
  class Server(val status: Int, message: String) : ApiException(message)

  /** The token was refused: the person must sign in again. */
  class Unauthorized : ApiException("unauthorized")
}

/** One page of a list, with the cursor of the `Link` header. */
data class Page<T>(val items: List<T>, val next: List<Pair<String, String>>?)

/** A query: name and value pairs (names may repeat, e.g. `id[]`). */
typealias Query = List<Pair<String, String>>

/** Sends requests to a server's Mastodon-compatible API with an access token. */
class Client(val server: String, private val token: String? = null, private val http: OkHttpClient = defaultHttp) {
  sealed interface Body {
    data class Json(val value: JsonElement) : Body
    data class Form(val fields: Query) : Body
    data class Multipart(val parts: List<Part>) : Body
  }

  /** A part of a multipart form: a field, or a file when `content` is set. */
  data class Part(val name: String, val value: String = "", val filename: String? = null, val mimeType: String? = null, val content: ByteArray? = null)

  fun url(path: String, query: Query = emptyList()): HttpUrl {
    val builder = server.trimEnd('/').toHttpUrl().newBuilder().addPathSegments(path)
    for ((name, value) in query) builder.addQueryParameter(name, value)
    return builder.build()
  }

  fun request(method: String, path: String, query: Query = emptyList(), body: Body? = null, headers: Map<String, String> = emptyMap()): Request {
    val builder = Request.Builder().url(url(path, query)).header("Accept", "application/json")
    token?.let { builder.header("Authorization", "Bearer $it") }
    headers.forEach { (name, value) -> builder.header(name, value) }
    val requestBody: RequestBody? = when (body) {
      is Body.Json -> body.value.toString().toRequestBody("application/json".toMediaType())
      is Body.Form -> FormBody.Builder().apply { body.fields.forEach { (n, v) -> add(n, v) } }.build()
      is Body.Multipart -> MultipartBody.Builder().setType(MultipartBody.FORM).apply {
        for (part in body.parts) {
          if (part.content != null) {
            addFormDataPart(part.name, part.filename ?: "file", part.content.toRequestBody((part.mimeType ?: "application/octet-stream").toMediaType()))
          } else {
            addFormDataPart(part.name, part.value)
          }
        }
      }.build()
      null -> if (method == "GET" || method == "HEAD") null else ByteArray(0).toRequestBody(null)
    }
    return builder.method(method, requestBody).build()
  }

  /** Sends a request; returns the body text and the `Link` header. */
  suspend fun send(request: Request): Pair<String, String?> = withContext(Dispatchers.IO) {
    // The body is read here too: never on the caller's (UI) thread.
    val response = http.newCall(request).await()
    response.use {
      val text = it.body?.string() ?: ""
      if (it.code == 401) throw ApiException.Unauthorized()
      if (it.code !in 200..299) {
        val message = runCatching { json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
        throw ApiException.Server(it.code, message ?: it.message.ifEmpty { "HTTP ${it.code}" })
      }
      text to it.header("Link")
    }
  }

  suspend inline fun <reified T> call(method: String, path: String, query: Query = emptyList(), body: Body? = null): T =
    json.decodeFromString(serializer<T>(), send(request(method, path, query, body)).first)

  suspend inline fun <reified T> get(path: String, query: Query = emptyList()): T = call("GET", path, query)

  /** A request whose answer is not needed. */
  suspend fun perform(method: String, path: String, query: Query = emptyList(), body: Body? = null) {
    send(request(method, path, query, body))
  }

  suspend inline fun <reified T> page(path: String, query: Query = emptyList()): Page<T> {
    val (text, link) = send(request("GET", path, query))
    val items = json.decodeFromString(serializer<List<T>>(), text)
    return Page(items, if (items.isEmpty()) null else LinkHeader.next(link))
  }

  companion object {
    @OptIn(ExperimentalSerializationApi::class)
    val json = Json {
      ignoreUnknownKeys = true
      explicitNulls = false
      coerceInputValues = true
      namingStrategy = JsonNamingStrategy.SnakeCase
    }

    val defaultHttp: OkHttpClient = OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .build()

    fun newIdempotencyKey(): String = UUID.randomUUID().toString()
  }
}

/** Reads the `rel="next"` cursor of a Mastodon `Link` header. */
object LinkHeader {
  fun next(header: String?): Query? {
    header ?: return null
    for (part in header.split(",")) {
      val pieces = part.split(";").map { it.trim() }
      if (pieces.size < 2 || pieces.drop(1).none { it == "rel=\"next\"" }) continue
      val link = pieces[0]
      if (!link.startsWith("<") || !link.endsWith(">")) continue
      val url = runCatching { link.substring(1, link.length - 1).toHttpUrl() }.getOrNull() ?: continue
      return (0 until url.querySize).map { url.queryParameterName(it) to (url.queryParameterValue(it) ?: "") }
    }
    return null
  }
}

suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
  enqueue(object : Callback {
    override fun onResponse(call: Call, response: Response) {
      continuation.resume(response) { response.close() }
    }

    override fun onFailure(call: Call, e: IOException) {
      continuation.resumeWithException(e)
    }
  })
  continuation.invokeOnCancellation { runCatching { cancel() } }
}
