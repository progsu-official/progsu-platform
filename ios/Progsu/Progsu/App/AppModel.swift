import Foundation
import Observation
import SwiftUI
import UIKit

enum AppTab: String, Hashable, CaseIterable {
    case home, events, pass, hacklanta, profile
}

enum Route: Hashable {
    case event(slug: String)
    case announcement(Announcement)
    case announcementID(String)
    case announcements
    case points
    case settings
    case staff
    case staffEvent(StaffEvent)
    case hacklantaSession(String)
    case myEvents
}

@MainActor
@Observable
final class AppModel {
    enum AuthState: Equatable { case unknown, signedOut, signedIn }

    let configuration: AppConfiguration
    let auth: AuthService
    let api: ProgsuAPI
    let cache: DiskCache

    var authState: AuthState = .unknown
    var me: Me?
    var meError: APIError?
    var config: AppConfig?
    var selectedTab: AppTab = .home
    var paths: [AppTab: NavigationPath] = [:]
    var pushToken: String?
    var signInError: String?
    var now = Date()

    var hacklantaPreview: Bool {
        didSet { UserDefaults.standard.set(hacklantaPreview, forKey: Self.previewKey) }
    }
    private static let previewKey = "hacklanta.preview"
    private var themeTimer: Task<Void, Never>?
    private var authListener: Task<Void, Never>?
    private var pendingAppleName: PersonNameComponents?
    private var pendingAppleCode: String?

    var theme: ProgsuTheme {
        HacklantaThemeWindow.isActive(edition: config?.hacklanta, now: now, manualPreview: hacklantaPreview) ? .hacklanta : .progsu
    }

    var needsOnboarding: Bool { authState == .signedIn && me.map { !$0.onboarding.fullyOnboarded } == true }

    init(configuration: AppConfiguration = .current, uiTesting: Bool = ProcessInfo.processInfo.arguments.contains("-ui-testing")) {
        self.configuration = configuration
        let auth = AuthService(configuration: uiTesting ? AppConfiguration(supabaseURL: nil, supabaseAnonKey: "", apiBaseURL: configuration.apiBaseURL, universalLinkHost: configuration.universalLinkHost) : configuration)
        self.auth = auth
        self.api = ProgsuAPI(client: APIClient(baseURL: configuration.mobileAPIBase) { force in
            await auth.accessToken(forceRefresh: force)
        })
        self.cache = .shared
        let args = ProcessInfo.processInfo.arguments
        self.hacklantaPreview = args.contains("-hacklanta-preview") || UserDefaults.standard.bool(forKey: Self.previewKey)
        #if DEBUG
        // Screenshot/UI-test convenience: `-tab events` opens on that tab.
        if let i = args.firstIndex(of: "-tab"), i + 1 < args.count, let tab = AppTab(rawValue: args[i + 1]) { selectedTab = tab }
        #endif
    }

    func path(for tab: AppTab) -> Binding<NavigationPath> {
        Binding(get: { self.paths[tab] ?? NavigationPath() }, set: { self.paths[tab] = $0 })
    }

    // MARK: Lifecycle

    func start() async {
        if let snap = await cache.load(AppConfig.self, key: "config", scope: .public) { config = snap.value }
        if auth.client == nil { authState = .signedOut }
        listenForAuth()
        await refreshConfig()
    }

    func refreshConfig() async {
        do {
            let fresh = try await api.config()
            config = fresh
            await cache.save(fresh, key: "config", scope: .public)
        } catch {
            // Config is optional for rendering; the cached copy (or none) stands.
        }
        scheduleThemeRecheck()
    }

    private func scheduleThemeRecheck() {
        themeTimer?.cancel()
        now = Date()
        guard let next = HacklantaThemeWindow.nextTransition(edition: config?.hacklanta, after: now) else { return }
        let delay = max(1, next.timeIntervalSinceNow + 1)
        themeTimer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(min(delay, 6 * 3600)))
            guard !Task.isCancelled else { return }
            self?.scheduleThemeRecheck()
        }
    }

    private func listenForAuth() {
        guard authListener == nil, let stream = auth.authStateChanges else { return }
        authListener = Task { [weak self] in
            for await change in stream {
                guard let self else { return }
                switch change.event {
                case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                    if let session = change.session, !(change.event == .initialSession && session.isExpired && session.refreshToken.isEmpty) {
                        let wasSignedIn = self.authState == .signedIn
                        self.authState = .signedIn
                        if !wasSignedIn || self.me == nil { await self.didSignIn() }
                    } else {
                        self.authState = .signedOut
                    }
                case .signedOut, .userDeleted:
                    self.authState = .signedOut
                    self.me = nil
                default: break
                }
            }
        }
    }

    private func didSignIn() async {
        await refreshMe()
        await completeApplePostSignIn()
        await registerPushIfAuthorized()
    }

    func refreshMe() async {
        do {
            let fresh = try await api.me()
            me = fresh
            meError = nil
        } catch let e as APIError {
            meError = e
            if case .unauthenticated = e { await signOut() }
        } catch {}
    }

    // MARK: Sign in

    func signInWithApple(idToken: String, rawNonce: String, authorizationCode: String?, fullName: PersonNameComponents?) async {
        signInError = nil
        do {
            pendingAppleName = fullName
            pendingAppleCode = authorizationCode
            _ = try await auth.signInWithApple(idToken: idToken, rawNonce: rawNonce, authorizationCode: authorizationCode, fullName: fullName)
        } catch {
            pendingAppleName = nil
            pendingAppleCode = nil
            signInError = error.localizedDescription
        }
    }

    func signInWithGoogle() async {
        signInError = nil
        do {
            try await auth.signInWithGoogle()
        } catch AuthServiceError.cancelled {
        } catch {
            signInError = error.localizedDescription
        }
    }

    #if DEBUG
    func debugSignIn(email: String, password: String) async {
        signInError = nil
        do { try await auth.debugSignInWithPassword(email: email, password: password) }
        catch { signInError = error.localizedDescription }
    }
    #endif

    /// Apple shares the name only on first authorization; write it only where the profile is still blank
    /// so a later Apple sign-in can never clobber a name the member edited.
    private func completeApplePostSignIn() async {
        if let name = pendingAppleName, let me {
            var patch = ProfilePatch()
            if (me.firstName ?? "").isEmpty, let g = name.givenName, !g.isEmpty { patch.firstName = g }
            if (me.lastName ?? "").isEmpty, let f = name.familyName, !f.isEmpty { patch.lastName = f }
            if patch.firstName != nil || patch.lastName != nil {
                if let updated = try? await api.updateProfile(patch) { self.me = updated }
            }
        }
        pendingAppleName = nil
        if let code = pendingAppleCode {
            try? await api.sendAppleAuthorization(code: code)
            pendingAppleCode = nil
        }
    }

    func signOut() async {
        if let token = pushToken { try? await api.removeDevice(token: token) }
        await cache.purge(.user)
        await auth.signOut()
        me = nil
        authState = .signedOut
        paths = [:]
        selectedTab = .home
    }

    // MARK: Push

    func registerPushIfAuthorized() async {
        guard authState == .signedIn, let token = pushToken else { return }
        let aps = Bundle.main.object(forInfoDictionaryKey: "ProgsuAPSEnvironment") as? String ?? Self.apsEnvironment
        let reg = DeviceRegistration(token: token, env: aps == "production" ? "production" : "sandbox")
        try? await api.registerDevice(reg)
    }

    #if DEBUG
    static let apsEnvironment = "development"
    #else
    static let apsEnvironment = "production"
    #endif

    func didReceivePushToken(_ data: Data) {
        pushToken = data.map { String(format: "%02x", $0) }.joined()
        Task { await registerPushIfAuthorized() }
    }

    // MARK: Deep links

    func open(_ url: URL) {
        guard let link = DeepLink.parse(url, universalLinkHost: configuration.universalLinkHost) else { return }
        handle(link)
    }

    func handle(_ link: DeepLink) {
        switch link {
        case .authCallback(let url):
            auth.handle(url: url)
        case .event(let slug):
            selectedTab = .events
            var p = NavigationPath(); p.append(Route.event(slug: slug)); paths[.events] = p
        case .announcement(let id):
            selectedTab = .home
            var p = NavigationPath(); p.append(Route.announcementID(id)); paths[.home] = p
        case .hacklantaSession(let id):
            selectedTab = .hacklanta
            var p = NavigationPath(); p.append(Route.hacklantaSession(id)); paths[.hacklanta] = p
        case .myQR:
            selectedTab = .pass
        }
    }
}
