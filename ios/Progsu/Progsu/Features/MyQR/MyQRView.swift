import SwiftUI
import UIKit

struct MyQRView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @Environment(\.scenePhase) private var scenePhase
    @State private var state: Loadable<CheckInPass> = .idle
    @State private var brightness = BrightnessBoost()

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if model.authState != .signedIn {
                    SignInPanel(title: "Your check-in code", message: "Sign in to get the personal code staff scan at the door.")
                } else {
                    switch state {
                    case .idle, .loading: LoadingView(label: "Loading your code")
                    case .failed(let e, let cached, let savedAt):
                        if let cached {
                            if let savedAt { LastUpdatedBanner(savedAt: savedAt) }
                            passCard(cached)
                        } else if case .notOnboarded = e {
                            StateMessage(title: "Finish setting up", message: "Complete onboarding to get your check-in code.", systemImage: "person.badge.clock")
                        } else {
                            StateMessage.error(e) { Task { await load() } }
                        }
                    case .loaded(let pass, _): passCard(pass)
                    }
                }
            }
            .padding(16)
        }
        .progsuScreen()
        .navigationTitle("My QR")
        .task(id: model.authState) { if model.authState == .signedIn { await load() } }
        .refreshable { await load() }
        .onAppear { if state.value != nil { brightness.boost() } }
        .onDisappear { brightness.restore() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, state.value != nil { brightness.boost() } else { brightness.restore() }
        }
        .onChange(of: model.selectedTab) { _, tab in if tab != .pass { brightness.restore() } }
    }

    private func passCard(_ pass: CheckInPass) -> some View {
        VStack(spacing: 16) {
            if let image = QRCode.image(for: pass.qrPayload) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 300)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel("Check-in QR code")
                    .accessibilityHint("Show this to event staff to check in.")
            } else {
                StateMessage(title: "Couldn't draw your code", message: "Use the short code below at the desk.", systemImage: "qrcode")
            }
            VStack(spacing: 4) {
                Eyebrow("Short code")
                Text(QRCode.formatShortCode(pass.shortCode))
                    .font(.system(.title, design: .monospaced).weight(.bold))
                    .monospacedDigit()
                    .textSelection(.enabled)
                    .accessibilityLabel("Short code \(QRCode.spokenShortCode(pass.shortCode))")
            }
            if let me = model.me {
                Text(me.nameForDisplay).font(.headline)
            }
            Text("Staff scan this at the door. It's personal — don't share screenshots.")
                .font(.footnote)
                .foregroundStyle(theme.mutedForeground)
                .multilineTextAlignment(.center)
        }
        .glassCard(padding: 20)
        .onAppear { brightness.boost() }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let pass = try await model.api.pass()
            state = .loaded(pass)
            await model.cache.save(pass, key: "pass", scope: .user)
        } catch let e as APIError {
            if case .cancelled = e { return }
            let snap = await model.cache.load(CheckInPass.self, key: "pass", scope: .user)
            state = .failed(e, cached: state.value ?? snap?.value, savedAt: snap?.savedAt)
        } catch {}
    }
}

/// Raises screen brightness while the code is visible and always restores the user's level.
@MainActor
final class BrightnessBoost {
    private var saved: CGFloat?

    private var screen: UIScreen? {
        (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.screen
    }

    func boost() {
        guard saved == nil, let screen else { return }
        saved = screen.brightness
        screen.brightness = max(screen.brightness, 0.9)
    }

    func restore() {
        guard let value = saved else { return }
        screen?.brightness = value
        saved = nil
    }
}
