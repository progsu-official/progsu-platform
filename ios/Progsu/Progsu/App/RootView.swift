import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model
        let theme = model.theme
        // The theme is injected as an environment value on a stable TabView, so switching variants
        // re-renders colours without rebuilding view identity or dropping navigation stacks.
        TabView(selection: $model.selectedTab) {
            NavigationStack(path: model.path(for: .home)) { HomeView().routes() }
                .tabItem { Label("Home", systemImage: "house") }
                .tag(AppTab.home)
            NavigationStack(path: model.path(for: .events)) { EventsView().routes() }
                .tabItem { Label("Events", systemImage: "calendar") }
                .tag(AppTab.events)
            NavigationStack(path: model.path(for: .pass)) { MyQRView().routes() }
                .tabItem { Label("My QR", systemImage: "qrcode") }
                .tag(AppTab.pass)
            NavigationStack(path: model.path(for: .hacklanta)) { HacklantaView().routes() }
                .tabItem { Label("Hacklanta", systemImage: "sparkles") }
                .tag(AppTab.hacklanta)
            NavigationStack(path: model.path(for: .profile)) { ProfileView().routes() }
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
                .tag(AppTab.profile)
        }
        .tint(theme.primary)
        .environment(\.theme, theme)
        .preferredColorScheme(theme.forcedScheme)
        .fullScreenCover(isPresented: Binding(get: { model.needsOnboarding }, set: { _ in })) {
            OnboardingFlow()
                .environment(\.theme, theme)
                .preferredColorScheme(theme.forcedScheme)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.now = Date()
                Task { await model.refreshConfig() }
            }
        }
    }
}

extension View {
    func routes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .event(let slug): EventDetailView(slug: slug)
            case .announcement(let a): AnnouncementDetailView(announcement: a)
            case .announcementID(let id): AnnouncementDetailView(announcementID: id)
            case .announcements: AnnouncementsView()
            case .points: PointsView()
            case .settings: SettingsView()
            case .staff: StaffHomeView()
            case .staffEvent(let e): StaffEventView(event: e)
            case .hacklantaSession(let id): HacklantaSessionLookupView(sessionID: id)
            case .myEvents: MyEventsView()
            }
        }
    }
}
