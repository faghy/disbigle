import DisbigleKit
import SwiftUI

/** A post with what it answers and the answers to it. */
struct StatusDetailScreen: View {
  @Environment(AppModel.self) private var model
  let status: Status
  @State private var ancestors: [Status] = []
  @State private var descendants: [Status] = []
  @State private var loading = true
  @State private var error: String?

  var body: some View {
    ScrollViewReader { proxy in
      List {
        ForEach(ancestors) { StatusRow(status: $0) }
        StatusRow(status: status, onDelete: { _ in ancestors = []; descendants = [] }, focused: true)
          .id(status.id)
          .listRowBackground(Color.brand.opacity(0.06))
        ForEach(descendants) { reply in
          StatusRow(status: reply, onDelete: { id in descendants.removeAll { $0.id == id } })
            .padding(.leading, reply.inReplyToId == status.id ? 0 : 16)
        }
        if loading || error != nil {
          ListFooter(loading: loading, error: error, empty: false, emptyText: "") {
            Task { await load() }
          }
        }
      }
      .listStyle(.plain)
      .task {
        await load()
        proxy.scrollTo(status.id, anchor: .top)
      }
      .refreshable { await load() }
    }
    .navigationTitle("Thread")
    .navigationBarTitleDisplayMode(.inline)
    .onChange(of: model.lastSaved) { _, saved in
      if saved?.inReplyToId != nil { Task { await load() } }
    }
  }

  private func load() async {
    guard let client = model.client else { return }
    loading = true
    defer { loading = false }
    do {
      let context = try await client.context(of: status.id)
      ancestors = context.ancestors
      descendants = context.descendants
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }
}

struct NotificationsScreen: View {
  @Environment(AppModel.self) private var model
  @State private var list: PagedList<DisbigleKit.Notification>?

  var body: some View {
    Group {
      if let list {
        List {
          ForEach(list.items) { notification in
            NotificationRow(notification: notification)
              .task { await list.reached(notification) }
          }
          ListFooter(
            loading: list.loading, error: list.error, empty: list.items.isEmpty,
            emptyText: "No notifications yet."
          ) { Task { await list.loadMore() } }
        }
        .listStyle(.plain)
        .refreshable { await list.refresh() }
        .task { if list.items.isEmpty { await list.refresh() } }
      } else {
        ProgressView()
      }
    }
    .navigationTitle("Notifications")
    .onAppear {
      guard list == nil, let client = model.client else { return }
      list = PagedList { try await client.notifications(query: $0) }
    }
  }
}

struct NotificationRow: View {
  @Environment(Router.self) private var router
  let notification: DisbigleKit.Notification

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 10) {
        Image(systemName: icon)
          .foregroundStyle(Color.brand)
          .frame(width: 24)
          .accessibilityHidden(true)
        Avatar(url: notification.account.avatar, size: 32)
        Text(summary).font(.subheadline).lineLimit(2)
        Spacer(minLength: 0)
        Text(notification.createdAt, format: .relative(presentation: .numeric, unitsStyle: .narrow))
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if let status = notification.status {
        if notification.type == .mention || notification.type == .status {
          StatusRow(status: status)
        } else {
          Text(RichText.plain(status.content))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(3)
            .padding(.leading, 34)
        }
      }
    }
    .contentShape(Rectangle())
    .onTapGesture {
      if let status = notification.status {
        router.go(.status(status))
      } else {
        router.go(.account(notification.account))
      }
    }
  }

  private var icon: String {
    switch notification.type {
    case .mention: "at"
    case .status: "bell"
    case .reblog: "arrow.2.squarepath"
    case .follow: "person.badge.plus"
    case .followRequest: "person.badge.clock"
    case .favourite: "heart.fill"
    case .poll: "chart.bar"
    case .update: "pencil"
    case .unknown: "bell"
    }
  }

  private var summary: String {
    let name = notification.account.name
    return switch notification.type {
    case .mention: String(localized: "\(name) mentioned you")
    case .status: String(localized: "\(name) posted")
    case .reblog: String(localized: "\(name) reshared your post")
    case .follow: String(localized: "\(name) follows you")
    case .followRequest: String(localized: "\(name) asked to follow you")
    case .favourite: String(localized: "\(name) liked your post")
    case .poll: String(localized: "A poll you voted in has ended")
    case .update: String(localized: "\(name) edited a post")
    case .unknown: name
    }
  }
}

struct ConversationsScreen: View {
  @Environment(AppModel.self) private var model
  @State private var list: PagedList<Conversation>?

  var body: some View {
    Group {
      if let list {
        List {
          ForEach(list.items) { conversation in
            ConversationRow(conversation: conversation)
              .task { await list.reached(conversation) }
          }
          ListFooter(
            loading: list.loading, error: list.error, empty: list.items.isEmpty,
            emptyText: "No messages yet."
          ) { Task { await list.loadMore() } }
        }
        .listStyle(.plain)
        .refreshable { await list.refresh() }
        .task { if list.items.isEmpty { await list.refresh() } }
      } else {
        ProgressView()
      }
    }
    .navigationTitle("Messages")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          model.composing = .new
        } label: {
          Label("New message", systemImage: "square.and.pencil")
        }
      }
    }
    .onAppear {
      guard list == nil, let client = model.client else { return }
      list = PagedList { try await client.conversations(query: $0) }
    }
  }
}

struct ConversationRow: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  let conversation: Conversation

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Avatar(url: conversation.accounts.first?.avatar ?? "", size: 44)
        .overlay(alignment: .topTrailing) {
          if conversation.unread {
            Circle().fill(Color.brand).frame(width: 10, height: 10)
              .accessibilityLabel(Text("Unread"))
          }
        }
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text(conversation.accounts.map(\.name).joined(separator: ", "))
            .font(.subheadline.bold())
            .lineLimit(1)
          Spacer()
          if let last = conversation.lastStatus {
            Text(last.createdAt, format: .relative(presentation: .numeric, unitsStyle: .narrow))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
        if let last = conversation.lastStatus {
          Text(RichText.plain(last.content))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
    }
    .contentShape(Rectangle())
    .onTapGesture {
      guard let last = conversation.lastStatus else { return }
      router.go(.status(last))
      if conversation.unread {
        Task { try? await model.client?.markRead(conversation: conversation.id) }
      }
    }
  }
}

struct SearchScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  @State private var query = ""
  @State private var results: SearchResults?
  @State private var searching = false
  @State private var error: String?

  var body: some View {
    List {
      if let results {
        if !results.accounts.isEmpty {
          Section("People") {
            ForEach(results.accounts) { account in
              Button {
                router.go(.account(account))
              } label: {
                AccountRow(account: account)
              }
              .buttonStyle(.plain)
            }
          }
        }
        if !results.hashtags.isEmpty {
          Section("Hashtags") {
            ForEach(results.hashtags, id: \.name) { tag in
              Button("#\(tag.name)") { router.go(.tag(tag.name)) }
            }
          }
        }
        if !results.statuses.isEmpty {
          Section("Posts") {
            ForEach(results.statuses) { StatusRow(status: $0) }
          }
        }
        if results.accounts.isEmpty && results.hashtags.isEmpty && results.statuses.isEmpty {
          Text("No results.").foregroundStyle(.secondary)
        }
      } else if searching {
        ProgressView().frame(maxWidth: .infinity)
      } else if let error {
        Text(error).foregroundStyle(.secondary)
      } else {
        Text("Search people (also on other servers: name@server), hashtags and posts.")
          .foregroundStyle(.secondary)
      }
    }
    .listStyle(.plain)
    .navigationTitle("Search")
    .searchable(text: $query, prompt: Text("People, #hashtags, posts"))
    .onSubmit(of: .search) { Task { await search() } }
    .onChange(of: query) { _, text in
      if text.isEmpty { results = nil }
    }
  }

  private func search() async {
    let text = query.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty, let client = model.client else { return }
    searching = true
    defer { searching = false }
    do {
      results = try await client.search(text)
      error = nil
    } catch {
      results = nil
      self.error = error.localizedDescription
    }
  }
}

struct AccountRow: View {
  let account: Account

  var body: some View {
    HStack(spacing: 12) {
      Avatar(url: account.avatar, size: 40)
      VStack(alignment: .leading) {
        Text(account.name).font(.subheadline.bold())
        Text("@\(account.acct)").font(.footnote).foregroundStyle(.secondary)
      }
    }
  }
}
