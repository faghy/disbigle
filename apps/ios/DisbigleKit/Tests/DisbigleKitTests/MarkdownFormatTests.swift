import Foundation
import XCTest

@testable import DisbigleKit

final class MarkdownFormatTests: XCTestCase {
  func testWrapsAndUnwraps() {
    let bold = applyFormat(.bold, to: "ciao mondo", selection: NSRange(location: 5, length: 5))
    XCTAssertEqual(bold, FormatEdit(text: "ciao **mondo**", selection: NSRange(location: 7, length: 5)))
    XCTAssertEqual(applyFormat(.bold, to: bold.text, selection: bold.selection).text, "ciao mondo")
    XCTAssertEqual(
      applyFormat(.italic, to: "ciao ", selection: NSRange(location: 5, length: 0)).text, "ciao *text*")
  }

  func testPrefixesLines() {
    let list = applyFormat(.numbered, to: "uno\ndue\ntre", selection: NSRange(location: 0, length: 11))
    XCTAssertEqual(list.text, "1. uno\n2. due\n3. tre")
    XCTAssertEqual(
      applyFormat(.numbered, to: list.text, selection: NSRange(location: 0, length: 20)).text,
      "uno\ndue\ntre")
    XCTAssertEqual(
      applyFormat(.heading, to: "> titolo", selection: NSRange(location: 3, length: 0)).text, "## titolo")
    XCTAssertEqual(
      applyFormat(.quote, to: "prima\nseconda", selection: NSRange(location: 7, length: 0)).text,
      "prima\n> seconda")
  }

  func testLinkSelectsTheAddress() {
    let link = applyFormat(.link, to: "vedi qui", selection: NSRange(location: 5, length: 3))
    XCTAssertEqual(link.text, "vedi [qui](https://)")
    XCTAssertEqual((link.text as NSString).substring(with: link.selection), "https://")
  }
}
