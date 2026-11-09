import DisbigleKit
import SwiftUI

/** What is being reported: an account, possibly about one of its posts. */
struct ReportTarget: Identifiable {
  let account: Account
  var status: Status?
  var id: String { status?.id ?? account.id }
}

/** Reports a post or a person to the moderators: why, and a few words if wanted. */
struct ReportSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let target: ReportTarget
  @State private var category: Client.ReportCategory = .spam
  @State private var comment = ""
  @State private var sending = false
  @State private var sent = false
  @State private var error: String?

  private func label(_ category: Client.ReportCategory) -> LocalizedStringKey {
    switch category {
    case .spam: "Spam"
    case .legal: "Illegal content"
    case .violation: "Breaks the server rules"
    case .other: "Something else"
    }
  }

  var body: some View {
    NavigationStack {
      Form {
        if sent {
          Section {
            Label("Thank you: the moderators will look at it.", systemImage: "checkmark.circle")
          }
        } else {
          Section {
            Text(target.status == nil ? "Report \(target.account.name)" : "Report this post by \(target.account.name)")
              .font(.headline)
          }
          Section("Why?") {
            Picker("Why?", selection: $category) {
              ForEach(Client.ReportCategory.allCases) { Text(label($0)).tag($0) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
          }
          Section("Anything to add? (optional)") {
            TextField("Write it here", text: $comment, axis: .vertical).lineLimit(3...8)
          }
          if let error { Section { Text(error).foregroundStyle(.red) } }
          Section {
            Button("Send report", role: .destructive) { Task { await send() } }
              .disabled(sending)
          } footer: {
            Text("Reports go to the moderators, who act within 24 hours. You can also block or mute this person.")
          }
        }
      }
      .navigationTitle("Report")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(sent ? "Done" : "Cancel") { dismiss() }
        }
      }
    }
  }

  private func send() async {
    guard let client = model.client else { return }
    sending = true
    defer { sending = false }
    do {
      try await client.report(
        account: target.account.id, statusIds: target.status.map { [$0.id] } ?? [],
        category: category, comment: comment)
      sent = true
    } catch {
      self.error = error.localizedDescription
    }
  }
}
