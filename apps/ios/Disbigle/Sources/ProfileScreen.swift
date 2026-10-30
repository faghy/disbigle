import DisbigleKit
import SwiftUI

struct ProfileScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  let account: Account
  var isMe = false
  @State private var relationship: Relationship?
  @State private var list: PagedList<Status>?
  @State private var aspects: [AspectList] = []
  @State private var memberOf: Set<String> = []
  @State private var openedDebugScreen = false
  @State private var following = false
  @State private var tab: ProfileTab = .posts
  @State private var media: PagedList<MediaItem>?
  @State private var albums: [Album]?
  @State private var albumsError: String?
  @State private var viewing: MediaItem?
  @State private var creatingAlbum = false

  enum ProfileTab: Hashable {
    case posts, media, albums
  }

  var body: some View {
    List {
      header
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
      Picker("Sections", selection: $tab) {
        Text("Posts").tag(ProfileTab.posts)
        Text("Media").tag(ProfileTab.media)
        // Albums are a Disbigle extension: only for accounts of this server.
        if account.isLocal { Text("Albums").tag(ProfileTab.albums) }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .listRowSeparator(.hidden)
      switch tab {
      case .posts: posts
      case .media: mediaGrid
      case .albums: albumList
      }
    }
    .listStyle(.plain)
    .refreshable {
      switch tab {
      case .posts: await list?.refresh()
      case .media: await media?.refresh()
      case .albums: await loadAlbums()
      }
    }
    .task(id: tab) { await load(tab) }
    .fullScreenCover(item: $viewing) { item in
      MediaViewer(
        items: media?.items ?? [item], selection: item.id,
        openPost: { router.go(.statusID($0)) },
        albumOwnerId: isMe && account.isLocal ? account.id : nil)
    }
    .sheet(isPresented: $creatingAlbum) {
      if let client = model.client {
        AlbumForm(album: nil) { draft in
          _ = try await client.createAlbum(draft)
          await loadAlbums()
        }
      }
    }
    .navigationTitle(account.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if isMe {
          Button {
            router.go(.settings(.root))
          } label: {
            Label("Settings", systemImage: "gearshape")
          }
        } else if relationship != nil {
          Menu {
            if !aspects.isEmpty {
              Section("Aspects") {
                ForEach(aspects) { aspect in
                  Button {
                    Task { await toggle(aspect) }
                  } label: {
                    if memberOf.contains(aspect.id) {
                      Label(aspect.title, systemImage: "checkmark")
                    } else {
                      Text(aspect.title)
                    }
                  }
                }
              }
            }
            if let url = URL(string: account.url) {
              ShareLink(item: url)
            }
            Button {
              Task { await act(relationship?.muting == true ? .unmute : .mute) }
            } label: {
              Label(
                relationship?.muting == true ? LocalizedStringKey("Unmute") : "Mute",
                systemImage: relationship?.muting == true ? "speaker.wave.2" : "speaker.slash")
            }
            Button(role: relationship?.blocking == true ? nil : .destructive) {
              Task { await act(relationship?.blocking == true ? .unblock : .block) }
            } label: {
              Label(
                relationship?.blocking == true ? LocalizedStringKey("Unblock") : "Block",
                systemImage: "hand.raised")
            }
          } label: {
            Label("More actions", systemImage: "ellipsis.circle")
          }
        }
      }
    }
    .onAppear {
      // Debug builds: `-DisbigleScreen settings|settings-notifications|settings-profile`.
      guard isMe, let screen = model.debugScreen, screen.hasPrefix("settings"), !openedDebugScreen else { return }
      openedDebugScreen = true
      router.go(.settings(.root))
      if screen == "settings-notifications" { router.go(.settings(.notifications)) }
      if screen == "settings-profile" { router.go(.settings(.profile)) }
    }
    .task {
      guard let client = model.client else { return }
      if list == nil {
        let id = account.id
        let newList = PagedList<Status> { try await client.statuses(of: id, query: $0) }
        list = newList
        await newList.refresh()
      }
      if !isMe {
        relationship = try? await client.relationship(with: account.id)
        aspects = (try? await client.aspects()) ?? []
        memberOf = Set(((try? await client.aspects(containing: account.id)) ?? []).map(\.id))
      }
    }
  }

  @ViewBuilder private var posts: some View {
    if let list {
      ForEach(list.items) { status in
        StatusRow(status: status, onDelete: { list.remove(id: $0) })
          .task { await list.reached(status) }
      }
      ListFooter(
        loading: list.loading, error: list.error, empty: list.items.isEmpty,
        emptyText: "No posts yet."
      ) { Task { await list.loadMore() } }
    }
  }

  @ViewBuilder private var mediaGrid: some View {
    if let media {
      MediaRows(items: media.items, open: { viewing = $0 }, reached: { await media.reached($0) })
      ListFooter(
        loading: media.loading, error: media.error, empty: media.items.isEmpty,
        emptyText: "No photos or videos yet."
      ) { Task { await media.loadMore() } }
    }
  }

  @ViewBuilder private var albumList: some View {
    if isMe {
      Button {
        creatingAlbum = true
      } label: {
        Label("New album", systemImage: "plus")
      }
      .buttonStyle(.borderless)
      .listRowSeparator(.hidden)
    }
    if let albums {
      ForEach(Array(stride(from: 0, to: albums.count, by: 2)), id: \.self) { start in
        HStack(alignment: .top, spacing: 12) {
          ForEach(albums[start..<min(start + 2, albums.count)]) { album in
            Button {
              router.go(.album(album.id))
            } label: {
              AlbumCard(album: album)
            }
            .buttonStyle(.borderless)
            .frame(maxWidth: .infinity)
          }
          if start + 1 >= albums.count {
            Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
          }
        }
        .listRowSeparator(.hidden)
      }
    }
    ListFooter(
      loading: albums == nil && albumsError == nil, error: albumsError,
      empty: albums?.isEmpty == true, emptyText: "No albums yet."
    ) { Task { await loadAlbums() } }
  }

  /** Loads a tab the first time it is shown (albums every time: they change elsewhere). */
  private func load(_ tab: ProfileTab) async {
    guard let client = model.client else { return }
    switch tab {
    case .posts:
      break
    case .media:
      guard media == nil else { return }
      let id = account.id
      let newList = PagedList<MediaItem> { try await client.media(of: id, query: $0) }
      media = newList
      await newList.refresh()
    case .albums:
      await loadAlbums()
    }
  }

  private func loadAlbums() async {
    guard let client = model.client else { return }
    do {
      albums = try await client.albums(of: account.id)
      albumsError = nil
    } catch is CancellationError {
      return
    } catch {
      albumsError = error.localizedDescription
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 12) {
      ZStack(alignment: .bottomLeading) {
        Group {
          if let header = account.headerURL {
            AsyncImage(url: header) { image in
              image.resizable().scaledToFill()
            } placeholder: {
              Color.brand.opacity(0.2)
            }
          } else {
            LinearGradient(
              colors: [Color.brand, Color.brand.opacity(0.6)], startPoint: .leading,
              endPoint: .trailing)
          }
        }
        .frame(height: 130)
        .frame(maxWidth: .infinity)
        .clipped()
        Avatar(account: account, size: 76)
          .overlay(RoundedRectangle(cornerRadius: 21, style: .continuous).stroke(.background, lineWidth: 4))
          .offset(x: 16, y: 38)
      }
      .padding(.bottom, 38)

      VStack(alignment: .leading, spacing: 10) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 2) {
            Text(account.name).font(.title2.bold())
            Text("@\(account.acct)").foregroundStyle(.secondary).textSelection(.enabled)
          }
          Spacer()
          if !isMe, let relationship { followButton(relationship) }
        }
        if !account.note.isEmpty {
          Text(RichText.attributed(account.note)).fixedSize(horizontal: false, vertical: true)
        }
        ForEach(account.fields, id: \.name) { field in
          HStack(alignment: .firstTextBaseline) {
            Text(field.name).font(.footnote.bold()).foregroundStyle(.secondary)
            Text(RichText.attributed(field.value)).font(.footnote)
          }
        }
        HStack(spacing: 16) {
          count(account.statusesCount, "posts")
          count(account.followingCount, "following")
          count(account.followersCount, "followers")
        }
        .font(.subheadline)
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 12)
    }
  }

  private func toggle(_ aspect: AspectList) async {
    guard let client = model.client else { return }
    let inside = memberOf.contains(aspect.id)
    do {
      if inside {
        try await client.removeMember(account.id, from: aspect.id)
        memberOf.remove(aspect.id)
      } else {
        try await client.addMember(account.id, to: aspect.id)
        memberOf.insert(aspect.id)
      }
    } catch {}
  }

  private func act(_ action: Client.AccountAction) async {
    if let updated = try? await model.client?.act(action, on: account.id) { relationship = updated }
  }

  private func count(_ value: Int, _ label: LocalizedStringKey) -> some View {
    HStack(spacing: 4) {
      Text(value, format: .number.notation(.compactName)).bold()
      Text(label).foregroundStyle(.secondary)
    }
  }

  private func followButton(_ relationship: Relationship) -> some View {
    let title: LocalizedStringKey =
      relationship.following ? "Following" : relationship.requested ? "Requested" : "Follow"
    return Button(title) {
      Task {
        guard let client = model.client else { return }
        following = true
        defer { following = false }
        let updated =
          relationship.following || relationship.requested
          ? try? await client.unfollow(account.id) : try? await client.follow(account.id)
        if let updated { self.relationship = updated }
      }
    }
    .buttonStyle(relationship.following ? AnyPrimitiveButtonStyle(.bordered) : AnyPrimitiveButtonStyle(.borderedProminent))
    .disabled(following)
  }
}

/** Type-erased button style, to pick bordered or prominent at runtime. */
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
  private let make: (Configuration) -> AnyView

  init<S: PrimitiveButtonStyle>(_ style: S) {
    make = { AnyView(style.makeBody(configuration: $0)) }
  }

  func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/** A profile known only by id (from a mention). */
struct ProfileLoader: View {
  @Environment(AppModel.self) private var model
  let id: String
  @State private var account: Account?
  @State private var error: String?

  var body: some View {
    Group {
      if let account {
        ProfileScreen(account: account, isMe: account.id == model.me?.id)
      } else if let error {
        Text(error).foregroundStyle(.secondary).padding()
      } else {
        ProgressView()
      }
    }
    .task {
      do {
        account = try await model.client?.account(id)
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
