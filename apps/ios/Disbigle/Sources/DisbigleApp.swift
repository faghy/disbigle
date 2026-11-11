import AuthenticationServices
import DisbigleKit
import SwiftUI

@main
struct DisbigleApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @Environment(\.scenePhase) private var scenePhase
  @State private var model = AppModel()
  @AppStorage(Appearance.modeKey) private var mode = "system"
  @AppStorage(Appearance.accentKey) private var accent = "orange"

  var body: some Scene {
    WindowGroup {
      Group {
        if model.session != nil {
          MainView()
        } else {
          SignInView()
        }
      }
      .environment(model)
      .tint(Appearance.color(accent))
      .preferredColorScheme(Appearance.scheme(mode))
      // Colours are read when views are built: a new accent rebuilds them.
      .id(accent)
      .task(id: model.session?.token) { await model.refresh() }
      .onAppear {
        delegate.onOpen = { statusId, accountId in model.open(statusId: statusId, accountId: accountId) }
      }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .background && model.preferences.notificationsOn { model.notifier.schedule() }
      // Back in the app: a token revoked meanwhile (account deleted or signed out on the web)
      // returns to the sign-in screen instead of leaving every screen failing.
      if phase == .active { Task { await model.refresh() } }
    }
    .backgroundTask(.appRefresh(Notifier.refreshTask)) {
      await BackgroundRefresh.run()
    }
  }
}

/** What iOS runs when it wakes the app in the background. */
enum BackgroundRefresh {
  @MainActor static func run() async {
    let preferences = Preferences()
    guard preferences.notificationsOn, let session = Keychain.load() else { return }
    let notifier = Notifier()
    // Ask to be woken again first: if this run is cut short, the next one is still planned.
    notifier.schedule()
    await notifier.check(
      client: Client(server: session.server, token: session.token), preferences: preferences,
      announce: true)
  }
}

extension Color {
  /** The accent colour chosen in Settings → Appearance (Disbigle tomato by default). */
  static var brand: Color { Appearance.color(UserDefaults.standard.string(forKey: Appearance.accentKey)) }
}

/** Light, dark (pure black on iPhone) or the system's choice, and the accent colour. */
enum Appearance {
  static let modeKey = "appearance.mode"
  static let accentKey = "appearance.accent"
  static let modes = ["system", "light", "dark"]
  static let accents = ["orange", "red", "pink", "purple", "blue", "teal", "green", "grey"]

  static func color(_ accent: String?) -> Color {
    switch accent {
    case "red": Color(red: 0.776, green: 0.157, blue: 0.157)
    case "pink": Color(red: 0.761, green: 0.094, blue: 0.357)
    case "purple": Color(red: 0.482, green: 0.247, blue: 0.769)
    case "blue": Color(red: 0.122, green: 0.373, blue: 0.820)
    case "teal": Color(red: 0, green: 0.502, blue: 0.604)
    case "green": Color(red: 0.180, green: 0.490, blue: 0.196)
    case "grey": Color(red: 0.357, green: 0.392, blue: 0.439)
    default: Color(red: 207 / 255, green: 50 / 255, blue: 0)
    }
  }

  static func scheme(_ mode: String) -> ColorScheme? {
    switch mode {
    case "light": .light
    case "dark": .dark
    default: nil
    }
  }
}

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @State private var server = AppModel.defaultServer
  @State private var working = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "bubble.left.and.text.bubble.right.fill")
              .font(.system(size: 44))
              .foregroundStyle(Color.brand)
              .accessibilityHidden(true)
            Text("Welcome to Disbigle")
              .font(.title.bold())
            Text("One account for diaspora*, Mastodon and the whole fediverse.")
              .foregroundStyle(.secondary)
          }
          .padding(.vertical, 8)
        }
        Section {
          TextField("Server", text: $server)
            .textContentType(.URL)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .onSubmit { Task { await signIn() } }
        } header: {
          Text("Your server")
        } footer: {
          Text("Sign in happens on your server's page: the app never sees your password.")
        }
        if let error {
          Section { Text(error).foregroundStyle(.red) }
        }
        Section {
          Button {
            Task { await signIn() }
          } label: {
            HStack {
              Text("Sign in")
              Spacer()
              if working { ProgressView() }
            }
          }
          .disabled(working || server.trimmingCharacters(in: .whitespaces).isEmpty)
          Link("Create an account", destination: URL(string: "https://\(AppModel.defaultServer)/register")!)
        }
      }
      .navigationTitle("Disbigle")
    }
  }

  private func signIn() async {
    guard !working else { return }
    working = true
    error = nil
    defer { working = false }
    do {
      try await model.signIn(server: server) { url in
        try await webAuthenticationSession.authenticate(using: url, callbackURLScheme: "disbigle")
      }
    } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
      // Closed by the person: nothing to say.
    } catch SignIn.Failure.denied {
      error = String(localized: "The authorization was refused.")
    } catch {
      self.error = error.localizedDescription
    }
  }
}

struct MainView: View {
  @Environment(AppModel.self) private var model
  @State private var tab = "home"

  var body: some View {
    @Bindable var model = model
    TabView(selection: $tab) {
      TabStack { TimelineScreen() }
        .tabItem { Label("Home", systemImage: "house") }
        .tag("home")
      TabStack { NotificationsScreen() }
        .tabItem { Label("Notifications", systemImage: "bell") }
        .badge(model.notifier.unread)
        .tag("notifications")
      TabStack { ConversationsScreen() }
        .tabItem { Label("Messages", systemImage: "envelope") }
        .tag("messages")
      TabStack { SearchScreen() }
        .tabItem { Label("Search", systemImage: "magnifyingglass") }
        .tag("search")
      TabStack {
        if let me = model.me {
          ProfileScreen(account: me, isMe: true)
        } else {
          ProgressView()
        }
      }
      .tabItem { Label("Profile", systemImage: "person.crop.circle") }
      .tag("profile")
    }
    .sheet(item: $model.composing) { target in
      ComposeView(target: target)
    }
    .onChange(of: model.pendingRoute) { _, route in
      if route != nil { tab = "notifications" }
    }
    .task(id: model.session?.token) {
      // While the app is open: "I am around" every 45 s, shown in chats only to people you write
      // with, and only if you share your status (Messages on the web).
      while !Task.isCancelled {
        try? await model.client?.presence(active: true)
        try? await Task.sleep(for: .seconds(45))
      }
    }
    .task(id: model.session?.token) {
      // While the app is open: the unread count every minute (no system notifications).
      while !Task.isCancelled {
        await model.notifier.check(client: model.client, preferences: model.preferences, announce: false)
        try? await Task.sleep(for: .seconds(60))
      }
    }
    .onAppear {
      if model.pendingRoute != nil { tab = "notifications" }
      guard let screen = model.debugScreen else { return }
      if screen == "compose" {
        model.composing = .new
      } else if screen.hasPrefix("settings") {
        tab = "profile"
      } else if screen == "chat" {
        tab = "messages"
      } else {
        tab = screen
      }
    }
  }
}
