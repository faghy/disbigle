import DisbigleKit
import PhotosUI
import SafariServices
import SwiftUI
import UserNotifications

/** The pages of the settings, as navigation routes. */
enum SettingsPage: Hashable {
  case root, profile, notifications, posting, followRequests, blocks, mutes, bookmarks, favourites
  case aspects
  case aspect(AspectList)
}

extension SettingsPage {
  @ViewBuilder var screen: some View {
    switch self {
    case .root: SettingsScreen()
    case .profile: EditProfileScreen()
    case .notifications: NotificationSettingsScreen()
    case .posting: PostingSettingsScreen()
    case .followRequests: AccountListScreen(list: .followRequests)
    case .blocks: AccountListScreen(list: .blocks)
    case .mutes: AccountListScreen(list: .mutes)
    case .bookmarks: SavedPostsScreen(bookmarks: true)
    case .favourites: SavedPostsScreen(bookmarks: false)
    case .aspects: AspectsScreen()
    case .aspect(let aspect): AspectMembersScreen(aspect: aspect)
    }
  }
}

struct SettingsScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  @State private var confirmSignOut = false
  @State private var followRequests = 0
  @State private var web: URL?

  var body: some View {
    List {
      if let me = model.me {
        Section {
          Button {
            router.go(.settings(.profile))
          } label: {
            HStack(spacing: 12) {
              Avatar(account: me, size: 52)
              VStack(alignment: .leading, spacing: 2) {
                Text(me.name).font(.headline)
                Text("@\(me.acct)@\(model.session?.server.host() ?? "")")
                  .font(.footnote)
                  .foregroundStyle(.secondary)
                Text("Edit profile").font(.footnote).foregroundStyle(Color.brand)
              }
              Spacer()
              Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
            }
          }
          .buttonStyle(.plain)
        }
      }

      Section("This iPhone") {
        link("Notifications", systemImage: "bell.badge", page: .notifications)
        link("Posting", systemImage: "square.and.pencil", page: .posting)
        Button {
          if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        } label: {
          Label("iOS settings for Disbigle", systemImage: "gear")
        }
      }

      Section("People") {
        link("Follow requests", systemImage: "person.badge.clock", page: .followRequests, count: followRequests)
        link("Blocked", systemImage: "hand.raised", page: .blocks)
        link("Muted", systemImage: "speaker.slash", page: .mutes)
        link("Aspects", systemImage: "person.2", page: .aspects)
      }

      Section("Saved") {
        link("Bookmarks", systemImage: "bookmark", page: .bookmarks)
        link("Liked posts", systemImage: "heart", page: .favourites)
      }

      Section {
        webLink("Password, passkeys and two-step sign-in", systemImage: "lock.shield", path: "settings/security")
        webLink("Apps with access", systemImage: "app.badge.checkmark", path: "settings/apps")
        webLink("Export, move or delete the account", systemImage: "person.crop.circle.badge.exclamationmark", path: "settings/account")
      } header: {
        Text("Security and account")
      } footer: {
        Text("These open your server's page, where you confirm with your password.")
      }

      Section {
        LabeledContent("Version", value: Self.version)
        if let server = model.session?.server {
          LabeledContent("Server", value: server.host() ?? server.absoluteString)
        }
        Link(destination: URL(string: "https://github.com/faghy/disbigle")!) {
          Label("Source code", systemImage: "chevron.left.forwardslash.chevron.right")
        }
        Link(destination: URL(string: "https://disbigle.com")!) {
          Label("disbigle.com", systemImage: "globe")
        }
      }

      Section {
        Button("Sign out", role: .destructive) { confirmSignOut = true }
      }
    }
    .navigationTitle("Settings")
    .confirmationDialog("Sign out of Disbigle?", isPresented: $confirmSignOut, titleVisibility: .visible) {
      Button("Sign out", role: .destructive) { Task { await model.signOut() } }
    }
    .sheet(item: $web) { url in
      SafariView(url: url).ignoresSafeArea()
    }
    .task {
      followRequests = (try? await model.client?.credentials().source?.followRequestsCount) ?? 0
    }
  }

  private func link(
    _ title: LocalizedStringKey, systemImage: String, page: SettingsPage, count: Int = 0
  ) -> some View {
    Button {
      router.go(.settings(page))
    } label: {
      HStack {
        Label(title, systemImage: systemImage)
        Spacer()
        if count > 0 {
          Text(count, format: .number).foregroundStyle(.secondary)
        }
        Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func webLink(_ title: LocalizedStringKey, systemImage: String, path: String) -> some View {
    Button {
      web = model.session?.server.appending(path: path)
    } label: {
      HStack {
        Label(title, systemImage: systemImage)
        Spacer()
        Image(systemName: "arrow.up.forward.square").font(.footnote).foregroundStyle(.tertiary)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  static var version: String {
    let info = Bundle.main.infoDictionary
    let short = info?["CFBundleShortVersionString"] as? String ?? "?"
    let build = info?["CFBundleVersion"] as? String ?? "?"
    return "\(short) (\(build))"
  }
}

extension URL: @retroactive Identifiable {
  public var id: String { absoluteString }
}

/** A web page inside the app (Safari, with its cookies and password autofill). */
struct SafariView: UIViewControllerRepresentable {
  let url: URL

  func makeUIViewController(context: Context) -> SFSafariViewController {
    let controller = SFSafariViewController(url: url)
    controller.preferredControlTintColor = UIColor(Color.brand)
    return controller
  }

  func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

// MARK: Notifications

struct NotificationSettingsScreen: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var preferences = model.preferences
    let notifier = model.notifier
    Form {
      Section {
        Toggle("Notifications on this iPhone", isOn: Binding(
          get: { preferences.notificationsOn && notifier.authorization != .denied },
          set: { on in Task { await turn(on) } }))
        if notifier.authorization == .denied {
          Button("Allow notifications in iOS Settings") {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
          }
        }
        Toggle("Unread count on the app icon", isOn: $preferences.badge)
      } footer: {
        Text("iOS wakes Disbigle from time to time to look for new notifications, usually every 15–30 minutes and less often when the battery is low. Keep Background App Refresh on for Disbigle in the iOS settings.")
      }
      if preferences.notificationsOn {
        Section("Notify me about") {
          ForEach(Alerts.kinds, id: \.self) { kind in
            Toggle(Alerts.label(for: kind), isOn: Binding(
              get: { preferences.alertKinds.contains(kind) },
              set: { on in
                if on { preferences.alertKinds.insert(kind) } else { preferences.alertKinds.remove(kind) }
              }))
          }
        }
      }
    }
    .navigationTitle("Notifications")
    .task { await notifier.refreshAuthorization() }
  }

  private func turn(_ on: Bool) async {
    if on {
      guard await model.notifier.requestPermission() else { return }
      model.preferences.notificationsOn = true
      // Start from what is there now: older notifications are not news.
      await model.notifier.check(client: model.client, preferences: model.preferences, announce: false)
      model.notifier.schedule()
    } else {
      model.preferences.notificationsOn = false
    }
  }
}

// MARK: Posting

struct PostingSettingsScreen: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var preferences = model.preferences
    Form {
      Section {
        Picker("Default visibility", selection: $preferences.defaultVisibility) {
          Text("Everyone").tag(DisbigleKit.Visibility.public)
          Text("Everyone, not in timelines").tag(DisbigleKit.Visibility.unlisted)
          Text("Followers").tag(DisbigleKit.Visibility.private)
        }
        Toggle("Always mark media as sensitive", isOn: $preferences.sensitiveMedia)
      } footer: {
        Text("Used for new posts written on this iPhone; replies keep the visibility of the conversation.")
      }
    }
    .navigationTitle("Posting")
  }
}

// MARK: Profile

struct EditProfileScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var draft: ProfileDraft?
  @State private var avatarItem: PhotosPickerItem?
  @State private var headerItem: PhotosPickerItem?
  @State private var avatarPreview: Image?
  @State private var headerPreview: Image?
  @State private var saving = false
  @State private var error: String?

  var body: some View {
    Group {
      if let binding = Binding($draft) {
        form(binding)
      } else if let error {
        Text(error).foregroundStyle(.secondary).padding()
      } else {
        ProgressView()
      }
    }
    .navigationTitle("Edit profile")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        if saving {
          ProgressView()
        } else {
          Button("Save") { Task { await save() } }.disabled(draft == nil)
        }
      }
    }
    .task {
      guard draft == nil else { return }
      do {
        if let credentials = try await model.client?.credentials() {
          draft = ProfileDraft(account: credentials)
        }
      } catch {
        self.error = error.localizedDescription
      }
    }
    .onChange(of: avatarItem) { _, item in Task { await load(item, avatar: true) } }
    .onChange(of: headerItem) { _, item in Task { await load(item, avatar: false) } }
  }

  private func form(_ draft: Binding<ProfileDraft>) -> some View {
    Form {
      Section("Pictures") {
        PhotosPicker(selection: $avatarItem, matching: .images) {
          HStack {
            Group {
              if let avatarPreview {
                avatarPreview.resizable().scaledToFill()
                  .frame(width: 56, height: 56)
                  .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
              } else {
                Avatar(account: model.me, size: 56)
              }
            }
            Text("Change the profile picture")
          }
        }
        PhotosPicker(selection: $headerItem, matching: .images) {
          HStack {
            Group {
              if let headerPreview {
                headerPreview.resizable().scaledToFill()
              } else if let url = model.me?.headerURL {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.brand.opacity(0.2) }
              } else {
                LinearGradient(colors: [Color.brand, Color.brand.opacity(0.6)], startPoint: .leading, endPoint: .trailing)
              }
            }
            .frame(width: 96, height: 32)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            Text("Change the cover image")
          }
        }
      }
      Section("Name and bio") {
        TextField("Display name", text: draft.displayName)
        TextField("Bio", text: draft.note, axis: .vertical).lineLimit(3...8)
      }
      Section {
        ForEach(draft.fields.indices, id: \.self) { index in
          VStack(alignment: .leading) {
            TextField("Label", text: draft.fields[index].name).font(.footnote.bold())
            TextField("Content (a link is fine)", text: draft.fields[index].value)
              .textInputAutocapitalization(.never)
          }
        }
        .onDelete { draft.wrappedValue.fields.remove(atOffsets: $0) }
        if draft.wrappedValue.fields.count < 4 {
          Button("Add a field") { draft.wrappedValue.fields.append(Account.Field(name: "", value: "")) }
        }
      } header: {
        Text("Profile fields")
      } footer: {
        Text("Up to four, e.g. your website or where else to find you.")
      }
      Section {
        Toggle("Approve new followers", isOn: draft.locked)
        Toggle("Suggest my profile to others", isOn: draft.discoverable)
        Toggle("This is an automated account", isOn: draft.bot)
        Picker("Language of emails", selection: Binding(
          get: { draft.wrappedValue.language ?? "en" },
          set: { draft.wrappedValue.language = $0 })) {
            Text("English").tag("en")
            Text("Italiano").tag("it")
            Text("Español").tag("es")
          }
      }
      if let error {
        Section { Text(error).foregroundStyle(.red) }
      }
    }
  }

  private func load(_ item: PhotosPickerItem?, avatar: Bool) async {
    guard let item, let data = try? await item.loadTransferable(type: Data.self),
      let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85)
    else { return }
    let upload = ProfileDraft.Upload(data: jpeg, mimeType: "image/jpeg")
    if avatar {
      draft?.avatar = upload
      avatarPreview = Image(uiImage: image)
    } else {
      draft?.header = upload
      headerPreview = Image(uiImage: image)
    }
  }

  private func save() async {
    guard let draft, let client = model.client else { return }
    saving = true
    defer { saving = false }
    do {
      _ = try await client.updateProfile(draft)
      await model.refresh()
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

// MARK: People

struct AccountListScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  let list: Client.AccountList
  @State private var accounts: PagedList<Account>?

  var body: some View {
    Group {
      if let accounts {
        List {
          ForEach(accounts.items) { account in
            HStack {
              Button {
                router.go(.account(account))
              } label: {
                AccountRow(account: account)
              }
              .buttonStyle(.plain)
              Spacer()
              actions(for: account, in: accounts)
            }
            .task { await accounts.reached(account) }
          }
          ListFooter(
            loading: accounts.loading, error: accounts.error, empty: accounts.items.isEmpty,
            emptyText: "Nobody here."
          ) { Task { await accounts.loadMore() } }
        }
        .listStyle(.plain)
        .refreshable { await accounts.refresh() }
        .task { if accounts.items.isEmpty { await accounts.refresh() } }
      } else {
        ProgressView()
      }
    }
    .navigationTitle(title)
    .onAppear {
      guard accounts == nil, let client = model.client else { return }
      let kind = list
      accounts = PagedList { try await client.accounts(kind, query: $0) }
    }
  }

  private var title: LocalizedStringKey {
    switch list {
    case .blocks: "Blocked"
    case .mutes: "Muted"
    case .followRequests: "Follow requests"
    }
  }

  @ViewBuilder
  private func actions(for account: Account, in accounts: PagedList<Account>) -> some View {
    let client = model.client
    switch list {
    case .blocks:
      Button("Unblock") {
        Task { if (try? await client?.act(.unblock, on: account.id)) != nil { accounts.remove(id: account.id) } }
      }
      .buttonStyle(.bordered)
    case .mutes:
      Button("Unmute") {
        Task { if (try? await client?.act(.unmute, on: account.id)) != nil { accounts.remove(id: account.id) } }
      }
      .buttonStyle(.bordered)
    case .followRequests:
      HStack {
        Button {
          Task {
            if (try? await client?.answerFollowRequest(from: account.id, accept: true)) != nil {
              accounts.remove(id: account.id)
            }
          }
        } label: {
          Image(systemName: "checkmark")
        }
        .buttonStyle(.borderedProminent)
        .accessibilityLabel(Text("Accept"))
        Button {
          Task {
            if (try? await client?.answerFollowRequest(from: account.id, accept: false)) != nil {
              accounts.remove(id: account.id)
            }
          }
        } label: {
          Image(systemName: "xmark")
        }
        .buttonStyle(.bordered)
        .accessibilityLabel(Text("Decline"))
      }
    }
  }
}

struct SavedPostsScreen: View {
  @Environment(AppModel.self) private var model
  let bookmarks: Bool
  @State private var list: PagedList<Status>?

  var body: some View {
    Group {
      if let list { StatusListView(list: list, emptyText: "Nothing saved yet.") } else { ProgressView() }
    }
    .navigationTitle(bookmarks ? LocalizedStringKey("Bookmarks") : "Liked posts")
    .onAppear {
      guard list == nil, let client = model.client else { return }
      let saved = bookmarks
      list = PagedList { query in
        saved ? try await client.bookmarks(query: query) : try await client.favourites(query: query)
      }
    }
  }
}

// MARK: Aspects

struct AspectsScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  @State private var aspects: [AspectList] = []
  @State private var newName = ""
  @State private var renaming: AspectList?
  @State private var renameText = ""
  @State private var error: String?

  var body: some View {
    List {
      Section {
        ForEach(aspects) { aspect in
          Button {
            router.go(.settings(.aspect(aspect)))
          } label: {
            HStack {
              Label(aspect.title, systemImage: "person.2")
              Spacer()
              Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .swipeActions {
            Button("Delete", role: .destructive) { Task { await delete(aspect) } }
            Button("Rename") {
              renameText = aspect.title
              renaming = aspect
            }
          }
        }
      } footer: {
        Text("Aspects are the groups you share with, as on diaspora*. Add people from their profile.")
      }
      Section {
        HStack {
          TextField("New aspect", text: $newName).onSubmit { Task { await create() } }
          Button("Add") { Task { await create() } }
            .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
      if let error {
        Section { Text(error).foregroundStyle(.red) }
      }
    }
    .navigationTitle("Aspects")
    .refreshable { await load() }
    .task { await load() }
    .alert("Rename aspect", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
      TextField("Name", text: $renameText)
      Button("Cancel", role: .cancel) { renaming = nil }
      Button("Save") { Task { await rename() } }
    }
  }

  private func load() async {
    aspects = (try? await model.client?.aspects()) ?? aspects
  }

  private func create() async {
    let name = newName.trimmingCharacters(in: .whitespaces)
    guard !name.isEmpty, let client = model.client else { return }
    do {
      aspects.append(try await client.createAspect(name))
      newName = ""
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func rename() async {
    guard let aspect = renaming, let client = model.client else { return }
    renaming = nil
    do {
      let renamed = try await client.renameAspect(aspect.id, to: renameText.trimmingCharacters(in: .whitespaces))
      if let index = aspects.firstIndex(where: { $0.id == aspect.id }) { aspects[index] = renamed }
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete(_ aspect: AspectList) async {
    guard let client = model.client else { return }
    do {
      try await client.deleteAspect(aspect.id)
      aspects.removeAll { $0.id == aspect.id }
    } catch {
      self.error = error.localizedDescription
    }
  }
}

struct AspectMembersScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(Router.self) private var router
  let aspect: AspectList
  @State private var members: [Account] = []
  @State private var loading = true

  var body: some View {
    List {
      ForEach(members) { account in
        Button {
          router.go(.account(account))
        } label: {
          AccountRow(account: account)
        }
        .buttonStyle(.plain)
        .swipeActions {
          Button("Remove", role: .destructive) {
            Task {
              if (try? await model.client?.removeMember(account.id, from: aspect.id)) != nil {
                members.removeAll { $0.id == account.id }
              }
            }
          }
        }
      }
      if !loading && members.isEmpty {
        Text("Nobody in this aspect yet.").foregroundStyle(.secondary)
      }
    }
    .navigationTitle(aspect.title)
    .task {
      members = (try? await model.client?.members(of: aspect.id)) ?? []
      loading = false
    }
  }
}
