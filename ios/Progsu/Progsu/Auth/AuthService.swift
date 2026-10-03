import AuthenticationServices
import Foundation
import Supabase

enum AuthServiceError: Error, LocalizedError {
    case notConfigured
    case missingIdentityToken
    case cancelled

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Sign-in isn't configured in this build."
        case .missingIdentityToken: return "Apple didn't return a sign-in token. Try again."
        case .cancelled: return "Sign-in was cancelled."
        }
    }
}

/// Owns the Supabase auth client. Sessions persist via supabase-swift's default
/// `KeychainLocalStorage` (verified in AuthLocalStorage.swift of the pinned package).
actor AuthService {
    let client: SupabaseClient?

    init(configuration: AppConfiguration = .current) {
        if let url = configuration.supabaseURL, !configuration.supabaseAnonKey.isEmpty {
            client = SupabaseClient(
                supabaseURL: url,
                supabaseKey: configuration.supabaseAnonKey,
                options: SupabaseClientOptions(auth: .init(
                    storage: KeychainLocalStorage(service: "com.progsu.app.auth"),
                    redirectToURL: AppConfiguration.authCallbackURL,
                    flowType: .pkce,
                    emitLocalSessionAsInitialSession: true
                ))
            )
        } else {
            client = nil
        }
    }

    nonisolated var authStateChanges: AsyncStream<(event: AuthChangeEvent, session: Session?)>? {
        client?.auth.authStateChanges
    }

    nonisolated var hasStoredSession: Bool {
        guard let s = client?.auth.currentSession else { return false }
        return !s.isExpired || !s.refreshToken.isEmpty
    }

    func accessToken(forceRefresh: Bool) async -> String? {
        guard let auth = client?.auth else { return nil }
        do {
            if forceRefresh { return try await auth.refreshSession().accessToken }
            return try await auth.session.accessToken
        } catch {
            return nil
        }
    }

    struct AppleSignInOutcome: Sendable {
        let authorizationCode: String?
        let givenName: String?
        let familyName: String?
    }

    /// Exchanges an Apple ID token for a Supabase session. Name and authorization code are returned to the
    /// caller because only the first authorization carries a name, and the code must reach the server
    /// (POST /me/apple-authorization) so account deletion can revoke the Apple grant.
    func signInWithApple(idToken: String, rawNonce: String, authorizationCode: String?, fullName: PersonNameComponents?) async throws -> AppleSignInOutcome {
        guard let auth = client?.auth else { throw AuthServiceError.notConfigured }
        _ = try await auth.signInWithIdToken(credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: rawNonce))
        return AppleSignInOutcome(authorizationCode: authorizationCode, givenName: fullName?.givenName, familyName: fullName?.familyName)
    }

    func signInWithGoogle() async throws {
        guard let auth = client?.auth else { throw AuthServiceError.notConfigured }
        do {
            try await auth.signInWithOAuth(provider: .google, redirectTo: AppConfiguration.authCallbackURL) { session in
                session.prefersEphemeralWebBrowserSession = false
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            throw AuthServiceError.cancelled
        }
    }

    /// Handles progsu://auth-callback if it arrives via `onOpenURL` rather than the web auth session.
    nonisolated func handle(url: URL) {
        client?.auth.handle(url)
    }

    func signOut() async {
        try? await client?.auth.signOut(scope: .local)
    }
}
