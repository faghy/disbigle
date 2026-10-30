import DisbigleKit
import SwiftUI

/** A square thumbnail of a photo or video; those of sensitive posts stay blurred. */
struct MediaThumbnail: View {
  let item: MediaItem

  var body: some View {
    Color.secondary.opacity(0.15)
      .aspectRatio(1, contentMode: .fit)
      .overlay {
        AsyncImage(url: item.thumbnailURL) { image in
          image.resizable().scaledToFill()
        } placeholder: {
          Color.clear
        }
        .blur(radius: item.sensitive ? 20 : 0)
      }
      .clipped()
      .overlay {
        if item.sensitive {
          Image(systemName: "eye.slash")
            .font(.subheadline.bold())
            .padding(8)
            .background(.thinMaterial, in: Circle())
        } else if item.mediaAttachment.type == .video || item.mediaAttachment.type == .gifv {
          Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(.white)
        }
      }
      .contentShape(Rectangle())
      .accessibilityElement()
      .accessibilityLabel(Text(label))
  }

  private var label: String {
    if item.sensitive { return String(localized: "Sensitive content") }
    if let description = item.mediaAttachment.description, !description.isEmpty { return description }
    return item.mediaAttachment.type == .image ? String(localized: "Image") : String(localized: "Video")
  }
}

/** Thumbnails three to a row, as rows of a list (so that the list stays lazy). */
struct MediaRows: View {
  let items: [MediaItem]
  let open: (MediaItem) -> Void
  /** Called with the last item of each row that appears, to load more. */
  var reached: (MediaItem) async -> Void = { _ in }

  var body: some View {
    ForEach(Array(stride(from: 0, to: items.count, by: 3)), id: \.self) { start in
      let row = Array(items[start..<min(start + 3, items.count)])
      HStack(spacing: 2) {
        ForEach(row) { item in
          Button {
            open(item)
          } label: {
            MediaThumbnail(item: item)
          }
          .buttonStyle(.borderless)
        }
        ForEach(row.count..<3, id: \.self) { _ in
          Color.clear.aspectRatio(1, contentMode: .fit)
        }
      }
      .listRowInsets(EdgeInsets(top: 1, leading: 0, bottom: 1, trailing: 0))
      .listRowSeparator(.hidden)
      .task {
        if let last = row.last { await reached(last) }
      }
    }
  }
}

/** Cover, name and size of an album. */
struct AlbumCard: View {
  let album: Album

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Color.secondary.opacity(0.15)
        .aspectRatio(1, contentMode: .fit)
        .overlay {
          if let cover = album.cover, let url = URL(string: cover.previewUrl ?? cover.url) {
            AsyncImage(url: url) { image in
              image.resizable().scaledToFill()
            } placeholder: {
              Color.clear
            }
          } else {
            Image(systemName: "photo.on.rectangle").font(.largeTitle).foregroundStyle(.secondary)
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      Text(album.name).font(.subheadline.bold()).foregroundStyle(.primary).lineLimit(1)
      Text("\(album.mediaCount) items").font(.footnote).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }
}

/** An album's pictures; its owner can rename or delete it. */
struct AlbumScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  @Environment(\.dismiss) private var dismiss
  let id: String
  @State private var detail: AlbumDetail?
  @State private var error: String?
  @State private var viewing: MediaItem?
  @State private var editing = false
  @State private var confirmDelete = false
  @State private var actionError: String?

  private var isMine: Bool { detail != nil && detail?.album.accountId == model.me?.id }

  var body: some View {
    Group {
      if let detail {
        List {
          VStack(alignment: .leading, spacing: 8) {
            if let description = detail.album.description, !description.isEmpty {
              Text(description).fixedSize(horizontal: false, vertical: true)
            }
            Button {
              router.go(.account(detail.account))
            } label: {
              HStack(spacing: 8) {
                Avatar(account: detail.account, size: 24)
                Text(detail.account.name).font(.subheadline.bold()).foregroundStyle(.primary)
              }
            }
            .buttonStyle(.borderless)
            Text("\(detail.items.count) items").font(.footnote).foregroundStyle(.secondary)
          }
          .listRowSeparator(.hidden)
          MediaRows(items: detail.items) { viewing = $0 }
          if detail.items.isEmpty {
            ListFooter(loading: false, error: nil, empty: true, emptyText: "No photos yet.") {}
          }
        }
        .listStyle(.plain)
        .refreshable { await load() }
      } else if let error {
        Text(error).foregroundStyle(.secondary).padding()
      } else {
        ProgressView()
      }
    }
    .navigationTitle(detail?.album.name ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if isMine {
          Menu {
            Button {
              editing = true
            } label: {
              Label("Edit", systemImage: "pencil")
            }
            Button(role: .destructive) {
              confirmDelete = true
            } label: {
              Label("Delete", systemImage: "trash")
            }
          } label: {
            Label("More actions", systemImage: "ellipsis.circle")
          }
        }
      }
    }
    .task { await load() }
    .sheet(isPresented: $editing) {
      if let album = detail?.album, let client = model.client {
        AlbumForm(album: album) { draft in
          _ = try await client.updateAlbum(album.id, draft)
          await load()
        }
      }
    }
    .fullScreenCover(item: $viewing, onDismiss: { if isMine { Task { await load() } } }) { item in
      MediaViewer(
        items: detail?.items ?? [item], selection: item.id,
        openPost: { router.go(.statusID($0)) }, albumOwnerId: isMine ? model.me?.id : nil)
    }
    .confirmationDialog("Delete this album?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { Task { await delete() } }
    } message: {
      Text("The photos stay in their posts: only the album goes away.")
    }
    .alert(
      "Something went wrong", isPresented: .constant(actionError != nil),
      actions: { Button("OK") { actionError = nil } }, message: { Text(actionError ?? "") })
  }

  private func load() async {
    guard let client = model.client else { return }
    do {
      detail = try await client.album(id)
      error = nil
    } catch is CancellationError {
      return
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete() async {
    guard let client = model.client else { return }
    do {
      try await client.deleteAlbum(id)
      dismiss()
    } catch {
      actionError = error.localizedDescription
    }
  }
}

/** Name and description of a new album, or of one being edited. */
struct AlbumForm: View {
  @Environment(\.dismiss) private var dismiss
  let album: Album?
  let save: (AlbumDraft) async throws -> Void
  @State private var draft: AlbumDraft
  @State private var saving = false
  @State private var error: String?

  init(album: Album?, save: @escaping (AlbumDraft) async throws -> Void) {
    self.album = album
    self.save = save
    _draft = State(initialValue: album.map(AlbumDraft.init(album:)) ?? AlbumDraft())
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Name", text: $draft.name)
          TextField("Description (optional)", text: $draft.description, axis: .vertical)
            .lineLimit(3...8)
        } footer: {
          if let error { Text(error).foregroundStyle(.red) }
        }
      }
      .navigationTitle(album == nil ? LocalizedStringKey("New album") : "Edit album")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") { Task { await submit() } }
            .disabled(!draft.isValid || saving)
        }
      }
      .onChange(of: draft.name) { _, name in
        if name.count > AlbumDraft.maxName { draft.name = String(name.prefix(AlbumDraft.maxName)) }
      }
      .onChange(of: draft.description) { _, text in
        if text.count > AlbumDraft.maxDescription {
          draft.description = String(text.prefix(AlbumDraft.maxDescription))
        }
      }
      .interactiveDismissDisabled(saving)
    }
  }

  private func submit() async {
    saving = true
    defer { saving = false }
    do {
      try await save(draft)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/** Your albums, switched on for those that hold a picture. */
struct AlbumPicker: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let mediaId: String
  @State private var albums: [Album]?
  @State private var included: Set<String> = []
  @State private var creating = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      List {
        if let albums {
          ForEach(albums) { album in
            Toggle(
              album.name,
              isOn: Binding(
                get: { included.contains(album.id) },
                set: { on in Task { await toggle(album, on: on) } }))
          }
        } else if error == nil {
          ProgressView().frame(maxWidth: .infinity)
        }
        if let error {
          Text(error).foregroundStyle(.secondary)
        }
        Section {
          Button {
            creating = true
          } label: {
            Label("New album", systemImage: "plus")
          }
        }
      }
      .navigationTitle("Add to album")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .task { await load() }
      .sheet(isPresented: $creating) {
        if let client = model.client {
          AlbumForm(album: nil) { draft in
            let album = try await client.createAlbum(draft)
            try await client.addMedia(mediaId, to: album.id)
            await load()
          }
        }
      }
    }
  }

  private func load() async {
    guard let client = model.client, let me = model.me else { return }
    do {
      let list = try await client.albums(of: me.id, containing: mediaId)
      albums = list
      included = Set(list.filter { $0.includes == true }.map(\.id))
      error = nil
    } catch is CancellationError {
      return
    } catch {
      self.error = error.localizedDescription
    }
  }

  /** Adds the picture to an album or takes it out; on failure the switch goes back. */
  private func toggle(_ album: Album, on: Bool) async {
    guard let client = model.client else { return }
    if on { included.insert(album.id) } else { included.remove(album.id) }
    do {
      if on {
        try await client.addMedia(mediaId, to: album.id)
      } else {
        try await client.removeMedia(mediaId, from: album.id)
      }
      error = nil
    } catch {
      if on { included.remove(album.id) } else { included.insert(album.id) }
      self.error = error.localizedDescription
    }
  }
}
