import Foundation

/**
 * Formatting buttons for the post text, which is Markdown (as on diaspora*): each one wraps the
 * selection or prefixes its lines, and pressing it again on formatted text removes the format.
 * Same behaviour as the web app. Positions are UTF-16 offsets (as `NSRange` and `UITextView`).
 */
public enum MarkdownFormat: String, CaseIterable, Sendable {
  case bold, italic, strike, code, heading, quote, list, numbered, link
}

public struct FormatEdit: Equatable, Sendable {
  public let text: String
  /** The new selection. */
  public let selection: NSRange
}

private let wraps: [MarkdownFormat: String] = [.bold: "**", .italic: "*", .strike: "~~", .code: "`"]
private let prefixes: [MarkdownFormat: String] = [.heading: "## ", .quote: "> ", .list: "- ", .numbered: "1. "]

public func applyFormat(
  _ format: MarkdownFormat, to text: String, selection: NSRange, placeholder: String = "text"
) -> FormatEdit {
  let source = text as NSString
  let from = max(0, min(selection.location, source.length))
  let to = max(from, min(selection.location + selection.length, source.length))
  let before = source.substring(to: from)
  let selected = source.substring(with: NSRange(location: from, length: to - from))
  let after = source.substring(from: to)

  if let mark = wraps[format] {
    let markLength = (mark as NSString).length
    if before.hasSuffix(mark) && after.hasPrefix(mark) {
      let text = String(before.dropLast(mark.count)) + selected + String(after.dropFirst(mark.count))
      return FormatEdit(text: text, selection: NSRange(location: from - markLength, length: to - from))
    }
    let inner = selected.isEmpty ? placeholder : selected
    return FormatEdit(
      text: before + mark + inner + mark + after,
      selection: NSRange(location: from + markLength, length: (inner as NSString).length))
  }
  if format == .link {
    let label = selected.isEmpty ? placeholder : selected
    let urlStart = from + (label as NSString).length + 3
    return FormatEdit(
      text: before + "[\(label)](https://)" + after,
      selection: NSRange(location: urlStart, length: 8))
  }
  let breakBefore = source.range(
    of: "\n", options: .backwards, range: NSRange(location: 0, length: from))
  let lineStart = breakBefore.location == NSNotFound ? 0 : breakBefore.location + 1
  let breakAfter = source.range(of: "\n", range: NSRange(location: to, length: source.length - to))
  let lineEnd = breakAfter.location == NSNotFound ? source.length : breakAfter.location
  let lines = source.substring(with: NSRange(location: lineStart, length: lineEnd - lineStart))
    .components(separatedBy: "\n")
  let prefix = prefixes[format] ?? ""
  let own = format == .numbered ? #"^\d+\. "# : "^" + NSRegularExpression.escapedPattern(for: prefix)
  let anyBlock = #"^(#{1,6} |> |- |\d+\. )"#
  let all = lines.allSatisfy { $0.range(of: own, options: .regularExpression) != nil }
  let changed = lines.enumerated().map { index, line in
    if all { return line.replacingOccurrences(of: own, with: "", options: .regularExpression) }
    let bare = line.replacingOccurrences(of: anyBlock, with: "", options: .regularExpression)
    return (format == .numbered ? "\(index + 1). " : prefix) + bare
  }.joined(separator: "\n")
  let result =
    source.substring(to: lineStart) + changed + source.substring(from: lineEnd)
  return FormatEdit(
    text: result, selection: NSRange(location: lineStart, length: (changed as NSString).length))
}
