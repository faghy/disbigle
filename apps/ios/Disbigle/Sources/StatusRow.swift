import DisbigleKit
import SwiftUI

/** One post in a list: tap to open its thread. */
struct StatusRow: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  let status: Status
  var onDelete: (String) -> Void = { _ in }
  /** The post at the top of a thread: larger text, full date, no tap target. */
  var focused = false

  /** The shown post as changed by actions here (likes, edits), until the list reloads it. */
  @State private var updated: Status?
  @State private var revealed = false
  @State private var confirmDelete = false
  @State private var confirmReshare = false
  @State private var reshareBlocked = false
  @State private var actionError: String?
  @State private var translating = false
  @State private var translationFailed = false
  /** Who liked or reshared one of your posts, shown in a sheet. */
  @State private var reactions: Client.Reaction?
  /** What was just hidden in place of the post, to say so and offer to undo it. */
  @State private var hidden: HiddenNote?
  @State private var reporting: ReportTarget?

  private enum HiddenNote: Equatable {
    case post
    case tag(id: String, name: String, accountName: String)
  }

  private var shown: Status { updated ?? status.shown }
  private var isMine: Bool { model.me?.id == shown.account.id }

  var body: some View {
    if let hidden {
      hiddenPlaceholder(hidden)
    } else {
      post
    }
  }

  /** In place of a post just hidden: what will no longer be shown, and the way back. */
  private func hiddenPlaceholder(_ note: HiddenNote) -> some View {
    HStack(spacing: 12) {
      Image(systemName: "eye.slash")
      Group {
        switch note {
        case .post: Text("Post hidden: you won't see it in your timelines.")
        case .tag(_, let name, let accountName):
          Text("You won't see \(accountName)'s posts with #\(name) in your timelines.")
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button("Undo") { Task { await undoHiding(note) } }
        .buttonStyle(.borderless)
    }
    .font(.subheadline)
    .foregroundStyle(.secondary)
    .padding(.vertical, 6)
    .alert(
      "Something went wrong", isPresented: .constant(actionError != nil),
      actions: { Button("OK") { actionError = nil } }, message: { Text(actionError ?? "") })
  }

  private var canHide: Bool { !isMine && !focused && model.me != nil }

  private var post: some View {
    VStack(alignment: .leading, spacing: 8) {
      if status.reblog != nil {
        Label {
          Text("\(status.account.name) reshared")
        } icon: {
          Image(systemName: "arrow.2.squarepath")
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
      }
      HStack(alignment: .top, spacing: 12) {
        Button {
          router.go(.account(shown.account))
        } label: {
          Avatar(account: shown.account, size: 44)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(Text("Profile of \(shown.account.name)"))

        VStack(alignment: .leading, spacing: 6) {
          header
          content
          if !shown.mediaAttachments.isEmpty {
            MediaGrid(media: shown.mediaAttachments, sensitive: shown.sensitive)
          }
          if let card = shown.card, shown.mediaAttachments.isEmpty, shown.poll == nil {
            LinkCardView(card: card)
          }
          if let poll = shown.poll {
            PollView(poll: poll) { updated in
              updatedPoll(updated)
            }
          }
          if focused { details }
          actions
        }
      }
    }
    .padding(.vertical, 6)
    .contentShape(Rectangle())
    .onTapGesture {
      if !focused { router.go(.status(shown)) }
    }
    .onChange(of: status) { _, _ in updated = nil }
    .environment(\.openURL, OpenURLAction(handler: open))
    .confirmationDialog("Delete this post?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { Task { await delete() } }
    }
    .confirmationDialog("Reshare this post?", isPresented: $confirmReshare, titleVisibility: .visible) {
      Button("Reshare") { Task { await act(.reblog) } }
    } message: {
      Text(
        shown.visibility == .public
          ? "It will appear to the people who follow you and on your profile. The post is public, so anyone can see it."
          : "It will appear to the people who follow you and on your profile. The post is unlisted, so it stays out of the public timelines.")
    }
    .alert("This post can't be reshared", isPresented: $reshareBlocked) {
      Button("OK") {}
    } message: {
      Text("Its author shared it only with some people (followers, an aspect or a direct message), so it stays with them: only public posts can be reshared.")
    }
    .sheet(item: $reporting) { ReportSheet(target: $0) }
    .sheet(item: $reactions) { reaction in
      ReactionsSheet(status: shown, reaction: reaction) { account in
        reactions = nil
        router.go(.account(account))
      }
    }
    .alert(
      "Something went wrong", isPresented: .constant(actionError != nil),
      actions: { Button("OK") { actionError = nil } }, message: { Text(actionError ?? "") })
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text(shown.account.name).font(.subheadline.bold()).lineLimit(1)
      Text("@\(shown.account.acct)").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
      Spacer(minLength: 4)
      VisibilityIcon(visibility: shown.visibility)
      Text(shown.createdAt, format: .relative(presentation: .numeric, unitsStyle: .narrow))
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }

  @ViewBuilder private var content: some View {
    if !shown.spoilerText.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        Text(translation?.spoilerText.flatMap { $0.isEmpty ? nil : $0 } ?? shown.spoilerText)
          .font(.body.weight(.semibold))
        Button(revealed ? LocalizedStringKey("Show less") : "Show more") { revealed.toggle() }
          .buttonStyle(.bordered)
          .controlSize(.small)
      }
    }
    if shown.spoilerText.isEmpty || revealed {
      Text(RichText.attributed(translation?.content ?? shown.content))
        .font(focused ? .title3 : .body)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
    translationControls
  }

  /** The translation on show, if the person asked for it. */
  private var translation: StatusTranslation? {
    model.showingTranslation.contains(shown.id) ? model.translations[shown.id] : nil
  }

  @ViewBuilder private var translationControls: some View {
    if let translation {
      HStack(spacing: 8) {
        Text("Translated from \(languageName(translation.detectedSourceLanguage ?? shown.language))")
          .foregroundStyle(.secondary)
        Button("Show original") { _ = model.showingTranslation.remove(shown.id) }
      }
      .font(.footnote)
      .buttonStyle(.borderless)
    } else if model.canTranslate(shown) {
      HStack(spacing: 8) {
        if translating {
          ProgressView().controlSize(.small)
          Text("Translating…").foregroundStyle(.secondary)
        } else {
          Button {
            Task { await translate() }
          } label: {
            Label("Translate", systemImage: "character.bubble")
          }
          if translationFailed {
            Text("Translation is not available right now").foregroundStyle(.secondary)
          }
        }
      }
      .font(.footnote)
      .buttonStyle(.borderless)
    }
  }

  private func languageName(_ code: String?) -> String {
    guard let code = Translations.baseLanguage(code) else { return "" }
    return Locale.current.localizedString(forLanguageCode: code) ?? code
  }

  private var details: some View {
    HStack(spacing: 6) {
      Text(shown.createdAt, format: .dateTime)
      if let edited = shown.editedAt {
        Text("· edited \(edited.formatted(.relative(presentation: .named)))")
      }
    }
    .font(.footnote)
    .foregroundStyle(.secondary)
  }

  private var reshareable: Bool { shown.visibility == .public || shown.visibility == .unlisted }

  private var actions: some View {
    HStack {
      ActionButton(
        systemImage: "arrowshape.turn.up.left", count: shown.repliesCount, active: false,
        label: "Reply"
      ) { model.composing = .reply(shown) }
      Spacer()
      // Only public and unlisted posts can be reshared (the server refuses the others): the
      // button says so, and asks before resharing, telling who will see it.
      ActionButton(
        systemImage: "arrow.2.squarepath", count: shown.reblogsCount,
        active: shown.reblogged == true, label: "Reshare",
        dimmed: !reshareable && shown.reblogged != true,
        countLabel: "Reshares",
        showCount: isMine ? { reactions = .reshares } : nil
      ) {
        if shown.reblogged == true {
          await act(.unreblog)
        } else if reshareable {
          confirmReshare = true
        } else {
          reshareBlocked = true
        }
      }
      Spacer()
      ActionButton(
        systemImage: shown.favourited == true ? "heart.fill" : "heart", count: shown.favouritesCount,
        active: shown.favourited == true, label: "Like",
        countLabel: "Likes",
        showCount: isMine ? { reactions = .likes } : nil
      ) { await act(shown.favourited == true ? .unfavourite : .favourite) }
      Spacer()
      ActionButton(
        systemImage: shown.bookmarked == true ? "bookmark.fill" : "bookmark", count: nil,
        active: shown.bookmarked == true, label: "Bookmark"
      ) { await act(shown.bookmarked == true ? .unbookmark : .bookmark) }
      Spacer()
      Menu {
        if let url = shown.url.flatMap(URL.init(string:)) {
          ShareLink(item: url)
          Button {
            UIPasteboard.general.url = url
          } label: {
            Label("Copy link", systemImage: "link")
          }
        }
        if canHide {
          Button {
            Task { await hidePost() }
          } label: {
            Label("Hide this post", systemImage: "eye.slash")
          }
          // A hashtag from this person only; everyone's is hidden from the hashtag's page.
          ForEach(hideableTags, id: \.self) { tag in
            Button {
              Task { await hideTag(tag) }
            } label: {
              Label("Hide #\(tag) from \(shown.account.name)", systemImage: "number")
            }
          }
        }
        if !isMine && model.me != nil {
          Button(role: .destructive) {
            reporting = ReportTarget(account: shown.account, status: shown)
          } label: {
            Label("Report post", systemImage: "flag")
          }
        }
        if isMine {
          Button {
            model.composing = .edit(shown)
          } label: {
            Label("Edit", systemImage: "pencil")
          }
          Button(role: .destructive) {
            confirmDelete = true
          } label: {
            Label("Delete", systemImage: "trash")
          }
        }
      } label: {
        Image(systemName: "ellipsis")
          .frame(width: 32, height: 28)
          .contentShape(Rectangle())
      }
      .accessibilityLabel(Text("More actions"))
    }
    .buttonStyle(.borderless)
    .foregroundStyle(.secondary)
    .font(.subheadline)
    .padding(.top, 2)
  }

  private func act(_ action: Client.Action) async {
    guard let client = model.client else { return }
    do {
      let result = try await client.act(action, on: shown.id)
      // A reshare comes back wrapped in the new reblog: keep the original.
      updated = result.shown
    } catch {
      actionError = error.localizedDescription
    }
  }

  private var hideableTags: [String] {
    var seen = Set<String>()
    return Array(shown.tags.map { $0.name.lowercased() }.filter { seen.insert($0).inserted }.prefix(3))
  }

  private func hidePost() async {
    guard let client = model.client else { return }
    do {
      try await client.hide(shown.id)
      hidden = .post
    } catch {
      actionError = error.localizedDescription
    }
  }

  private func hideTag(_ name: String) async {
    guard let client = model.client else { return }
    do {
      let result = try await client.hideTag(name, from: shown.account.id)
      hidden = .tag(id: result.id, name: name, accountName: shown.account.name)
    } catch {
      actionError = error.localizedDescription
    }
  }

  private func undoHiding(_ note: HiddenNote) async {
    guard let client = model.client else { return }
    do {
      switch note {
      case .post: try await client.unhide(shown.id)
      case .tag(let id, _, _): try await client.unhideTag(id)
      }
      hidden = nil
    } catch {
      actionError = error.localizedDescription
    }
  }

  private func translate() async {
    translating = true
    translationFailed = false
    defer { translating = false }
    do {
      try await model.translate(shown)
    } catch {
      translationFailed = true
    }
  }

  private func updatedPoll(_ poll: Poll) {
    Task {
      if let client = model.client, let fresh = try? await client.status(shown.id) {
        updated = fresh
      }
    }
  }

  private func delete() async {
    guard let client = model.client else { return }
    do {
      try await client.delete(shown.id)
      onDelete(status.id)
    } catch {
      actionError = error.localizedDescription
    }
  }

  /** Mentions and hashtags open inside the app, other links in the browser. */
  private func open(_ url: URL) -> OpenURLAction.Result {
    if let mention = shown.mentions.first(where: { $0.url == url.absoluteString }) {
      router.go(.accountID(mention.id))
      return .handled
    }
    if let tag = shown.tags.first(where: { $0.url.lowercased() == url.absoluteString.lowercased() }) {
      router.go(.tag(tag.name))
      return .handled
    }
    return .systemAction
  }
}

struct ActionButton: View {
  let systemImage: String
  let count: Int?
  let active: Bool
  let label: LocalizedStringKey
  var disabled = false
  /** Looks unavailable but still answers a tap (to explain why). */
  var dimmed = false
  /** What the count is, for VoiceOver when it is a button of its own. */
  var countLabel: LocalizedStringKey = ""
  /** Set on your own posts: the count becomes a button showing who liked or reshared. */
  var showCount: (() -> Void)? = nil
  let action: () async -> Void
  @State private var busy = false

  var body: some View {
    HStack(spacing: 0) {
      Button {
        guard !busy else { return }
        busy = true
        Task {
          await action()
          busy = false
        }
      } label: {
        HStack(spacing: 4) {
          Image(systemName: systemImage)
          if showCount == nil, let shownCount { Text(shownCount, format: .number.notation(.compactName)) }
        }
        .foregroundStyle(active ? Color.brand : dimmed ? Color.secondary.opacity(0.4) : .secondary)
        .frame(minWidth: 32, minHeight: 28)
        .contentShape(Rectangle())
      }
      .disabled(disabled)
      .accessibilityLabel(Text(label))
      .accessibilityAddTraits(active ? .isSelected : [])
      if let showCount, let shownCount {
        Button(action: showCount) {
          Text(shownCount, format: .number.notation(.compactName))
            .foregroundStyle(active ? Color.brand : .secondary)
            .padding(.trailing, 4)
            .frame(minWidth: 24, minHeight: 28)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(Text(countLabel))
        .accessibilityValue(Text(shownCount, format: .number))
      }
    }
  }

  /** The count, when there is something to count. */
  private var shownCount: Int? {
    guard let count, count > 0 else { return nil }
    return count
  }
}

/** Who liked and who reshared one of your posts. */
struct ReactionsSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let status: Status
  @State var reaction: Client.Reaction
  /** Opens a profile (the sheet closes first). */
  let open: (Account) -> Void
  @State private var lists: [Client.Reaction: PagedList<Account>] = [:]

  var body: some View {
    NavigationStack {
      List {
        Picker("Likes and reshares", selection: $reaction) {
          Text(verbatim: "\(String(localized: "Likes")) \(status.favouritesCount)")
            .tag(Client.Reaction.likes)
          Text(verbatim: "\(String(localized: "Reshares")) \(status.reblogsCount)")
            .tag(Client.Reaction.reshares)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .listRowSeparator(.hidden)
        if let list = lists[reaction] {
          ForEach(list.items) { account in
            Button {
              open(account)
            } label: {
              AccountRow(account: account)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .task { await list.reached(account) }
          }
          ListFooter(
            loading: list.loading, error: list.error, empty: list.items.isEmpty,
            emptyText: emptyText
          ) { Task { await list.loadMore() } }
        }
      }
      .listStyle(.plain)
      .refreshable { await lists[reaction]?.refresh() }
      .navigationTitle("Likes and reshares")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .task(id: reaction) { await load(reaction) }
    }
    .presentationDetents([.medium, .large])
  }

  private var emptyText: LocalizedStringKey {
    reaction == .likes ? "No likes yet." : "No reshares yet."
  }

  /** Loads a tab the first time it is shown. */
  private func load(_ reaction: Client.Reaction) async {
    guard lists[reaction] == nil, let client = model.client else { return }
    let id = status.id
    let list = PagedList<Account> { try await client.accounts(reaction, on: id, query: $0) }
    lists[reaction] = list
    await list.refresh()
  }
}

struct VisibilityIcon: View {
  let visibility: DisbigleKit.Visibility

  var body: some View {
    switch visibility {
    case .public: EmptyView()
    case .unlisted: icon("lock.open", "Unlisted")
    case .private: icon("lock", "Followers or aspects only")
    case .direct: icon("at", "Direct message")
    }
  }

  private func icon(_ name: String, _ label: LocalizedStringKey) -> some View {
    Image(systemName: name)
      .font(.caption)
      .foregroundStyle(.secondary)
      .accessibilityLabel(Text(label))
  }
}

struct Avatar: View {
  let account: Account?
  var size: CGFloat = 44

  var body: some View {
    Group {
      if let url = account?.avatarURL {
        AsyncImage(url: url) { phase in
          if let image = phase.image {
            image.resizable().scaledToFill()
          } else {
            initials
          }
        }
      } else {
        initials
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    .accessibilityHidden(true)
  }

  /** Initials on a colour picked from the account, so each person keeps theirs. */
  private var initials: some View {
    // Not hashValue: it changes with every launch.
    let sum = (account?.acct ?? "").unicodeScalars.reduce(0) { $0 + Int($1.value) }
    let hue = Double(sum % 360) / 360
    return ZStack {
      Color(hue: hue, saturation: 0.45, brightness: 0.85)
      Text(account?.initials ?? "")
        .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
        .foregroundStyle(.white)
    }
  }
}

/** Up to four attachments; sensitive ones stay hidden until tapped. */
struct MediaGrid: View {
  let media: [MediaAttachment]
  let sensitive: Bool
  @State private var revealed = false
  @State private var viewing: MediaAttachment?

  var body: some View {
    let columns = Array(
      repeating: GridItem(.flexible(), spacing: 4), count: media.count == 1 ? 1 : 2)
    LazyVGrid(columns: columns, spacing: 4) {
      ForEach(media) { item in
        Button {
          if sensitive && !revealed { revealed = true } else { viewing = item }
        } label: {
          AsyncImage(url: URL(string: item.previewUrl ?? item.url)) { image in
            image.resizable().scaledToFill()
          } placeholder: {
            Color.secondary.opacity(0.15)
          }
          .frame(minHeight: 120, maxHeight: media.count == 1 ? 320 : 160)
          .aspectRatio(media.count == 1 ? (item.aspectRatio ?? 1.5) : 1, contentMode: .fit)
          .clipped()
          .blur(radius: sensitive && !revealed ? 30 : 0)
          .overlay {
            if sensitive && !revealed {
              Label("Sensitive content", systemImage: "eye.slash")
                .font(.footnote.bold())
                .padding(8)
                .background(.thinMaterial, in: Capsule())
            } else if item.type == .video || item.type == .gifv {
              Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(.white)
            }
          }
          .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(Text(item.description.flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "Image")))
      }
    }
    .fullScreenCover(item: $viewing) { item in
      MediaViewer(media: media, selection: item.id)
    }
  }
}

struct MediaViewer: View {
  let media: [MediaAttachment]
  @State var selection: String
  /** Profile and album pictures: the post of each attachment, for "Open the post". */
  var statusIds: [String: String] = [:]
  var openPost: ((String) -> Void)? = nil
  /** Set on your own pictures: they can go into your albums. */
  var albumOwnerId: String? = nil
  @State private var choosingAlbums = false
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      TabView(selection: $selection) {
        ForEach(media) { item in
          Group {
            if item.type == .image || item.type == .gifv {
              AsyncImage(url: URL(string: item.url)) { image in
                image.resizable().scaledToFit()
              } placeholder: {
                ProgressView()
              }
            } else if let url = URL(string: item.url) {
              Link(destination: url) { Label("Open", systemImage: "play.rectangle") }
            }
          }
          .accessibilityLabel(Text(item.description ?? ""))
          .tag(item.id)
        }
      }
      .tabViewStyle(.page)
      .background(.black)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
        ToolbarItemGroup(placement: .bottomBar) {
          if let openPost, let statusId = statusIds[selection] {
            Button("Open the post") {
              dismiss()
              openPost(statusId)
            }
          }
          Spacer()
          if albumOwnerId != nil {
            Button("Add to album") { choosingAlbums = true }
          }
        }
      }
      .toolbarBackground(.black, for: .navigationBar)
      .toolbarColorScheme(.dark, for: .navigationBar)
      .toolbar(openPost != nil || albumOwnerId != nil ? .visible : .hidden, for: .bottomBar)
      .toolbarBackground(.black, for: .bottomBar)
      .toolbarColorScheme(.dark, for: .bottomBar)
      .sheet(isPresented: $choosingAlbums) {
        AlbumPicker(mediaId: selection)
      }
    }
  }
}

extension MediaViewer {
  /** Pictures of a profile or an album, each linking to its post. */
  init(
    items: [MediaItem], selection: String, openPost: @escaping (String) -> Void,
    albumOwnerId: String? = nil
  ) {
    self.init(
      media: items.map(\.mediaAttachment), selection: selection,
      statusIds: Dictionary(items.map { ($0.id, $0.statusId) }, uniquingKeysWith: { first, _ in first }),
      openPost: openPost, albumOwnerId: albumOwnerId)
  }
}

/** Results, or the options to vote for. */
struct PollView: View {
  @Environment(AppModel.self) private var model
  let poll: Poll
  let onVote: (Poll) -> Void
  @State private var choices: Set<Int> = []
  @State private var sending = false

  private var canVote: Bool { !poll.expired && poll.voted != true }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(poll.options.enumerated()), id: \.offset) { index, option in
        if canVote {
          Button {
            if poll.multiple {
              if choices.contains(index) { choices.remove(index) } else { choices.insert(index) }
            } else {
              choices = [index]
            }
          } label: {
            HStack {
              Image(systemName: choices.contains(index)
                ? (poll.multiple ? "checkmark.square.fill" : "largecircle.fill.circle")
                : (poll.multiple ? "square" : "circle"))
              Text(option.title)
              Spacer()
            }
            .padding(10)
            .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
          }
          .buttonStyle(.borderless)
        } else {
          let share = poll.share(of: option)
          let own = poll.ownVotes?.contains(index) == true
          ZStack(alignment: .leading) {
            GeometryReader { geometry in
              RoundedRectangle(cornerRadius: 8)
                .fill(Color.brand.opacity(own ? 0.35 : 0.15))
                .frame(width: max(8, geometry.size.width * share))
            }
            HStack {
              Text(option.title).fontWeight(own ? .semibold : .regular)
              if own { Image(systemName: "checkmark").accessibilityLabel(Text("Your vote")) }
              Spacer()
              Text(share, format: .percent.precision(.fractionLength(0)))
            }
            .padding(.horizontal, 10)
          }
          .frame(height: 36)
        }
      }
      HStack {
        if canVote {
          Button("Vote") { Task { await vote() } }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(choices.isEmpty || sending)
        }
        Text("\(poll.votersCount ?? poll.votesCount) people")
        if let end = poll.expiresAt {
          Text("·")
          if poll.expired {
            Text("Closed")
          } else {
            Text("ends \(end.formatted(.relative(presentation: .named)))")
          }
        }
      }
      .font(.footnote)
      .foregroundStyle(.secondary)
    }
  }

  private func vote() async {
    guard let client = model.client else { return }
    sending = true
    defer { sending = false }
    if let updated = try? await client.vote(in: poll.id, choices: choices.sorted()) {
      onVote(updated)
    }
  }
}
