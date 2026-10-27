package com.disbigle.kit

/**
 * Post HTML (Mastodon flavour: paragraphs, links, mentions, emphasis, lists, quotes) as text with
 * style ranges, for the UI to draw. Unknown tags keep their text; scripts and styles never get
 * here, as servers sanitise post HTML, and nothing is ever rendered as HTML.
 */
data class RichText(val text: String, val spans: List<Span>) {
  enum class Style { BOLD, ITALIC, CODE, STRIKE }

  /** A styled range: a style, or a link when `url` is set. */
  data class Span(val start: Int, val end: Int, val style: Style? = null, val url: String? = null)

  companion object {
    fun parse(html: String): RichText = Parser().run(html)

    /** The text alone, on one line where possible (for previews and accessibility). */
    fun plain(html: String): String = parse(html).text.replace("\n\n", "\n").trim()

    /** `name="value"` pairs of a tag (double or single quotes). */
    fun attributes(tag: String): Map<String, String> {
      val result = mutableMapOf<String, String>()
      var rest = tag.drop(tag.takeWhile { it.isLetterOrDigit() }.length)
      while (true) {
        val eq = rest.indexOf('=')
        if (eq < 0) break
        val key = rest.substring(0, eq).trim().lowercase().split(' ').last()
        var after = rest.substring(eq + 1).trimStart(' ')
        val quote = after.firstOrNull()
        if (quote != '"' && quote != '\'') break
        after = after.drop(1)
        val end = after.indexOf(quote)
        if (end < 0) break
        result[key] = decodeEntities(after.substring(0, end))
        rest = after.substring(end + 1)
      }
      return result
    }

    fun decodeEntities(text: String): String {
      if (!text.contains('&')) return text
      val result = StringBuilder()
      var index = 0
      while (index < text.length) {
        if (text[index] == '&') {
          val semicolon = text.indexOf(';', index)
          if (semicolon in (index + 1)..(index + 12)) {
            val decoded = decode(text.substring(index + 1, semicolon))
            if (decoded != null) {
              result.append(decoded)
              index = semicolon + 1
              continue
            }
          }
        }
        result.append(text[index])
        index++
      }
      return result.toString()
    }

    private fun decode(entity: String): String? = when (entity) {
      "amp" -> "&"
      "lt" -> "<"
      "gt" -> ">"
      "quot" -> "\""
      "apos" -> "'"
      "nbsp" -> " "
      else -> {
        if (!entity.startsWith("#")) {
          null
        } else {
          val number = entity.drop(1)
          val value = if (number.lowercase().startsWith("x")) number.drop(1).toIntOrNull(16) else number.toIntOrNull()
          value?.takeIf { Character.isValidCodePoint(it) }?.let { String(Character.toChars(it)) }
        }
      }
    }
  }

  private class Parser {
    val out = StringBuilder()
    val spans = mutableListOf<Span>()
    var bold = 0
    var italic = 0
    var code = 0
    var strike = 0
    var hidden = 0
    var quote = 0
    val links = mutableListOf<String?>()
    val openSpans = mutableListOf<String>()
    var blockStarted = false

    fun run(html: String): RichText {
      var index = 0
      val text = StringBuilder()
      while (index < html.length) {
        val char = html[index]
        val close = if (char == '<') html.indexOf('>', index) else -1
        if (close >= 0) {
          flush(text)
          tag(html.substring(index + 1, close))
          index = close + 1
        } else {
          text.append(char)
          index++
        }
      }
      flush(text)
      while (out.endsWith("\n")) out.setLength(out.length - 1)
      val length = out.length
      return RichText(out.toString(), spans.mapNotNull { s ->
        val end = minOf(s.end, length)
        if (end > s.start) s.copy(end = end) else null
      })
    }

    fun flush(text: StringBuilder) {
      if (text.isEmpty()) return
      val raw = text.toString()
      text.setLength(0)
      if (hidden > 0) return
      // Source newlines are not line breaks in HTML.
      val decoded = decodeEntities(raw.replace('\n', ' '))
      if (!blockStarted && decoded.isBlank()) return
      append(decoded)
    }

    fun append(string: String) {
      val start = out.length
      out.append(string)
      val end = out.length
      if (bold > 0) spans += Span(start, end, Style.BOLD)
      if (italic > 0 || quote > 0) spans += Span(start, end, Style.ITALIC)
      if (code > 0) spans += Span(start, end, Style.CODE)
      if (strike > 0) spans += Span(start, end, Style.STRIKE)
      links.lastOrNull { it != null }?.let { spans += Span(start, end, url = it) }
      blockStarted = true
    }

    fun newBlock(separator: String = "\n\n") {
      if (!blockStarted) return
      // Collapse to the separator: no stack of empty lines between blocks.
      while (out.endsWith("\n")) out.setLength(out.length - 1)
      out.append(separator)
    }

    fun tag(raw: String) {
      val closing = raw.startsWith("/")
      val body = if (closing) raw.drop(1) else raw
      val name = body.takeWhile { it.isLetterOrDigit() }.lowercase()
      fun step(value: Int) = maxOf(0, value + if (closing) -1 else 1)
      when {
        !closing && name in setOf("p", "blockquote", "ul", "ol", "pre") -> {
          newBlock()
          if (name == "blockquote") quote++
          if (name == "pre") code++
        }
        closing && name == "blockquote" -> { quote = maxOf(0, quote - 1); newBlock() }
        closing && name == "pre" -> { code = maxOf(0, code - 1); newBlock() }
        closing && name in setOf("p", "ul", "ol") -> newBlock()
        name == "br" -> out.append("\n")
        !closing && name == "li" -> { newBlock("\n"); append("• ") }
        name == "strong" || name == "b" -> bold = step(bold)
        name == "em" || name == "i" -> italic = step(italic)
        name == "code" -> code = step(code)
        name == "del" || name == "s" -> strike = step(strike)
        name == "a" && !closing -> {
          val href = attributes(body)["href"]
          links += href?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
        }
        name == "a" -> links.removeLastOrNull()
        name == "span" && !closing -> {
          val classes = (attributes(body)["class"] ?: "").split(' ')
          val kind = when {
            "invisible" in classes -> "invisible"
            "ellipsis" in classes -> "ellipsis"
            else -> ""
          }
          openSpans += kind
          if (kind == "invisible") hidden++
        }
        name == "span" -> when (openSpans.removeLastOrNull()) {
          "invisible" -> hidden = maxOf(0, hidden - 1)
          "ellipsis" -> append("…")
          else -> {}
        }
      }
    }
  }
}
