import DisbigleKit
import SwiftUI

struct ProfileScreen: View {
  @Environment(AppModel.self) private var model
  let account: Account
  var isMe = false
  @State private var relationship: Relationship?
  @State private var list: PagedList<Status>?
  @State private var confirmSignOut = false
  @State private var following = false

  var body: some View {
    List {
      header
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
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
    .listStyle(.plain)
    .refreshable { await list?.refresh() }
    .navigationTitle(account.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if isMe {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            if let url = URL(string: account.url) {
              Link(destination: url.deletingLastPathComponent().appending(path: "settings")) {
                Label("Settings on the web", systemImage: "gear")
              }
            }
            Button(role: .destructive) {
              confirmSignOut = true
            } label: {
              Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
            }
          } label: {
            Label("Account", systemImage: "ellipsis.circle")
          }
        }
      }
    }
    .confirmationDialog("Sign out of Disbigle?", isPresented: $confirmSignOut, titleVisibility: .visible) {
      Button("Sign out", role: .destructive) { Task { await model.signOut() } }
    }
    .task {
      guard let client = model.client else { return }
      if list == nil {
        let id = account.id
        let newList = PagedList<Status> { try await client.statuses(of: id, query: $0) }
        list = newList
        await newList.refresh()
      }
      if !isMe { relationship = try? await client.relationship(with: account.id) }
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
