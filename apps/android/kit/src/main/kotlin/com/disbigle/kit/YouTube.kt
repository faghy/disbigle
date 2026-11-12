package com.disbigle.kit

/** A YouTube video linked in a post or in the text being written. */
data class YouTubeLink(val url: String, val videoId: String)

private val YOUTUBE_HOST = Regex("^(?:www\\.|m\\.|music\\.)?(?:youtube\\.com|youtube-nocookie\\.com)$", RegexOption.IGNORE_CASE)
private val VIDEO_ID = Regex("^[A-Za-z0-9_-]{11}$")
private val HREF = Regex("href=\"([^\"]+)\"")
private val BARE_URL = Regex("https?://[^\\s<>\"]+")

/** The video id of a YouTube address (watch, youtu.be, shorts, embed, live), or null. */
fun youtubeVideoId(address: String): String? {
  val uri = runCatching { java.net.URI(address.replace("&amp;", "&")) }.getOrNull() ?: return null
  val host = uri.host ?: return null
  val path = uri.path.orEmpty()
  val id = when {
    host.equals("youtu.be", ignoreCase = true) -> path.trim('/').substringBefore('/')
    YOUTUBE_HOST.matches(host) -> when {
      path == "/watch" -> uri.rawQuery.orEmpty().split('&').firstOrNull { it.startsWith("v=") }?.removePrefix("v=")
      path.startsWith("/shorts/") || path.startsWith("/embed/") || path.startsWith("/live/") ->
        path.split('/').getOrNull(2)
      else -> null
    }
    else -> null
  }
  return id?.takeIf { VIDEO_ID.matches(it) }
}

/** The first YouTube video linked in a post's HTML. */
fun firstYouTubeLink(html: String): YouTubeLink? =
  HREF.findAll(html).map { it.groupValues[1].replace("&amp;", "&") }
    .firstNotNullOfOrNull { href -> youtubeVideoId(href)?.let { YouTubeLink(href, it) } }

/** The first web address in text being written (for its preview). */
fun firstUrl(text: String): String? = BARE_URL.find(text)?.value?.trimEnd('.', ',', ')', '!', '?', ':', ';')
