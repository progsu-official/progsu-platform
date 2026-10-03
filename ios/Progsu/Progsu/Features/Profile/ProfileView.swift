import SwiftUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme

    var body: some View {
        List {
            if model.authState != .signedIn {
                Section { SignInPanel() }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                Section {
                    NavigationLink(value: Route.announcements) { Label("Announcements", systemImage: "megaphone") }
                    NavigationLink(value: Route.settings) { Label("Settings", systemImage: "gearshape") }
                }.listRowBackground(theme.glassFill)
            } else if let me = model.me {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(me.nameForDisplay).font(.title2.weight(.bold))
                        do { Text(me.email).font(.subheadline).foregroundStyle(theme.mutedForeground) }
                        do {
                            Text(affiliationText(me)).font(.subheadline).foregroundStyle(theme.mutedForeground)
                        }
                    }
                    .padding(.vertical, 4)
                }.listRowBackground(theme.glassFill)
                Section {
                    NavigationLink(value: Route.points) {
                        LabeledContent { Text("\(me.pointsBalance)").monospacedDigit() } label: { Label("Points", systemImage: "star") }
                    }
                    NavigationLink(value: Route.myEvents) { Label("My events", systemImage: "calendar") }
                    NavigationLink(value: Route.announcements) { Label("Announcements", systemImage: "megaphone") }
                    if me.affiliation != .nonstudent && !me.studentEmailVerified {
                        NavigationLink { StudentEmailView() } label: { Label("Verify school email", systemImage: "envelope.badge") }
                    }
                    if me.isStaff {
                        NavigationLink(value: Route.staff) { Label("Staff check-in", systemImage: "qrcode.viewfinder") }
                            .accessibilityIdentifier("staff-entry")
                    }
                    NavigationLink(value: Route.settings) { Label("Settings", systemImage: "gearshape") }
                }.listRowBackground(theme.glassFill)
                Section {
                    Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                }.listRowBackground(theme.glassFill)
            } else if let e = model.meError {
                StateMessage.error(e) { Task { await model.refreshMe() } }.listRowBackground(Color.clear)
            } else {
                LoadingView().listRowBackground(Color.clear)
            }
        }
        .progsuScreen()
        .navigationTitle("Profile")
        .refreshable { if model.authState == .signedIn { await model.refreshMe() } }
    }

    private func affiliationText(_ me: Me) -> String {
        let verified = me.studentEmailVerified ? " · school email verified" : ""
        switch me.affiliation {
        case .gsuStudent: return "Georgia State student" + verified
        case .otherStudent: return (me.school ?? "Student") + verified
        case .nonstudent: return "Community member"
        case .unknown: return "Affiliation not set"
        }
    }
}
