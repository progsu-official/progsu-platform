import PassKit
import SwiftUI

struct EventDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    let slug: String
    @State private var state: Loadable<EventDetail> = .idle
    @State private var rsvpBusy = false
    @State private var actionError: String?
    @State private var showCalendar = false
    @State private var walletPass: PKPass?
    @State private var walletBusy = false
    @State private var wallet = WalletAvailability.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch state {
                case .idle, .loading: LoadingView(label: "Loading event")
                case .failed(let e, let cached, _):
                    if let cached { content(cached) } else {
                        if case .notFound = e {
                            StateMessage(title: "Event not found", message: "It may have been unpublished or the link is wrong.", systemImage: "calendar.badge.exclamationmark")
                        } else { StateMessage.error(e) { Task { await load() } } }
                    }
                case .loaded(let event, _): content(event)
                }
            }
            .padding(16)
        }
        .progsuScreen()
        .navigationTitle(state.value?.title ?? "Event")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showCalendar) {
            if let e = state.value {
                AddToCalendarSheet(title: e.title, start: e.startsAt, end: e.endsAt, location: e.locationText,
                                   notes: e.descriptionMd, url: URL(string: "https://\(model.configuration.universalLinkHost)/events/\(e.slug)"))
                    .ignoresSafeArea()
            }
        }
        .sheet(item: Binding(get: { walletPass.map(IdentifiedPass.init) }, set: { walletPass = $0?.pass })) { item in
            AddPassSheet(pass: item.pass).ignoresSafeArea()
        }
    }

    @ViewBuilder private func content(_ e: EventDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(e.title).font(.largeTitle.weight(.bold)).accessibilityAddTraits(.isHeader)
            Label(EventFormatting.dateLine(start: e.startsAt, end: e.endsAt, timeZone: e.timeZone), systemImage: "clock")
                .monospacedDigit()
            if let loc = e.locationText {
                if let u = e.locationUrl, let url = URL(string: u) { Link(destination: url) { Label(loc, systemImage: "mappin.and.ellipse") } }
                else { Label(loc, systemImage: "mappin.and.ellipse") }
            }
            if !e.hosts.isEmpty { Label("Hosted by " + e.hosts.map(\.displayName).joined(separator: ", "), systemImage: "person.crop.circle") }
            if let capacity = e.capacity {
                let going = e.goingCount
                Label("\(going) of \(capacity) going", systemImage: "person.2").monospacedDigit()
            } else {
                Label("\(e.goingCount) going", systemImage: "person.2").monospacedDigit()
            }
            if e.status == .cancelled {
                StatusPill(text: "Cancelled", systemImage: "xmark.circle", tone: .negative)
            }
            if let pts = e.viewer?.pointsAvailable, pts > 0 {
                Label("Check in to earn \(pts) points", systemImage: "star")
            }
        }
        .font(.subheadline)
        .foregroundStyle(theme.foreground)

        statusCard(e)

        if let d = e.descriptionMd, !d.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("About")
                Text((try? AttributedString(markdown: d, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(d))
                    .font(.body)
            }
            .glassCard()
        }
    }

    @ViewBuilder private func statusCard(_ e: EventDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.authState != .signedIn {
                Text("Sign in to RSVP and get your check-in code.").font(.subheadline)
                Button("Sign in") { model.selectedTab = .profile }.buttonStyle(PrimaryButtonStyle())
            } else {
                let rsvp = e.viewer?.rsvpStatus
                HStack {
                    if e.viewer?.checkedIn == true {
                        StatusPill(text: "Checked in", systemImage: "checkmark.seal.fill", tone: .positive)
                        if let p = e.viewer?.pointsEarned, p > 0 {
                            StatusPill(text: "+\(p) points", systemImage: "star.fill", tone: .accent)
                        }
                    } else if rsvp == .going {
                        StatusPill(text: "You're going", systemImage: "checkmark.circle.fill", tone: .positive)
                    } else if rsvp == .waitlisted {
                        StatusPill(text: "Waitlisted", systemImage: "hourglass", tone: .warning)
                    } else {
                        StatusPill(text: "Not RSVP'd", systemImage: "circle", tone: .neutral)
                    }
                }
                if e.viewer?.checkedIn != true {
                    if rsvp == .going || rsvp == .waitlisted {
                        Button(role: .destructive) { Task { await setRSVP(e, going: false) } } label: {
                            Text(rsvp == .going ? "Cancel my RSVP" : "Leave the waitlist")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(rsvpBusy)
                    } else if e.rsvpOpen() {
                        Button { Task { await setRSVP(e, going: true) } } label: {
                            if rsvpBusy { ProgressView() } else { Text("RSVP") }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(rsvpBusy)
                    } else {
                        Text("RSVPs are closed for this event.").font(.footnote).foregroundStyle(theme.mutedForeground)
                    }
                }
                if rsvp == .going && e.viewer?.checkedIn != true {
                    Button { model.selectedTab = .pass } label: { Label("Show my check-in code", systemImage: "qrcode") }
                        .buttonStyle(SecondaryButtonStyle())
                    if wallet.deviceSupported && !wallet.serverUnavailable {
                        Button { Task { await addToWallet(e) } } label: {
                            if walletBusy { ProgressView() } else { Label("Add to Apple Wallet", systemImage: "wallet.pass") }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(walletBusy)
                    }
                }
            }
            Button { showCalendar = true } label: { Label("Add to calendar", systemImage: "calendar.badge.plus") }
                .buttonStyle(SecondaryButtonStyle())
            if let actionError {
                Label(actionError, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(theme.destructive)
            }
        }
        .glassCard()
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do { state = .loaded(try await model.api.event(slug: slug)) }
        catch let e as APIError { if case .cancelled = e { return }; state = .failed(e, cached: state.value) }
        catch {}
    }

    private func setRSVP(_ e: EventDetail, going: Bool) async {
        rsvpBusy = true; actionError = nil
        defer { rsvpBusy = false }
        do {
            _ = try await model.api.rsvp(eventId: e.id, going: going)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await load()
        } catch let err as APIError {
            actionError = err.userMessage
        } catch {}
    }

    private func addToWallet(_ e: EventDetail) async {
        walletBusy = true; actionError = nil
        defer { walletBusy = false }
        do {
            let data = try await model.api.walletPass(eventId: e.id)
            walletPass = try PKPass(data: data)
        } catch APIError.unavailable(_) {
            wallet.serverUnavailable = true
        } catch let err as APIError {
            actionError = err.userMessage
        } catch {
            actionError = "That pass couldn't be opened."
        }
    }
}

private struct IdentifiedPass: Identifiable {
    let pass: PKPass
    var id: String { pass.serialNumber }
}
