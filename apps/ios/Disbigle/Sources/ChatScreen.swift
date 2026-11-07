import DisbigleKit
import SwiftUI

/** How often an open chat asks for new messages (the app has no live stream). */
private let pollInterval: Duration = .seconds(8)

func presenceColor(_ state: String) -> Color {
  switch state {
  case "online": .green
  case "busy": .red
  default: .yellow
  }
}

func presenceLabel(_ state: String) -> LocalizedStringKey {
  switch state {
  case "online": "Online"
  case "busy": "Busy"
  default: "Away"
  }
}

/** A private conversation as a chat: bubbles, newest at the bottom, refreshed every few seconds. */
struct ChatScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  let id: String

  @State private var page: ChatPage?
  @State private var older: [Status] = []
  @State private var hasOlder = false
  @State private var error: String?
  @State private var text = ""
  @State private var sending = false

  private var people: [Account] { page?.accounts ?? [] }
  /** Oldest first, as the chat reads. */
  private var messages: [Status] {
    var seen = Set<String>()
    return ((page?.messages ?? []) + older).filter { seen.insert($0.id).inserted }.reversed()
  }

  var body: some View {
    VStack(spacing: 0) {
      if page == nil {
        if let error {
          ContentUnavailableView(error, systemImage: "exclamationmark.bubble")
        } else {
          ProgressView().frame(maxHeight: .infinity)
        }
      } else {
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(spacing: 4) {
              if hasOlder {
                Button("Older messages") { Task { await loadOlder() } }
                  .buttonStyle(.bordered)
                  .padding(.bottom, 8)
              }
              ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                ChatBubble(
                  status: message,
                  mine: message.account.id == model.me?.id,
                  showAuthor: people.count > 1 && (index == 0 || messages[index - 1].account.id != message.account.id))
              }
              if !seenBy.isEmpty {
                Text(people.count == 1 ? LocalizedStringKey("Seen") : "Seen by \(seenBy.map(\.name).joined(separator: ", "))")
                  .font(.caption2)
                  .foregroundStyle(.secondary)
                  .frame(maxWidth: .infinity, alignment: .trailing)
              }
              Color.clear.frame(height: 1).id("bottom")
            }
            .padding(12)
          }
          .onChange(of: messages.last?.id) { _, _ in
            withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
          }
          .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        if let error { Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal) }
        HStack(alignment: .bottom, spacing: 8) {
          TextField("Write a message", text: $text, axis: .vertical)
            .lineLimit(1...5)
            .textFieldStyle(.roundedBorder)
          Button {
            Task { await send() }
          } label: {
            Image(systemName: "paperplane.fill")
          }
          .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
          .accessibilityLabel(Text("Send"))
        }
        .padding(8)
      }
    }
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .principal) {
        VStack(spacing: 0) {
          Text(people.isEmpty ? "Only you" : people.map(\.name).joined(separator: ", "))
            .font(.headline).lineLimit(1)
          if let current = presence {
            HStack(spacing: 4) {
              Circle().fill(presenceColor(current.1)).frame(width: 7, height: 7)
              if people.count > 1 { Text("\(current.0.name):").font(.caption2) }
              Text(presenceLabel(current.1)).font(.caption2)
            }
            .foregroundStyle(.secondary)
          }
        }
      }
    }
    .task(id: id) {
      while !Task.isCancelled {
        await refresh()
        try? await Task.sleep(for: pollInterval)
      }
    }
  }

  private var presence: (Account, String)? {
    for person in people {
      if let state = page?.presence[person.id] { return (person, state) }
    }
    return nil
  }

  private var seenBy: [Account] {
    guard let mine = messages.last(where: { $0.account.id == model.me?.id }) else { return [] }
    return (page?.seen ?? []).filter { $0.lastReadId >= mine.id }
      .compactMap { seen in people.first { $0.id == seen.accountId } }
  }

  private func refresh() async {
    guard let client = model.client else { return }
    do {
      let fresh = try await client.chat(id)
      let known = page?.messages.first?.id
      if page == nil { hasOlder = fresh.messages.count >= 30 }
      page = fresh
      error = nil
      if let newest = fresh.messages.first?.id, newest != known {
        try? await client.markRead(conversation: id)
      }
    } catch {
      if page == nil { self.error = error.localizedDescription }
    }
  }

  private func loadOlder() async {
    guard let client = model.client, let oldest = messages.first?.id else { return }
    if let more = try? await client.chat(id, maxId: oldest) {
      older += more.messages
      hasOlder = more.messages.count >= 30
    }
  }

  private func send() async {
    guard let client = model.client else { return }
    let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !body.isEmpty else { return }
    sending = true
    defer { sending = false }
    // Every message names the participants: they are its recipients.
    let to = people.map { "@\($0.acct)" }.joined(separator: " ")
    do {
      _ = try await client.publish(
        PostDraft(
          text: to.isEmpty ? body : "\(to) \(body)", visibility: .direct,
          inReplyToId: messages.last?.id))
      text = ""
      await refresh()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

private struct ChatBubble: View {
  @Environment(Router.self) private var router
  let status: Status
  let mine: Bool
  let showAuthor: Bool

  var body: some View {
    VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
      if showAuthor && !mine {
        Text(status.account.name).font(.caption.weight(.medium)).foregroundStyle(.secondary)
          .padding(.leading, 12).padding(.top, 6)
      }
      VStack(alignment: .leading, spacing: 6) {
        if !status.spoilerText.isEmpty { Text(status.spoilerText).fontWeight(.semibold) }
        let text = RichText.attributed(RichText.withoutLeadingMentions(status.content))
        if !text.characters.isEmpty { Text(text) }
        if !status.mediaAttachments.isEmpty {
          MediaGrid(media: status.mediaAttachments, sensitive: status.sensitive)
        }
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .foregroundStyle(mine ? Color.white : Color.primary)
      .tint(mine ? .white : .brand)
      .background(
        mine ? Color.brand : Color(.secondarySystemBackground),
        in: UnevenRoundedRectangle(
          topLeadingRadius: 18, bottomLeadingRadius: mine ? 18 : 4,
          bottomTrailingRadius: mine ? 4 : 18, topTrailingRadius: 18))
      Button {
        router.go(.status(status))
      } label: {
        Text(status.createdAt, format: .relative(presentation: .numeric, unitsStyle: .narrow))
          .font(.caption2).foregroundStyle(.secondary)
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 6)
    }
    .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    .padding(mine ? .leading : .trailing, 48)
  }
}

/** Preview of the page a post links to; the image comes from our server, the page opens on tap. */
struct LinkCardView: View {
  @Environment(\.openURL) private var openURL
  let card: Card

  private var wide: Bool {
    guard card.image != nil, let w = card.width, let h = card.height, w > 0, h > 0 else { return false }
    return Double(w) / Double(h) >= 1.3
  }

  var body: some View {
    Button {
      if let url = URL(string: card.url) { openURL(url) }
    } label: {
      Group {
        if wide {
          VStack(alignment: .leading, spacing: 0) {
            image.frame(maxWidth: .infinity).aspectRatio(1.91, contentMode: .fill).frame(height: 150).clipped()
            texts
          }
        } else {
          HStack(spacing: 0) {
            if card.image != nil { image.frame(width: 88, height: 88).clipped() }
            texts
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(.separator)))
      .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    .buttonStyle(.plain)
  }

  private var image: some View {
    AsyncImage(url: card.image.flatMap(URL.init(string:))) { image in
      image.resizable().scaledToFill()
    } placeholder: {
      Color(.secondarySystemBackground)
    }
  }

  private var texts: some View {
    VStack(alignment: .leading, spacing: 2) {
      if !card.site.isEmpty { Text(card.site).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
      Text(card.title).font(.subheadline.weight(.semibold)).lineLimit(2)
      if !card.description.isEmpty {
        Text(card.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
