import Foundation

/** A post translated by the server's translation service. */
public struct StatusTranslation: Codable, Hashable, Sendable {
  /** HTML, like the post's content. */
  public let content: String
  public let spoilerText: String?
  public let detectedSourceLanguage: String?
  public let provider: String?
}

/** When a post can be translated, and into what. */
public enum Translations {
  /** The base code of a language tag: "it" for "it-IT" or "IT_it"; nil when there is none. */
  public static func baseLanguage(_ tag: String?) -> String? {
    guard let tag else { return nil }
    let base = tag.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map { $0.lowercased() }
    guard let base, !base.isEmpty else { return nil }
    return base
  }

  /** The language to translate into: the first one the person prefers (English otherwise). */
  public static func readerLanguage(preferred: [String] = Locale.preferredLanguages) -> String {
    preferred.lazy.compactMap(baseLanguage).first ?? "en"
  }

  /**
   * A post in `source` can be translated into `target` when the languages differ and the
   * server lists that pair (`GET /api/v1/instance/translation_languages`).
   */
  public static func canTranslate(
    from source: String?, to target: String, languages: [String: [String]]
  ) -> Bool {
    guard let source = baseLanguage(source), let target = baseLanguage(target), source != target
    else { return false }
    return languages.contains { key, targets in
      baseLanguage(key) == source && targets.contains { baseLanguage($0) == target }
    }
  }
}

extension Client {
  // MARK: Translation

  /** Translates a post into `language` (the account's language when nil). */
  public func translate(_ statusId: String, to language: String? = nil) async throws -> StatusTranslation {
    try await call(
      "POST", "api/v1/statuses/\(statusId)/translate",
      body: .json(Self.translationBody(language)))
  }

  static func translationBody(_ language: String?) -> [String: JSONValue] {
    language.map { ["lang": .string($0)] } ?? [:]
  }

  /** Source language → languages it can be translated into. */
  public func translationLanguages() async throws -> [String: [String]] {
    try await get("api/v1/instance/translation_languages")
  }
}
