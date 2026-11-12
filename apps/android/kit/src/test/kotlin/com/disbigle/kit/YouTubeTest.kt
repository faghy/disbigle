package com.disbigle.kit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class YouTubeTest {
  @Test fun readsTheVideoIdOfEveryKindOfAddress() {
    assertEquals("dQw4w9WgXcQ", youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42"))
    assertEquals("dQw4w9WgXcQ", youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc"))
    assertEquals("dQw4w9WgXcQ", youtubeVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"))
    assertEquals("dQw4w9WgXcQ", youtubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"))
    assertNull(youtubeVideoId("https://www.youtube.com/channel/UC1234567890"))
    assertNull(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"))
  }

  @Test fun findsTheFirstVideoInAPost() {
    val html = "<p>Guarda <a href=\"https://example.com\">qui</a> e " +
      "<a href=\"https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=1\">questo</a></p>"
    assertEquals("dQw4w9WgXcQ", firstYouTubeLink(html)?.videoId)
    assertNull(firstYouTubeLink("<p>niente video</p>"))
  }

  @Test fun findsTheFirstAddressBeingWritten() {
    assertEquals("https://example.com/a?b=1", firstUrl("leggi https://example.com/a?b=1, poi dimmi"))
    assertNull(firstUrl("nessun link qui"))
  }
}
