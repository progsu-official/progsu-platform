import SwiftUI

struct EventsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var state: Loadable<[EventSummary]> = .idle
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var query = ""

    var body: some View {
        List {
            if model.authState == .signedIn {
                NavigationLink(value: Route.myEvents) {
                    Label("My RSVPs and history", systemImage: "checkmark.circle")
                }
                .listRowBackground(theme.glassFill)
            }
            switch state {
            case .idle, .loading:
                LoadingView(label: "Loading events").listRowBackground(Color.clear)
            case .failed(let error, let cached, let savedAt):
                if let cached, !cached.isEmpty {
                    if let savedAt { LastUpdatedBanner(savedAt: savedAt).listRowBackground(Color.clear) }
                    rows(cached)
                } else {
                    StateMessage.error(error) { Task { await load() } }.listRowBackground(Color.clear)
                }
            case .loaded(let events, _):
                if events.isEmpty {
                    StateMessage(title: query.isEmpty ? "No upcoming events" : "No matches",
                                 message: query.isEmpty ? "New events show up here as soon as they're published." : "Try a different search.",
                                 systemImage: "calendar.badge.clock")
                        .listRowBackground(Color.clear)
                } else {
                    rows(events)
                    if nextCursor != nil {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .listRowBackground(Color.clear)
                            .task { await loadMore() }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .progsuScreen()
        .navigationTitle("Events")
        .searchable(text: $query, prompt: "Search events")
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await load()
        }
        .refreshable { await load() }
    }

    @ViewBuilder private func rows(_ events: [EventSummary]) -> some View {
        ForEach(events) { event in
            NavigationLink(value: Route.event(slug: event.slug)) { EventRow(event: event) }
                .listRowBackground(theme.glassFill)
        }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let page = try await model.api.events(query: query)
            nextCursor = page.nextCursor
            state = .loaded(page.items)
            if query.isEmpty { await model.cache.save(page.items, key: "events", scope: .public) }
        } catch let e as APIError {
            if case .cancelled = e { return }
            let snap = query.isEmpty ? await model.cache.load([EventSummary].self, key: "events", scope: .public) : nil
            state = .failed(e, cached: state.value ?? snap?.value, savedAt: snap?.savedAt)
        } catch {}
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !loadingMore, case .loaded(let current, _) = state else { return }
        loadingMore = true
        defer { loadingMore = false }
        if let page = try? await model.api.events(cursor: cursor, query: query) {
            let seen = Set(current.map(\.id))
            state = .loaded(current + page.items.filter { !seen.contains($0.id) })
            nextCursor = page.nextCursor
        } else {
            nextCursor = nil
        }
    }
}

struct EventRow: View {
    @Environment(\.theme) private var theme
    let event: EventSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(event.title).font(.headline)
            Text(EventFormatting.dateLine(start: event.startsAt, end: event.endsAt, timeZone: event.timeZone))
                .font(.subheadline).monospacedDigit()
                .foregroundStyle(theme.mutedForeground)
            if let location = event.locationText, !location.isEmpty {
                Label(location, systemImage: "mappin.and.ellipse")
                    .font(.footnote).foregroundStyle(theme.mutedForeground)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct MyEventsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var state: Loadable<[MyEvent]> = .idle

    var body: some View {
        List {
            switch state {
            case .idle, .loading: LoadingView().listRowBackground(Color.clear)
            case .failed(let e, let cached, let savedAt):
                if let cached { if let savedAt { LastUpdatedBanner(savedAt: savedAt) }; sections(cached) }
                else { StateMessage.error(e) { Task { await load() } }.listRowBackground(Color.clear) }
            case .loaded(let data, _):
                if data.isEmpty {
                    StateMessage(title: "Nothing yet", message: "Events you RSVP to and attend will appear here.", systemImage: "calendar")
                        .listRowBackground(Color.clear)
                } else { sections(data) }
            }
        }
        .progsuScreen()
        .navigationTitle("My events")
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder private func sections(_ data: [MyEvent]) -> some View {
        let now = Date()
        let upcoming = data.filter { $0.event.endsAt > now }.sorted { $0.event.startsAt < $1.event.startsAt }
        let past = data.filter { $0.event.endsAt <= now }
        if !upcoming.isEmpty {
            Section("Upcoming") {
                ForEach(upcoming) { item in
                    NavigationLink(value: Route.event(slug: item.event.slug)) { EventRow(event: item.event) }
                }
            }.listRowBackground(theme.glassFill)
        }
        if !past.isEmpty {
            Section("History") {
                ForEach(past) { item in
                    NavigationLink(value: Route.event(slug: item.event.slug)) {
                        HStack {
                            EventRow(event: item.event)
                            Spacer()
                            if item.checkedInAt != nil {
                                StatusPill(text: "Attended", systemImage: "checkmark.circle.fill", tone: .positive)
                            } else {
                                StatusPill(text: "Missed", systemImage: "minus.circle", tone: .neutral)
                            }
                        }
                    }
                }
            }.listRowBackground(theme.glassFill)
        }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let data = try await model.api.myEvents().items
            state = .loaded(data)
            await model.cache.save(data, key: "my-events", scope: .user)
        } catch let e as APIError {
            let snap = await model.cache.load([MyEvent].self, key: "my-events", scope: .user)
            state = .failed(e, cached: snap?.value, savedAt: snap?.savedAt)
        } catch {}
    }
}
