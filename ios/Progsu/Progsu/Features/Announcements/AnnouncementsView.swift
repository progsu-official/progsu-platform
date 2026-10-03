import SwiftUI

struct AnnouncementRow: View {
    @Environment(\.theme) private var theme
    let announcement: Announcement
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if announcement.read == false {
                Circle().fill(theme.primary).frame(width: 8, height: 8).padding(.top, 7)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(announcement.title).font(.headline)
                Text(announcement.body).font(.subheadline).lineLimit(2).foregroundStyle(theme.mutedForeground)
                Text(announcement.publishedAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption).monospacedDigit().foregroundStyle(theme.mutedForeground)
            }
            Spacer(minLength: 0)
        }
        .glassCard(padding: 14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel((announcement.read == false ? "Unread. " : "") + announcement.title)
    }
}

struct AnnouncementsView: View {
    @Environment(AppModel.self) private var model
    @State private var state: Loadable<[Announcement]> = .idle
    @State private var cursor: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                switch state {
                case .idle, .loading: LoadingView()
                case .failed(let e, _, _): StateMessage.error(e) { Task { await load() } }
                case .loaded(let list, _):
                    if list.isEmpty {
                        StateMessage(title: "No announcements", message: "Updates from officers will appear here.", systemImage: "megaphone")
                    }
                    ForEach(list) { a in
                        NavigationLink(value: Route.announcement(a)) { AnnouncementRow(announcement: a) }.buttonStyle(.plain)
                    }
                    if cursor != nil { ProgressView().frame(maxWidth: .infinity).task { await more() } }
                }
            }
            .padding(16)
        }
        .progsuScreen()
        .navigationTitle("Announcements")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let page = try await model.api.announcements()
            state = .loaded(page.items); cursor = page.nextCursor
        } catch let e as APIError { if case .cancelled = e { return }; state = .failed(e, cached: state.value) } catch {}
    }

    private func more() async {
        guard let c = cursor, let current = state.value else { return }
        if let page = try? await model.api.announcements(cursor: c) {
            state = .loaded(current + page.items); cursor = page.nextCursor
        } else { cursor = nil }
    }
}

struct AnnouncementDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var announcement: Announcement?
    @State private var notFound = false
    private let id: String

    init(announcement: Announcement) { _announcement = State(initialValue: announcement); id = announcement.id }
    init(announcementID: String) { id = announcementID }

    var body: some View {
        ScrollView {
            Group {
                if let a = announcement {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(a.title).font(.title.weight(.bold))
                        Text(a.publishedAt.formatted(date: .long, time: .shortened)).font(.subheadline).foregroundStyle(theme.mutedForeground)
                        Text((try? AttributedString(markdown: a.body, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(a.body))
                        if let link = a.deepLink, let url = URL(string: link) {
                            Link(destination: url) { Label("Open link", systemImage: "arrow.up.right.square") }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                    .glassCard()
                } else if notFound {
                    StateMessage(title: "Announcement not found", message: "It may have been removed.", systemImage: "megaphone")
                } else { LoadingView() }
            }
            .padding(16)
        }
        .progsuScreen()
        .navigationTitle("Announcement")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if announcement == nil {
                // No single-item route in API v1; find it in the feed.
                let page = try? await model.api.announcements()
                announcement = page?.items.first { $0.id == id }
                notFound = announcement == nil
            }
            if model.authState == .signedIn, announcement?.read == false { try? await model.api.markAnnouncementRead(id) }
        }
    }
}
