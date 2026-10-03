import AuthenticationServices
import SwiftUI

struct SignInPanel: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @Environment(\.colorScheme) private var scheme
    @State private var rawNonce = ""
    @State private var busy = false
    var title = "Sign in to Progsu"
    var message = "Members can RSVP, carry their check-in code, and track points."

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.weight(.bold))
            Text(message).font(.subheadline).foregroundStyle(theme.mutedForeground)
            if !model.configuration.isAuthConfigured {
                StatusPill(text: "Sign-in isn't configured in this build", systemImage: "exclamationmark.triangle", tone: .warning)
            }
            SignInWithAppleButton(.signIn) { request in
                rawNonce = Nonce.random()
                request.requestedScopes = [.fullName, .email]
                request.nonce = Nonce.sha256(rawNonce)
            } onCompletion: { result in
                switch result {
                case .success(let authorization):
                    guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
                          let tokenData = cred.identityToken, let token = String(data: tokenData, encoding: .utf8) else {
                        model.signInError = AuthServiceError.missingIdentityToken.localizedDescription
                        return
                    }
                    let code = cred.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
                    let nonce = rawNonce
                    busy = true
                    Task {
                        await model.signInWithApple(idToken: token, rawNonce: nonce, authorizationCode: code, fullName: cred.fullName)
                        busy = false
                    }
                case .failure(let error):
                    if (error as? ASAuthorizationError)?.code != .canceled {
                        model.signInError = error.localizedDescription
                    }
                }
            }
            .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
            .frame(height: 48)
            .clipShape(RoundedRectangle(cornerRadius: ProgsuTheme.radius, style: .continuous))
            .disabled(busy || !model.configuration.isAuthConfigured)

            Button {
                busy = true
                Task { await model.signInWithGoogle(); busy = false }
            } label: {
                Label("Sign in with Google", systemImage: "globe")
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(busy || !model.configuration.isAuthConfigured)

            if busy { ProgressView("Signing in").font(.footnote) }
            if let err = model.signInError {
                Label(err, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(theme.destructive)
            }
        }
        .glassCard()
    }
}
