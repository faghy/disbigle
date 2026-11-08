package com.disbigle.kit

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownFormatTest {
  @Test fun wrapsAndUnwraps() {
    val bold = applyFormat("ciao mondo", 5, 10, Format.BOLD)
    assertEquals(FormatEdit("ciao **mondo**", 7, 12), bold)
    assertEquals("ciao mondo", applyFormat(bold.text, bold.start, bold.end, Format.BOLD).text)
    assertEquals(FormatEdit("ciao *text*", 6, 10), applyFormat("ciao ", 5, 5, Format.ITALIC))
  }

  @Test fun prefixesLines() {
    val list = applyFormat("uno\ndue\ntre", 0, 11, Format.NUMBERED)
    assertEquals("1. uno\n2. due\n3. tre", list.text)
    assertEquals("uno\ndue\ntre", applyFormat(list.text, 0, list.text.length, Format.NUMBERED).text)
    assertEquals("## titolo", applyFormat("> titolo", 3, 3, Format.HEADING).text)
    assertEquals("prima\n> seconda", applyFormat("prima\nseconda", 7, 7, Format.QUOTE).text)
  }

  @Test fun linksSelectTheAddress() {
    val link = applyFormat("vedi qui", 5, 8, Format.LINK)
    assertEquals("vedi [qui](https://)", link.text)
    assertEquals("https://", link.text.substring(link.start, link.end))
  }
}
