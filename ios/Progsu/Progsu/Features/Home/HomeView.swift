import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var events: Loadable<[EventSummary]> = .idle
    @State private var announcements: Loadable<[Announcement]> = .idle

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(greeting).font(.largeTitle.weight(.bold))
                    Text("Progsu at Georgia State").font(.subheadline).foregroundStyle(theme.mutedForeground)
                }
                if let edition = model.config?.hacklanta, model.config?.features.hacklanta != false, edition.endsAt > Date() { hacklantaCard(edition) }
                if model.authState == .signedIn, let me = model.me {
                    NavigationLink(value: Route.points) {
                        HStack {
                            VStack(alignment: .leading) {
                                Eyebrow("Points")
                                Text("\(me.pointsBalance)").font(.title.weight(.bold)).monospacedDigit()
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(theme.mutedForeground).accessibilityHidden(true)
                        }
                        .glassCard()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Points balance \(me.pointsBalance)")
                }
                section("Upcoming events", destination: nil) {
                    switch events {
                    case .idle, .loading: LoadingView()
                    case .failed(let e, let cached, _):
                        if let cached, !cached.isEmpty { eventList(cached) } else { StateMessage.error(e) { Task { await load() } } }
                    case .loaded(let list, _):
                        if list.isEmpty {
                            StateMessage(title: "No upcoming events", message: "New events show up here as soon as they're published.", systemImage: "calendar")
                        } else { eventList(list) }
                    }
                }
                section("Announcements", destination: .announcements) {
                    switch announcements {
                    case .idle, .loading: LoadingView()
                    case .failed(let e, _, _): StateMessage.error(e) { Task { await load() } }
                    case .loaded(let list, _):
                        if list.isEmpty {
                            StateMessage(title: "No announcements", message: "Updates from officers will appear here.", systemImage: "megaphone")
                        } else {
                            ForEach(list.prefix(3)) { a in
                                NavigationLink(value: Route.announcement(a)) { AnnouncementRow(announcement: a) }.buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .progsuScreen()
        .navigationTitle("Home")
        .toolbar(.hidden, for: .navigationBar)
        .task(id: model.authState) { await load() }
        .refreshable { await load() }
    }

    private var greeting: String {
        if let me = model.me, let first = me.firstName, !first.isEmpty { return "Hi, \(first)" }
        return "Welcome"
    }

    private func hacklantaCard(_ e: HacklantaEditionSummary) -> some View {
        Button { model.selectedTab = .hacklanta } label: {
            HStack(spacing: 12) {
                Image("HacklantaWordmark").resizable().scaledToFit().frame(height: 48).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.name).font(.headline)
                    Text(e.startsAt > Date() ? "Starts \(e.startsAt.formatted(.relative(presentation: .named)))" : "Happening now")
                        .font(.subheadline).foregroundStyle(theme.mutedForeground)
                    Text("Schedule and map").font(.footnote.weight(.semibold)).foregroundStyle(theme.primary)
                }
                Spacer(minLength: 0)
            }
            .glassCard()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(e.name). Open schedule and map")
    }

    @ViewBuilder private func eventList(_ list: [EventSummary]) -> some View {
        ForEach(list.prefix(3)) { e in
            NavigationLink(value: Route.event(slug: e.slug)) { EventRow(event: e).glassCard(padding: 14) }.buttonStyle(.plain)
        }
    }

    @ViewBuilder private func section<C: View>(_ title: String, destination: Route?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                if let destination {
                    NavigationLink("See all", value: destination).font(.subheadline.weight(.semibold)).foregroundStyle(theme.primary)
                } else {
                    Button("See all") { model.selectedTab = .events }.font(.subheadline.weight(.semibold)).foregroundStyle(theme.primary)
                }
            }
            content()
        }
    }

    private func load() async {
        async let ev: Void = loadEvents()
        async let an: Void = loadAnnouncements()
        _ = await (ev, an)
    }

    private func loadEvents() async {
        do {
            let page = try await model.api.events(limit: 3)
            events = .loaded(page.items)
        } catch let e as APIError {
            if case .cancelled = e { return }
            let snap = await model.cache.load([EventSummary].self, key: "events", scope: .public)
            events = .failed(e, cached: snap?.value, savedAt: snap?.savedAt)
        } catch {}
    }

    private func loadAnnouncements() async {
        do { announcements = .loaded(try await model.api.announcements().items) }
        catch let e as APIError { if case .cancelled = e { return }; announcements = .failed(e) }
        catch {}
    }
}
