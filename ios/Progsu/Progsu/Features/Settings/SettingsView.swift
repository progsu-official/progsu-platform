import SwiftUI
import UserNotifications

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var showDelete = false

    var body: some View {
        List {
            Section {
                switch notificationStatus {
                case .authorized, .provisional, .ephemeral:
                    Label("Notifications are on", systemImage: "bell.badge")
                    Text("Event reminders and announcements arrive on this device. Change which alerts you get in iOS Settings.")
                        .font(.footnote).foregroundStyle(theme.mutedForeground)
                case .denied:
                    Label("Notifications are off", systemImage: "bell.slash")
                    Button("Open iOS Settings") { if let u = URL(string: UIApplication.openSettingsURLString) { openURL(u) } }
                default:
                    Text("Get reminders before events you RSVP'd to and important announcements.")
                        .font(.subheadline)
                    Button("Turn on notifications") { Task { await requestPush() } }
                }
            } header: { Text("Notifications") }
            .listRowBackground(theme.glassFill)

            Section("Appearance") {
                @Bindable var model = model
                Toggle("Preview Hacklanta mode", isOn: $model.hacklantaPreview)
            }.listRowBackground(theme.glassFill)

            Section("About") {
                Link("Privacy policy", destination: URL(string: "https://\(model.configuration.universalLinkHost)/privacy")!)
                Link("Terms", destination: URL(string: "https://\(model.configuration.universalLinkHost)/terms")!)
                LabeledContent("Version", value: "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"))")
            }.listRowBackground(theme.glassFill)

            if model.authState == .signedIn {
                Section {
                    Button("Delete my account", role: .destructive) { showDelete = true }
                } footer: {
                    Text("Permanently deletes your Progsu account and personal data.")
                }.listRowBackground(theme.glassFill)
            }
        }
        .progsuScreen()
        .navigationTitle("Settings")
        .task { await refreshStatus() }
        .sheet(isPresented: $showDelete) { DeleteAccountView() }
    }

    private func refreshStatus() async {
        notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func requestPush() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() }
        await refreshStatus()
    }
}

struct DeleteAccountView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section("What happens") {
                    Label("Your profile, RSVPs, check-in history and points are deleted.", systemImage: "trash")
                    Label("Your check-in code stops working immediately.", systemImage: "qrcode")
                    Label("If you signed in with Apple, we revoke Progsu's access to your Apple ID.", systemImage: "apple.logo")
                    Label("This can't be undone. Audit log entries remain, with your profile detached.", systemImage: "exclamationmark.triangle")
                }
                Section("Type DELETE to confirm") {
                    TextField("DELETE", text: $typed).textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .focused($fieldFocused)
                        .submitLabel(.done)
                        .onSubmit { fieldFocused = false }
                        .accessibilityIdentifier("delete-confirm-field")
                }
                Section {
                    Button { Task { await delete() } } label: { if busy { ProgressView() } else { Text("Delete my account") } }
                        .buttonStyle(PrimaryButtonStyle(destructive: true))
                        .disabled(typed != "DELETE" || busy)
                    if let error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(theme.destructive).font(.footnote) }
                }.listRowBackground(Color.clear)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: typed) { _, new in if new == "DELETE" { fieldFocused = false } }
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func delete() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await model.api.deleteAccount()
            dismiss()
            await model.signOut()
        } catch let e as APIError { error = e.userMessage } catch {}
    }
}
