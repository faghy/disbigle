import DisbigleKit
import PhotosUI
import SwiftUI

/** Writing a post, a reply or a direct message, or editing one of your posts. */
struct ComposeView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let target: ComposeTarget

  @State private var text = ""
  @State private var visibility: DisbigleKit.Visibility = .public
  @State private var aspectIds: Set<String> = []
  @State private var aspects: [AspectList] = []
  @State private var warning = ""
  @State private var warningOn = false
  @State private var sensitive = false
  @State private var media: [Attachment] = []
  @State private var picked: [PhotosPickerItem] = []
  @State private var poll: PostDraft.PollDraft?
  @State private var sending = false
  @State private var loadingSource = false
  @State private var error: String?
  @FocusState private var textFocused: Bool
  /** Sent with every attempt, so a retry after a lost answer does not post twice. */
  @State private var idempotencyKey = UUID().uuidString

  /** An attachment being uploaded, or uploaded. */
  struct Attachment: Identifiable {
    let id = UUID()
    var preview: Image?
    var uploaded: MediaAttachment?
    var description = ""
    var failed: String?
  }

  private var maxCharacters: Int { model.instance?.maxCharacters ?? 5000 }
  private var maxMedia: Int { model.instance?.maxMediaAttachments ?? 4 }
  private var uploading: Bool { media.contains { $0.uploaded == nil && $0.failed == nil } }
  private var editing: Status? {
    if case .edit(let status) = target { return status }
    return nil
  }
  private var replyTo: Status? {
    if case .reply(let status) = target { return status }
    return nil
  }
  private var canSend: Bool {
    let hasContent =
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !media.isEmpty || poll != nil
    return hasContent && text.count <= maxCharacters && !uploading && !sending
      && !media.contains { $0.failed != nil }
      && (poll.map { $0.options.allSatisfy { !$0.trimmingCharacters(in: .whitespaces).isEmpty } } ?? true)
  }

  var body: some View {
    NavigationStack {
      Form {
        if let replyTo {
          Section {
            Text(RichText.plain(replyTo.content))
              .font(.footnote)
              .foregroundStyle(.secondary)
              .lineLimit(3)
          } header: {
            Text("Replying to \(replyTo.account.name)")
          }
        }
        if warningOn {
          TextField("Content warning", text: $warning)
        }
        Section {
          ZStack(alignment: .topLeading) {
            if text.isEmpty {
              Text(placeholder).foregroundStyle(.tertiary).padding(.top, 8).padding(.leading, 5)
            }
            TextEditor(text: $text)
              .frame(minHeight: 160)
              .focused($textFocused)
              .disabled(loadingSource)
          }
          HStack {
            Spacer()
            Text("\(maxCharacters - text.count)")
              .font(.footnote.monospacedDigit())
              .foregroundStyle(text.count > maxCharacters ? .red : .secondary)
              .accessibilityLabel(Text("\(maxCharacters - text.count) characters left"))
          }
        }
        if !media.isEmpty { mediaSection }
        if poll != nil { pollSection }
        if editing == nil && replyTo == nil { audienceSection }
        Section {
          Toggle("Content warning", isOn: $warningOn.animation())
          if !media.isEmpty { Toggle("Sensitive media", isOn: $sensitive) }
        }
        if let error {
          Section { Text(error).foregroundStyle(.red) }
        }
      }
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if sending {
            ProgressView()
          } else {
            Button(editing == nil ? "Post" : "Save") { Task { await send() } }
              .disabled(!canSend)
          }
        }
        ToolbarItemGroup(placement: .keyboard) {
          PhotosPicker(
            selection: $picked, maxSelectionCount: max(0, maxMedia - media.count), matching: .images
          ) {
            Image(systemName: "photo")
          }
          .disabled(media.count >= maxMedia || poll != nil)
          .accessibilityLabel(Text("Add photos"))
          Button {
            poll = poll == nil ? .init(options: ["", ""], expiresIn: 86_400, multiple: false) : nil
          } label: {
            Image(systemName: "chart.bar")
          }
          .disabled(!media.isEmpty)
          .accessibilityLabel(Text(poll == nil ? "Add a poll" : "Remove the poll"))
          Spacer()
        }
      }
      .onChange(of: picked) { _, items in
        guard !items.isEmpty else { return }
        picked = []
        for item in items { Task { await upload(item) } }
      }
      .task { await prepare() }
      .interactiveDismissDisabled(!text.isEmpty || !media.isEmpty)
    }
  }

  private var title: LocalizedStringKey {
    switch target {
    case .new: "New post"
    case .reply: "Reply"
    case .edit: "Edit post"
    }
  }

  private var placeholder: LocalizedStringKey {
    visibility == .direct
      ? "Write @name@server to choose who gets the message" : "What's on your mind?"
  }

  private var mediaSection: some View {
    Section("Attachments") {
      ForEach($media) { $item in
        HStack(alignment: .top, spacing: 12) {
          ZStack {
            if let preview = item.preview {
              preview.resizable().scaledToFill()
            } else if let url = item.uploaded.flatMap({ URL(string: $0.previewUrl ?? $0.url) }) {
              AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.2) }
            } else {
              Color.secondary.opacity(0.2)
            }
            if item.uploaded == nil && item.failed == nil { ProgressView() }
          }
          .frame(width: 72, height: 72)
          .clipShape(RoundedRectangle(cornerRadius: 8))
          VStack(alignment: .leading) {
            if let failed = item.failed {
              Text(failed).font(.footnote).foregroundStyle(.red)
            }
            TextField("Describe the image for people who can't see it", text: $item.description, axis: .vertical)
              .font(.footnote)
              .lineLimit(2...4)
          }
        }
      }
      .onDelete { media.remove(atOffsets: $0) }
    }
  }

  private var pollSection: some View {
    Section("Poll") {
      if let current = poll {
        ForEach(current.options.indices, id: \.self) { index in
          HStack {
            TextField(
              "Option \(index + 1)",
              text: Binding(
                get: { poll?.options[safe: index] ?? "" },
                set: { if poll?.options.indices.contains(index) == true { poll?.options[index] = String($0.prefix(100)) } }))
            if current.options.count > 2 {
              Button {
                poll?.options.remove(at: index)
              } label: {
                Image(systemName: "minus.circle.fill").foregroundStyle(.red)
              }
              .buttonStyle(.borderless)
              .accessibilityLabel(Text("Remove option \(index + 1)"))
            }
          }
        }
        if current.options.count < 6 {
          Button("Add option") { poll?.options.append("") }
        }
        Picker(
          "Ends in",
          selection: Binding(get: { poll?.expiresIn ?? 86_400 }, set: { poll?.expiresIn = $0 })
        ) {
          Text("5 minutes").tag(300)
          Text("1 hour").tag(3600)
          Text("6 hours").tag(21_600)
          Text("1 day").tag(86_400)
          Text("3 days").tag(259_200)
          Text("7 days").tag(604_800)
        }
        Toggle(
          "Several answers",
          isOn: Binding(get: { poll?.multiple ?? false }, set: { poll?.multiple = $0 }))
        if let editing, editing.poll != nil {
          Text("Changing the options or the kind of poll clears the votes cast so far.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
    }
  }

  private var audienceSection: some View {
    Section("Who can see it") {
      Picker("DisbigleKit.Visibility", selection: $visibility) {
        Label("Everyone", systemImage: "globe").tag(DisbigleKit.Visibility.public)
        Label("Everyone, not in timelines", systemImage: "lock.open").tag(DisbigleKit.Visibility.unlisted)
        Label("Followers", systemImage: "lock").tag(DisbigleKit.Visibility.private)
        Label("Only people mentioned", systemImage: "at").tag(DisbigleKit.Visibility.direct)
      }
      .disabled(!aspectIds.isEmpty)
      if !aspects.isEmpty && visibility != .direct {
        ForEach(aspects) { aspect in
          Toggle(
            aspect.title,
            isOn: Binding(
              get: { aspectIds.contains(aspect.id) },
              set: { on in
                if on { aspectIds.insert(aspect.id) } else { aspectIds.remove(aspect.id) }
              }))
        }
        Text("Choosing aspects shares the post with their members only.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    }
  }

  // MARK: Actions

  private func prepare() async {
    guard let client = model.client else { return }
    switch target {
    case .new:
      aspects = (try? await client.aspects()) ?? []
      textFocused = true
    case .reply(let status):
      // Replies to private posts stay private; mention whoever is in the conversation.
      visibility = status.visibility == .public ? .public : status.visibility
      let names = ([status.account] + []).map(\.acct) + status.mentions.map(\.acct)
      let others = Set(names).subtracting([model.me?.acct ?? ""])
      text = others.sorted().map { "@\($0) " }.joined()
      textFocused = true
    case .edit(let status):
      loadingSource = true
      defer { loadingSource = false }
      text = (try? await client.source(of: status.id)) ?? RichText.plain(status.content)
      warning = status.spoilerText
      warningOn = !status.spoilerText.isEmpty
      sensitive = status.sensitive
      visibility = status.visibility
      media = status.mediaAttachments.map {
        Attachment(uploaded: $0, description: $0.description ?? "")
      }
      // The API wants the poll with every edit: the time left keeps the closing time where it is.
      poll = status.poll.map {
        let left = Int(($0.expiresAt ?? .now).timeIntervalSinceNow)
        return .init(
          options: $0.options.map(\.title), expiresIn: min(max(left, 300), 30 * 86_400),
          multiple: $0.multiple)
      }
      textFocused = true
    }
  }

  private func upload(_ item: PhotosPickerItem) async {
    guard let client = model.client else { return }
    var attachment = Attachment()
    let id = attachment.id
    guard let data = try? await item.loadTransferable(type: Data.self),
      let image = UIImage(data: data)
    else {
      attachment.failed = String(localized: "This image can't be read.")
      media.append(attachment)
      return
    }
    attachment.preview = Image(uiImage: image)
    media.append(attachment)
    // JPEG travels everywhere (HEIC does not), and drops the location metadata.
    let jpeg = image.jpegData(compressionQuality: 0.85) ?? data
    do {
      let uploaded = try await client.upload(jpeg, filename: "photo.jpg", mimeType: "image/jpeg")
      if let index = media.firstIndex(where: { $0.id == id }) { media[index].uploaded = uploaded }
    } catch {
      if let index = media.firstIndex(where: { $0.id == id }) {
        media[index].failed = error.localizedDescription
      }
    }
  }

  private func send() async {
    guard let client = model.client, canSend else { return }
    sending = true
    error = nil
    defer { sending = false }
    do {
      // Alt text first, so the post never goes out without it.
      for item in media {
        if let uploaded = item.uploaded, item.description != (uploaded.description ?? "") {
          try await client.perform(
            "PUT", "api/v1/media/\(uploaded.id)",
            body: .json(["description": .string(item.description)]))
        }
      }
      let draft = PostDraft(
        text: text,
        visibility: visibility,
        spoilerText: warningOn ? warning.trimmingCharacters(in: .whitespaces) : "",
        sensitive: sensitive && !media.isEmpty,
        inReplyToId: replyTo?.id,
        mediaIds: media.compactMap { $0.uploaded?.id },
        poll: poll.map { .init(options: $0.options.map { $0.trimmingCharacters(in: .whitespaces) }, expiresIn: $0.expiresIn, multiple: $0.multiple) },
        aspectIds: visibility == .direct ? [] : Array(aspectIds))
      let saved =
        if let editing {
          try await client.edit(editing.id, draft)
        } else {
          try await client.publish(draft, idempotencyKey: idempotencyKey)
        }
      model.saved(saved)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

extension Array {
  subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
