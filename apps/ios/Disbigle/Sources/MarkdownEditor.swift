import DisbigleKit
import SwiftUI
import UIKit

/** A text editor that also tells where the selection is (for the formatting buttons). */
struct MarkdownEditor: UIViewRepresentable {
  @Binding var text: String
  @Binding var selection: NSRange
  var focusOnAppear = false

  func makeUIView(context: Context) -> UITextView {
    let view = UITextView()
    view.font = .preferredFont(forTextStyle: .body)
    view.adjustsFontForContentSizeCategory = true
    view.backgroundColor = .clear
    view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
    view.delegate = context.coordinator
    view.text = text
    if focusOnAppear {
      DispatchQueue.main.async { view.becomeFirstResponder() }
    }
    return view
  }

  func updateUIView(_ view: UITextView, context: Context) {
    if view.text != text { view.text = text }
    let length = (view.text as NSString).length
    let wanted = NSRange(
      location: min(selection.location, length),
      length: min(selection.length, max(0, length - min(selection.location, length))))
    if view.selectedRange != wanted { view.selectedRange = wanted }
  }

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  final class Coordinator: NSObject, UITextViewDelegate {
    var parent: MarkdownEditor
    init(_ parent: MarkdownEditor) { self.parent = parent }

    func textViewDidChange(_ view: UITextView) {
      parent.text = view.text
      parent.selection = view.selectedRange
    }

    func textViewDidChangeSelection(_ view: UITextView) {
      if parent.selection != view.selectedRange { parent.selection = view.selectedRange }
    }
  }
}

/** Buttons that write Markdown (as diaspora* reads it), and the switch to a preview of the post. */
struct FormattingBar: View {
  @Binding var previewing: Bool
  let onFormat: (MarkdownFormat) -> Void

  private let buttons: [(MarkdownFormat, String, LocalizedStringKey)] = [
    (.bold, "bold", "Bold"), (.italic, "italic", "Italic"), (.strike, "strikethrough", "Strikethrough"),
    (.heading, "textformat.size", "Heading"), (.quote, "text.quote", "Quote"),
    (.list, "list.bullet", "Bulleted list"), (.numbered, "list.number", "Numbered list"),
    (.code, "chevron.left.forwardslash.chevron.right", "Code"), (.link, "link", "Link"),
  ]

  var body: some View {
    HStack(spacing: 2) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 2) {
          ForEach(buttons, id: \.0) { format, symbol, label in
            Button {
              onFormat(format)
            } label: {
              Image(systemName: symbol).frame(width: 32, height: 28)
            }
            .buttonStyle(.borderless)
            .disabled(previewing)
            .accessibilityLabel(Text(label))
          }
        }
      }
      Toggle("Preview", isOn: $previewing)
        .toggleStyle(.button)
        .font(.footnote)
    }
  }
}

/** The text as it will look once published (rendered by the server). */
struct PostPreview: View {
  @Environment(AppModel.self) private var model
  let text: String
  @State private var html: String?

  var body: some View {
    Group {
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        Text("Nothing to preview yet.").foregroundStyle(.secondary)
      } else if let html {
        Text(RichText.attributed(html))
      } else {
        ProgressView()
      }
    }
    .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
    .task(id: text) {
      html = nil
      guard !text.isEmpty, let client = model.client else { return }
      html = (try? await client.previewPost(text)) ?? ""
    }
  }
}
