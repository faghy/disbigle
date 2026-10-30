import DisbigleKit
import SwiftUI

/** Where a tap can lead inside a tab. */
enum Route: Hashable {
  case status(Status)
  case account(Account)
  /** An account known only by id (a mention), loaded on arrival. */
  case accountID(String)
  /** A post known only by id (from a system notification), loaded on arrival. */
  case statusID(String)
  case tag(String)
  /** A photo album, loaded on arrival. */
  case album(String)
  case settings(SettingsPage)
}

/** The navigation path of one tab; views push routes with `go`. */
@MainActor @Observable
final class Router {
  var path = NavigationPath()

  func go(_ route: Route) {
    path.append(route)
  }
}

/** A tab's navigation stack, with its router and the destinations of every route. */
struct TabStack<Root: View>: View {
  @State private var router = Router()
  @ViewBuilder let root: () -> Root

  var body: some View {
    NavigationStack(path: $router.path) {
      root()
        .navigationDestination(for: Route.self) { route in
          switch route {
          case .status(let status): StatusDetailScreen(status: status)
          case .account(let account): ProfileScreen(account: account)
          case .accountID(let id): ProfileLoader(id: id)
          case .statusID(let id): StatusLoader(id: id)
          case .tag(let name): TagScreen(name: name)
          case .album(let id): AlbumScreen(id: id)
          case .settings(let page): page.screen
          }
        }
    }
    .environment(router)
  }
}

/** A list read page by page (newest first), with the `Link` cursors of the API. */
@MainActor @Observable
final class PagedList<Item: Identifiable & Sendable> where Item.ID == String {
  private(set) var items: [Item] = []
  private(set) var loading = false
  private(set) var error: String?
  private(set) var finished = false
  private var next: [URLQueryItem]?
  private let load: @MainActor ([URLQueryItem]) async throws -> Page<Item>

  init(load: @escaping @MainActor ([URLQueryItem]) async throws -> Page<Item>) {
    self.load = load
  }

  func refresh() async {
    await fetch(query: [], replacing: true)
  }

  func loadMore() async {
    guard let next, !finished, !loading else { return }
    await fetch(query: next, replacing: false)
  }

  /** Loads the next page when `item` (just shown) is near the end. */
  func reached(_ item: Item) async {
    guard let index = items.firstIndex(where: { $0.id == item.id }), index >= items.count - 5 else {
      return
    }
    await loadMore()
  }

  func replace(_ item: Item) {
    if let index = items.firstIndex(where: { $0.id == item.id }) { items[index] = item }
  }

  func remove(id: String) {
    items.removeAll { $0.id == id }
  }

  func prepend(_ item: Item) {
    if let index = items.firstIndex(where: { $0.id == item.id }) {
      items[index] = item
    } else {
      items.insert(item, at: 0)
    }
  }

  private func fetch(query: [URLQueryItem], replacing: Bool) async {
    loading = true
    defer { loading = false }
    do {
      let page = try await load(query)
      items = replacing ? page.items : items + page.items.filter { new in !items.contains { $0.id == new.id } }
      next = page.next
      finished = page.next == nil
      error = nil
    } catch is CancellationError {
      return
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/** Posts in a list, each linking to its thread. */
struct StatusListView: View {
  let list: PagedList<Status>
  var emptyText: LocalizedStringKey = "Nothing here yet."

  var body: some View {
    List {
      ForEach(list.items) { status in
        StatusRow(status: status, onDelete: { list.remove(id: $0) })
          .task { await list.reached(status) }
      }
      ListFooter(loading: list.loading, error: list.error, empty: list.items.isEmpty, emptyText: emptyText) {
        Task { await list.loadMore() }
      }
    }
    .listStyle(.plain)
    .refreshable { await list.refresh() }
    .task { if list.items.isEmpty { await list.refresh() } }
  }
}

/** Spinner, error with retry, or the empty message at the end of a list. */
struct ListFooter: View {
  let loading: Bool
  let error: String?
  let empty: Bool
  let emptyText: LocalizedStringKey
  let retry: () -> Void

  var body: some View {
    Group {
      if loading {
        ProgressView().frame(maxWidth: .infinity)
      } else if let error {
        VStack(spacing: 8) {
          Text(error).foregroundStyle(.secondary).multilineTextAlignment(.center)
          Button("Try again", action: retry)
        }
        .frame(maxWidth: .infinity)
      } else if empty {
        Text(emptyText).foregroundStyle(.secondary).frame(maxWidth: .infinity)
      }
    }
    .padding(.vertical, 24)
    .listRowSeparator(.hidden)
  }
}

struct TimelineScreen: View {
  @Environment(AppModel.self) private var model
  @State private var timeline: Timeline = .home
  @State private var cache = ListCache()
  @State private var aspects: [AspectList] = []

  var body: some View {
    StatusListView(list: list(for: timeline))
      .id(timeline)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Menu {
            Picker("Timeline", selection: $timeline) {
              Label("Home", systemImage: "house").tag(Timeline.home)
              Label("This server", systemImage: "building.2").tag(Timeline.local)
              Label("Fediverse", systemImage: "globe").tag(Timeline.federated)
              if !aspects.isEmpty {
                Section("Aspects") {
                  ForEach(aspects) { aspect in
                    Label(aspect.title, systemImage: "person.2").tag(Timeline.aspect(aspect.id))
                  }
                }
              }
            }
          } label: {
            Label("Timeline", systemImage: "line.3.horizontal.decrease.circle")
          }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            model.composing = .new
          } label: {
            Label("New post", systemImage: "square.and.pencil")
          }
        }
      }
      .task { aspects = (try? await model.client?.aspects()) ?? [] }
      .onChange(of: model.lastSaved) { _, saved in
        guard let saved else { return }
        if saved.inReplyToId == nil {
          cache.lists[.home]?.prepend(saved)
        } else {
          cache.lists[.home]?.replace(saved)
        }
      }
  }

  private var title: String {
    switch timeline {
    case .home: String(localized: "Home")
    case .local: String(localized: "This server")
    case .federated: String(localized: "Fediverse")
    case .tag(let name): "#\(name)"
    case .aspect(let id): aspects.first { $0.id == id }?.title ?? String(localized: "Aspect")
    }
  }

  private func list(for timeline: Timeline) -> PagedList<Status> {
    if let existing = cache.lists[timeline] { return existing }
    let client = model.client
    let list = PagedList<Status> { query in
      guard let client else { throw APIError.unauthorized }
      return try await client.timeline(timeline, query: query)
    }
    cache.lists[timeline] = list
    return list
  }

  /** Lists already loaded, kept when switching timelines (not observed: no redraw on insert). */
  @MainActor final class ListCache {
    var lists: [Timeline: PagedList<Status>] = [:]
  }
}

struct TagScreen: View {
  @Environment(AppModel.self) private var model
  let name: String
  @State private var list: PagedList<Status>?

  var body: some View {
    Group {
      if let list { StatusListView(list: list) } else { ProgressView() }
    }
    .navigationTitle("#\(name)")
    .onAppear {
      guard list == nil, let client = model.client else { return }
      let tag = name
      list = PagedList { try await client.timeline(.tag(tag), query: $0) }
    }
  }
}
