import MapKit
import SwiftUI

struct HacklantaView: View {
    enum Section: String, CaseIterable, Identifiable {
        case schedule = "Schedule", map = "Map", agenda = "My agenda"
        var id: String { rawValue }
    }

    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var store = HacklantaStore.shared
    @State private var section: Section = .schedule

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                Picker("Section", selection: $section) {
                    ForEach(Section.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                switch store.state {
                case .idle, .loading: LoadingView(label: "Loading Hacklanta")
                case .failed(let e, let cached, let savedAt):
                    if let cached {
                        if let savedAt { LastUpdatedBanner(savedAt: savedAt) }
                        sectionContent(cached)
                    } else if case .notFound = e {
                        StateMessage(title: "No Hacklanta edition yet", message: "The schedule appears here once organizers publish it.", systemImage: "calendar.badge.clock")
                    } else {
                        StateMessage.error(e) { Task { await load() } }
                    }
                case .loaded(let edition, let savedAt):
                    if let savedAt { LastUpdatedBanner(savedAt: savedAt) }
                    sectionContent(edition)
                }

                Toggle(isOn: $model.hacklantaPreview) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Preview Hacklanta mode")
                        Text("Switches the app to the Hacklanta look. It turns on automatically during the event.")
                            .font(.footnote).foregroundStyle(theme.mutedForeground)
                    }
                }
                .glassCard()
                .accessibilityIdentifier("hacklanta-preview-toggle")
            }
            .padding(16)
        }
        .progsuScreen()
        .navigationTitle("Hacklanta")
        .task { await load() }
        .refreshable { await load() }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Image("HacklantaWordmark")
                .resizable().scaledToFit()
                .frame(height: 56)
                .accessibilityLabel("Hacklanta")
            if let e = store.state.value {
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.edition.name).font(.headline)
                    Text(dateRange(e)).font(.subheadline).monospacedDigit().foregroundStyle(theme.mutedForeground)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func dateRange(_ e: HacklantaGuide) -> String {
        var f = Date.FormatStyle(date: .abbreviated, time: .omitted)
        f.timeZone = TimeZone(identifier: e.edition.timeZone) ?? .current
        return "\(e.edition.startsAt.formatted(f)) – \(e.edition.endsAt.formatted(f))"
    }

    @ViewBuilder private func sectionContent(_ e: HacklantaGuide) -> some View {
        switch section {
        case .schedule: ScheduleSection(edition: e, store: store, agendaOnly: false)
        case .agenda:
            if model.authState == .signedIn {
                ScheduleSection(edition: e, store: store, agendaOnly: true)
            } else {
                SignInPanel(title: "Build your agenda", message: "Sign in to bookmark sessions. The schedule and map stay open to everyone.")
            }
        case .map: VenueMapSection(edition: e)
        }
    }

    private func load() async {
        await store.load(api: model.api, cache: model.cache, signedIn: model.authState == .signedIn)
    }
}

struct ScheduleSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    let edition: HacklantaGuide
    let store: HacklantaStore
    let agendaOnly: Bool
    @State private var filter: SessionFilter = .all
    @State private var dayID: String?

    var body: some View {
        let tz = TimeZone(identifier: edition.edition.timeZone) ?? .current
        let base = agendaOnly ? edition.sessions.filter { store.bookmarks.contains($0.id) } : edition.sessions
        let days = ScheduleGrouping.days(base.filter(filter.matches), timeZone: tz)
        let selected = days.first { $0.id == dayID } ?? days.first

        VStack(alignment: .leading, spacing: 12) {
            if edition.edition.scheduleTentative {
                Label("Times are tentative and may change.", systemImage: "exclamationmark.triangle")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(theme.warning)
            }
            if !agendaOnly { NowNextCard(edition: edition) }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SessionFilter.allCases) { f in
                        Button { filter = f } label: {
                            Text(f.label)
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 14).frame(minHeight: 44)
                                .background(filter == f ? theme.primary : theme.glassFill, in: Capsule())
                                .foregroundStyle(filter == f ? theme.primaryForeground : theme.foreground)
                                .overlay(Capsule().strokeBorder(theme.hairline))
                        }
                        .accessibilityAddTraits(filter == f ? .isSelected : [])
                    }
                }
            }

            if days.count > 1 {
                Picker("Day", selection: Binding(get: { selected?.id ?? "" }, set: { dayID = $0 })) {
                    ForEach(days) { d in Text(dayLabel(d, tz: tz)).tag(d.id) }
                }
                .pickerStyle(.segmented)
            }

            if let selected {
                ForEach(selected.sessions) { s in
                    NavigationLink(value: Route.hacklantaSession(s.id)) {
                        SessionRow(session: s, timeZone: tz, bookmarked: store.bookmarks.contains(s.id))
                    }
                    .buttonStyle(.plain)
                }
            } else if agendaOnly {
                StateMessage(title: "No bookmarks yet", message: "Tap the bookmark on any session to add it here.", systemImage: "bookmark")
            } else if edition.sessions.isEmpty {
                StateMessage(title: "Schedule not published yet", message: "Sessions appear here as soon as organizers publish them.", systemImage: "calendar.badge.clock")
            } else {
                StateMessage(title: "Nothing in this filter", message: "Try another category.", systemImage: "line.3.horizontal.decrease.circle")
            }
            if let err = store.bookmarkError {
                Label(err, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(theme.destructive)
            }
        }
    }

    private func dayLabel(_ d: ScheduleGrouping.Day, tz: TimeZone) -> String {
        var f = Date.FormatStyle().weekday(.abbreviated)
        f.timeZone = tz
        return d.sessions.first.map { $0.startsAt.formatted(f) } ?? d.id
    }
}

struct NowNextCard: View {
    @Environment(\.theme) private var theme
    let edition: HacklantaGuide

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { ctx in
            let tz = TimeZone(identifier: edition.edition.timeZone) ?? .current
            let nn = NowNext.compute(edition.sessions, now: ctx.date)
            if !nn.now.isEmpty || nn.next != nil {
                VStack(alignment: .leading, spacing: 10) {
                    if !nn.now.isEmpty {
                        Eyebrow("Happening now")
                        ForEach(nn.now.prefix(3)) { s in
                            Text(s.title).font(.headline)
                        }
                    }
                    if let next = nn.next {
                        Eyebrow("Up next")
                        Text(next.title).font(.headline)
                        Text("\(SessionRow.timeText(next, tz: tz))\(edition.roomName(for: next).map { " · \($0)" } ?? "")")
                            .font(.subheadline).monospacedDigit().foregroundStyle(theme.mutedForeground)
                    }
                }
                .glassCard()
                .accessibilityElement(children: .combine)
            }
        }
    }
}

struct SessionRow: View {
    @Environment(\.theme) private var theme
    let session: HacklantaSession
    let timeZone: TimeZone
    let bookmarked: Bool

    static func timeText(_ s: HacklantaSession, tz: TimeZone) -> String {
        var f = Date.FormatStyle(date: .omitted, time: .shortened)
        f.timeZone = tz
        if let end = s.endsAt { return "\(s.startsAt.formatted(f)) – \(end.formatted(f))" }
        return "Starts \(s.startsAt.formatted(f))"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: session.kind.systemImage)
                .frame(width: 28, height: 28)
                .foregroundStyle(theme.primary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(session.title).font(.headline)
                    .strikethrough(session.status == .cancelled)
                Text(Self.timeText(session, tz: timeZone)).font(.subheadline).monospacedDigit()
                    .foregroundStyle(theme.mutedForeground)
                if let room = session.roomLabel {
                    Label(room, systemImage: "mappin").font(.footnote).foregroundStyle(theme.mutedForeground)
                }
                HStack(spacing: 6) {
                    if session.status == .cancelled { StatusPill(text: "Cancelled", systemImage: "xmark.circle", tone: .negative) }
                    if session.status == .moved { StatusPill(text: "Moved", systemImage: "arrow.triangle.swap", tone: .warning) }
                    if let note = session.pointsNote { StatusPill(text: note, systemImage: "info.circle", tone: .accent) }
                }
            }
            Spacer(minLength: 0)
            if bookmarked {
                Image(systemName: "bookmark.fill").foregroundStyle(theme.primary).accessibilityLabel("Bookmarked")
            }
        }
        .glassCard(padding: 14)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows session details")
    }
}

struct HacklantaSessionLookupView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    let sessionID: String
    @State private var store = HacklantaStore.shared

    var body: some View {
        ScrollView {
            Group {
                if let edition = store.state.value {
                    if let s = edition.sessions.first(where: { $0.id == sessionID || $0.key == sessionID }) {
                        detail(s, room: edition.roomName(for: s), tz: TimeZone(identifier: edition.edition.timeZone) ?? .current, tentative: edition.edition.scheduleTentative)
                    } else {
                        StateMessage(title: "Session not found", message: "It may have been removed from the schedule.", systemImage: "calendar.badge.exclamationmark")
                    }
                } else if store.state.isLoading || { if case .idle = store.state { return true }; return false }() {
                    LoadingView()
                } else {
                    StateMessage(title: "Couldn't load the schedule", message: "Check your connection and try again.", systemImage: "wifi.slash")
                }
            }
            .padding(16)
        }
        .progsuScreen()
        .navigationTitle("Session")
        .navigationBarTitleDisplayMode(.inline)
        .task { if store.state.value == nil { await store.load(api: model.api, cache: model.cache, signedIn: model.authState == .signedIn) } }
    }

    private func detail(_ s: HacklantaSession, room: String?, tz: TimeZone, tentative: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(s.kind.label, systemImage: s.kind.systemImage).font(.subheadline).foregroundStyle(theme.primary)
            Text(s.title).font(.title.weight(.bold))
            Label(SessionRow.timeText(s, tz: tz) + (tentative ? " (tentative)" : ""), systemImage: "clock").monospacedDigit()
            if let room { Label(room, systemImage: "mappin.and.ellipse") }
            if s.status == .cancelled { StatusPill(text: "Cancelled", systemImage: "xmark.circle", tone: .negative) }
            if s.status == .moved { StatusPill(text: "Moved — check the room", systemImage: "arrow.triangle.swap", tone: .warning) }
            if let note = s.pointsNote {
                Label("\(note). Points are awarded by organizers.", systemImage: "info.circle").font(.footnote)
            }
            if let d = s.description { Text(d).font(.body) }
            if model.authState == .signedIn {
                let on = store.bookmarks.contains(s.id)
                Button { Task { await store.toggle(s.id, api: model.api) } } label: {
                    Label(on ? "Remove from my agenda" : "Add to my agenda", systemImage: on ? "bookmark.slash" : "bookmark")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .glassCard()
    }
}

struct VenueMapSection: View {
    @Environment(\.theme) private var theme
    let edition: HacklantaGuide
    @State private var position: MapCameraPosition = .automatic
    @State private var item: MKMapItem?
    @State private var geocodeFailed = false
    @State private var selectedFloor: HacklantaFloor?

    private var venueName: String { edition.edition.venueName ?? "GSU Student Center" }
    private var venueQuery: String { edition.edition.venueAddress ?? "\(venueName), Atlanta, GA" }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Venue")
                Text(venueName).font(.headline)
                if let address = edition.edition.venueAddress { Text(address).font(.subheadline).foregroundStyle(theme.mutedForeground) }
                Map(position: $position) {
                    if let item { Marker(venueName, coordinate: item.placemark.coordinate) }
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: ProgsuTheme.radius))
                .accessibilityLabel("Map of \(venueName)")
                if geocodeFailed {
                    Text("Couldn't locate the venue on the map. Use the address above.").font(.footnote).foregroundStyle(theme.mutedForeground)
                }
                if let item {
                    Button { item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking]) } label: {
                        Label("Directions in Maps", systemImage: "arrow.triangle.turn.up.right.diamond")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
            .glassCard()

            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Floor plans")
                let floors = edition.floors.filter { $0.imageUrl != nil }
                if !floors.isEmpty {
                    ForEach(floors.sorted { $0.sort < $1.sort }) { f in
                        Button { selectedFloor = f } label: { Label(f.name, systemImage: "map") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                } else {
                    Label("Floor plans not published yet.", systemImage: "map")
                        .font(.subheadline).foregroundStyle(theme.mutedForeground)
                }
            }
            .glassCard()

            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Rooms")
                let rooms = edition.roomLabels
                if rooms.isEmpty {
                    Text("Rooms are listed once the schedule is published.").font(.subheadline).foregroundStyle(theme.mutedForeground)
                } else {
                    ForEach(rooms, id: \.self) { room in
                        let count = edition.sessions.filter { edition.roomName(for: $0) == room }.count
                        HStack {
                            Label(room, systemImage: "mappin")
                            Spacer()
                            Text("\(count) session\(count == 1 ? "" : "s")").monospacedDigit().foregroundStyle(theme.mutedForeground)
                        }
                        .font(.subheadline)
                        .frame(minHeight: 32)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .glassCard()
        }
        .task(id: venueQuery) { await geocode() }
        .sheet(item: $selectedFloor) { f in FloorPlanView(floor: f) }
    }

    private func geocode() async {
        if let lat = edition.edition.lat, let lon = edition.edition.lng {
            let it = MKMapItem(placemark: MKPlacemark(coordinate: .init(latitude: lat, longitude: lon)))
            it.name = venueName
            item = it
            position = .region(MKCoordinateRegion(center: it.placemark.coordinate, latitudinalMeters: 600, longitudinalMeters: 600))
            return
        }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = venueQuery
        request.region = MKCoordinateRegion(center: .init(latitude: 33.753, longitude: -84.386), latitudinalMeters: 20000, longitudinalMeters: 20000)
        do {
            let response = try await MKLocalSearch(request: request).start()
            if let first = response.mapItems.first {
                item = first
                position = .region(MKCoordinateRegion(center: first.placemark.coordinate, latitudinalMeters: 600, longitudinalMeters: 600))
            } else { geocodeFailed = true }
        } catch { geocodeFailed = true }
    }
}

struct FloorPlanView: View {
    let floor: HacklantaFloor
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1

    var body: some View {
        NavigationStack {
            ScrollView([.horizontal, .vertical]) {
                AsyncImage(url: floor.imageUrl.flatMap { URL(string: $0) }) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                            .frame(width: UIScreen.main.bounds.width * scale * pinch)
                            .accessibilityLabel("Floor plan: \(floor.name)")
                    case .failure:
                        StateMessage(title: "Couldn't load the floor plan", message: "Check your connection.", systemImage: "map")
                    default: ProgressView().frame(minHeight: 300)
                    }
                }
            }
            .gesture(MagnifyGesture().updating($pinch) { v, s, _ in s = v.magnification }
                .onEnded { v in scale = min(max(scale * v.magnification, 1), 5) })
            .navigationTitle(floor.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
