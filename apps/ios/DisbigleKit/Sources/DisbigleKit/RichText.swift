import Foundation

/**
 * Post HTML (Mastodon flavour: paragraphs, links, mentions, emphasis, lists, quotes) as an
 * attributed string. Unknown tags keep their text; scripts and styles never get here, as servers
 * sanitise post HTML, and nothing is ever rendered as HTML.
 */
public enum RichText {
  public static func attributed(_ html: String) -> AttributedString {
    var parser = Parser()
    parser.run(html)
    return parser.output
  }

  /** The text alone, on one line where possible (for previews and accessibility). */
  public static func plain(_ html: String) -> String {
    String(attributed(html).characters)
      .replacingOccurrences(of: "\n\n", with: "\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private struct Style {
    var bold = 0, italic = 0, code = 0, strike = 0, hidden = 0, quote = 0
    var links: [URL?] = []
    var ellipsis: [Bool] = []
  }

  private struct Parser {
    var output = AttributedString()
    var style = Style()
    var blockStarted = false
    var openSpans: [String] = []

    mutating func run(_ html: String) {
      var index = html.startIndex
      var text = ""
      while index < html.endIndex {
        let char = html[index]
        if char == "<", let close = html[index...].firstIndex(of: ">") {
          flush(&text)
          tag(String(html[html.index(after: index)..<close]))
          index = html.index(after: close)
        } else {
          text.append(char)
          index = html.index(after: index)
        }
      }
      flush(&text)
      while output.characters.last == "\n" { output.characters.removeLast() }
    }

    mutating func flush(_ text: inout String) {
      guard !text.isEmpty else { return }
      defer { text = "" }
      if style.hidden > 0 { return }
      // Source newlines are not line breaks in HTML.
      let decoded = RichText.decodeEntities(text.replacingOccurrences(of: "\n", with: " "))
      if !blockStarted && decoded.trimmingCharacters(in: .whitespaces).isEmpty { return }
      append(decoded)
    }

    mutating func append(_ string: String) {
      var piece = AttributedString(string)
      #if canImport(Darwin)
        // SwiftUI's Text draws these; corelibs Foundation (Linux) has no presentation intents.
        var intent: InlinePresentationIntent = []
        if style.bold > 0 { intent.insert(.stronglyEmphasized) }
        if style.italic > 0 || style.quote > 0 { intent.insert(.emphasized) }
        if style.code > 0 { intent.insert(.code) }
        if style.strike > 0 { intent.insert(.strikethrough) }
        if !intent.isEmpty { piece.inlinePresentationIntent = intent }
      #endif
      if let link = style.links.last(where: { $0 != nil }) ?? nil { piece.link = link }
      output.append(piece)
      blockStarted = true
    }

    mutating func newBlock(_ separator: String = "\n\n") {
      guard blockStarted else { return }
      // Collapse to the separator: no stack of empty lines between blocks.
      while output.characters.last == "\n" { output.characters.removeLast() }
      output.append(AttributedString(separator))
    }

    mutating func tag(_ raw: String) {
      let closing = raw.hasPrefix("/")
      let body = closing ? String(raw.dropFirst()) : raw
      let name = body.prefix { $0.isLetter || $0.isNumber }.lowercased()
      let attributes = RichText.attributes(body)
      switch (name, closing) {
      case ("p", false), ("blockquote", false), ("ul", false), ("ol", false), ("pre", false):
        newBlock()
        if name == "blockquote" { style.quote += 1 }
        if name == "pre" { style.code += 1 }
      case ("blockquote", true):
        style.quote = max(0, style.quote - 1)
        newBlock()
      case ("pre", true):
        style.code = max(0, style.code - 1)
        newBlock()
      case ("p", true), ("ul", true), ("ol", true):
        newBlock()
      case ("br", _):
        output.append(AttributedString("\n"))
      case ("li", false):
        newBlock("\n")
        append("• ")
      case ("strong", _), ("b", _):
        style.bold = max(0, style.bold + (closing ? -1 : 1))
      case ("em", _), ("i", _):
        style.italic = max(0, style.italic + (closing ? -1 : 1))
      case ("code", _):
        style.code = max(0, style.code + (closing ? -1 : 1))
      case ("del", _), ("s", _):
        style.strike = max(0, style.strike + (closing ? -1 : 1))
      case ("a", false):
        let href = attributes["href"].flatMap { URL(string: $0) }
        style.links.append(href.flatMap { ["http", "https"].contains($0.scheme) ? $0 : nil })
      case ("a", true):
        _ = style.links.popLast()
      case ("span", false):
        let classes = (attributes["class"] ?? "").split(separator: " ")
        let kind =
          classes.contains("invisible") ? "invisible" : classes.contains("ellipsis") ? "ellipsis" : ""
        openSpans.append(kind)
        if kind == "invisible" { style.hidden += 1 }
      case ("span", true):
        switch openSpans.popLast() {
        case "invisible": style.hidden = max(0, style.hidden - 1)
        case "ellipsis": append("…")
        default: break
        }
      default:
        break
      }
    }
  }

  /** `name="value"` pairs of a tag (double or single quotes). */
  static func attributes(_ tag: String) -> [String: String] {
    var result: [String: String] = [:]
    let scanner = tag.dropFirst(tag.prefix { $0.isLetter || $0.isNumber }.count)
    var rest = Substring(scanner)
    while let eq = rest.firstIndex(of: "=") {
      let key = rest[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
        .split(separator: " ").last.map(String.init) ?? ""
      var after = rest[rest.index(after: eq)...].drop { $0 == " " }
      guard let quote = after.first, quote == "\"" || quote == "'" else { break }
      after = after.dropFirst()
      guard let end = after.firstIndex(of: quote) else { break }
      result[key] = decodeEntities(String(after[..<end]))
      rest = after[after.index(after: end)...]
    }
    return result
  }

  static func decodeEntities(_ text: String) -> String {
    guard text.contains("&") else { return text }
    var result = ""
    var index = text.startIndex
    while index < text.endIndex {
      if text[index] == "&", let semicolon = text[index...].prefix(12).firstIndex(of: ";") {
        let entity = text[text.index(after: index)..<semicolon]
        if let decoded = decode(entity) {
          result.append(decoded)
          index = text.index(after: semicolon)
          continue
        }
      }
      result.append(text[index])
      index = text.index(after: index)
    }
    return result
  }

  private static func decode(_ entity: Substring) -> String? {
    switch entity {
    case "amp": return "&"
    case "lt": return "<"
    case "gt": return ">"
    case "quot": return "\""
    case "apos": return "'"
    case "nbsp": return "\u{00A0}"
    default:
      guard entity.hasPrefix("#") else { return nil }
      let number = entity.dropFirst()
      let value =
        number.lowercased().hasPrefix("x")
        ? UInt32(number.dropFirst(), radix: 16) : UInt32(number, radix: 10)
      return value.flatMap(Unicode.Scalar.init).map { String(Character($0)) }
    }
  }
}
