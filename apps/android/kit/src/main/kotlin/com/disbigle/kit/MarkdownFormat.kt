package com.disbigle.kit

/**
 * Formatting buttons for the post text, which is Markdown (as on diaspora*): each one wraps the
 * selection or prefixes its lines, and pressing it again on formatted text removes the format.
 * Same behaviour as the web app.
 */
enum class Format { BOLD, ITALIC, STRIKE, CODE, HEADING, QUOTE, LIST, NUMBERED, LINK }

/** Text after a format, with the new selection [start, end). */
data class FormatEdit(val text: String, val start: Int, val end: Int)

private val wraps = mapOf(Format.BOLD to "**", Format.ITALIC to "*", Format.STRIKE to "~~", Format.CODE to "`")
private val prefixes = mapOf(Format.HEADING to "## ", Format.QUOTE to "> ", Format.LIST to "- ", Format.NUMBERED to "1. ")
private val anyBlock = Regex("^(#{1,6} |> |- |\\d+\\. )")

fun applyFormat(text: String, start: Int, end: Int, format: Format, placeholder: String = "text"): FormatEdit {
  val from = minOf(start, end).coerceIn(0, text.length)
  val to = maxOf(start, end).coerceIn(0, text.length)
  wraps[format]?.let { mark ->
    val before = text.substring(0, from)
    val selected = text.substring(from, to)
    val after = text.substring(to)
    if (before.endsWith(mark) && after.startsWith(mark)) {
      return FormatEdit(before.dropLast(mark.length) + selected + after.drop(mark.length), from - mark.length, to - mark.length)
    }
    val inner = selected.ifEmpty { placeholder }
    return FormatEdit(before + mark + inner + mark + after, from + mark.length, from + mark.length + inner.length)
  }
  if (format == Format.LINK) {
    val label = text.substring(from, to).ifEmpty { placeholder }
    val urlStart = from + label.length + 3
    return FormatEdit(text.substring(0, from) + "[$label](https://)" + text.substring(to), urlStart, urlStart + "https://".length)
  }
  val lineStart = text.lastIndexOf('\n', (from - 1).coerceAtLeast(0)).let { if (from == 0) 0 else it + 1 }
  val nextBreak = text.indexOf('\n', to)
  val lineEnd = if (nextBreak == -1) text.length else nextBreak
  val lines = text.substring(lineStart, lineEnd).split('\n')
  val prefix = prefixes.getValue(format)
  val own = if (format == Format.NUMBERED) Regex("^\\d+\\. ") else Regex("^" + Regex.escape(prefix))
  val all = lines.all { own.containsMatchIn(it) }
  val changed = lines.mapIndexed { index, line ->
    if (all) line.replaceFirst(own, "")
    else (if (format == Format.NUMBERED) "${index + 1}. " else prefix) + line.replaceFirst(anyBlock, "")
  }.joinToString("\n")
  return FormatEdit(text.substring(0, lineStart) + changed + text.substring(lineEnd), lineStart, lineStart + changed.length)
}
