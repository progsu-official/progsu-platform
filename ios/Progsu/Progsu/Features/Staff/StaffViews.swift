import AVFoundation
import SwiftUI

struct StaffHomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var state: Loadable<[StaffEvent]> = .idle

    var body: some View {
        List {
            switch state {
            case .idle, .loading: LoadingView().listRowBackground(Color.clear)
            case .failed(let e, _, _): StateMessage.error(e) { Task { await load() } }.listRowBackground(Color.clear)
            case .loaded(let events, _):
                if events.isEmpty {
                    StateMessage(title: "No assignments", message: "Events you're assigned to staff will appear here.", systemImage: "person.badge.key")
                        .listRowBackground(Color.clear)
                }
                ForEach(events) { e in
                    NavigationLink(value: Route.staffEvent(e)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(e.title).font(.headline)
                            Text(EventFormatting.dateLine(start: e.startsAt, end: e.endsAt, timeZone: TimeZone.current.identifier) + " · \(e.checkedInCount)/\(e.goingCount) in")
                                .font(.subheadline).monospacedDigit().foregroundStyle(theme.mutedForeground)
                        }
                    }
                }.listRowBackground(theme.glassFill)
            }
        }
        .progsuScreen()
        .navigationTitle("Staff")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do { state = .loaded(try await model.api.staffEvents()) }
        catch let e as APIError { if case .cancelled = e { return }; state = .failed(e) } catch {}
    }
}

struct StaffEventView: View {
    enum Mode: String, CaseIterable, Identifiable { case scan = "Scan", roster = "Roster"; var id: String { rawValue } }
    let event: StaffEvent
    @State private var mode: Mode = .scan

    var body: some View {
        VStack(spacing: 0) {
            Picker("Mode", selection: $mode) { ForEach(Mode.allCases) { Text($0.rawValue).tag($0) } }
                .pickerStyle(.segmented).padding(16)
            switch mode {
            case .scan: ScanPane(event: event)
            case .roster: RosterPane(event: event)
            }
        }
        .progsuScreen()
        .navigationTitle(event.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ScanPane: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    let event: StaffEvent
    @State private var torch = false
    @State private var debouncer = ScanDebouncer()
    @State private var inFlight = false
    @State private var last: ScanResponse?
    @State private var error: String?
    @State private var cameraStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var manualCode = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                camera
                resultCard
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Enter short code")
                    HStack {
                        TextField("ABCD 1234", text: $manualCode)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .font(.body.monospaced())
                            .frame(minHeight: 44)
                        Button("Check") { submit(manualCode.filter { $0.isLetter || $0.isNumber }) }
                            .disabled(manualCode.isEmpty || inFlight)
                    }
                }
                .glassCard()
            }
            .padding(.horizontal, 16)
        }
        .task {
            if cameraStatus == .notDetermined {
                _ = await AVCaptureDevice.requestAccess(for: .video)
                cameraStatus = AVCaptureDevice.authorizationStatus(for: .video)
            }
        }
    }

    @ViewBuilder private var camera: some View {
        if cameraStatus == .authorized, AVCaptureDevice.default(for: .video) != nil {
            ZStack(alignment: .bottomTrailing) {
                QRScannerView(torchOn: torch) { code in
                    if let accepted = debouncer.shouldAccept(code), !inFlight { submit(accepted) }
                }
                .frame(height: 320)
                .clipShape(RoundedRectangle(cornerRadius: ProgsuTheme.radius))
                .accessibilityLabel("Camera viewfinder. Point at an attendee's QR code.")
                Button { torch.toggle() } label: {
                    Image(systemName: torch ? "flashlight.on.fill" : "flashlight.off.fill")
                        .frame(width: 48, height: 48)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel(torch ? "Turn flashlight off" : "Turn flashlight on")
                .padding(12)
            }
        } else if cameraStatus == .denied || cameraStatus == .restricted {
            StateMessage(title: "Camera access is off", message: "Allow camera access in iOS Settings to scan codes, or type the short code below.", systemImage: "camera.fill")
                .glassCard()
        } else {
            StateMessage(title: "No camera available", message: "Type the attendee's short code below.", systemImage: "camera")
                .glassCard()
        }
    }

    @ViewBuilder private var resultCard: some View {
        if inFlight {
            ProgressView("Checking").frame(maxWidth: .infinity).glassCard()
        } else if let last {
            VStack(alignment: .leading, spacing: 6) {
                StatusPill(text: last.result.title, systemImage: last.result.systemImage, tone: last.result.tone)
                if let name = last.attendee?.displayName { Text(name).font(.title2.weight(.bold)) }
                Text(last.result.detail).font(.subheadline)
                if last.pointsAwarded > 0 { let p = last.pointsAwarded; Text("+\(p) points awarded").monospacedDigit().foregroundStyle(theme.success) }
            }
            .glassCard()
            .accessibilityElement(children: .combine)
        } else if let error {
            Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(theme.destructive).glassCard()
        }
    }

    private func submit(_ code: String) {
        guard !code.isEmpty else { return }
        inFlight = true; error = nil
        Task {
            defer { inFlight = false }
            do {
                let r = try await model.api.scan(eventId: event.id, code: code)
                last = r
                manualCode = ""
                let gen = UINotificationFeedbackGenerator()
                gen.notificationOccurred(r.result == .checkedIn ? .success : (r.result.tone == .negative ? .error : .warning))
                UIAccessibility.post(notification: .announcement, argument: "\(r.result.title). \(r.attendee?.displayName ?? "")")
            } catch let e as APIError {
                last = nil; error = e.userMessage
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            } catch {}
        }
    }
}

struct RosterPane: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    let event: StaffEvent
    @State private var query = ""
    @State private var state: Loadable<[RosterEntry]> = .idle
    @State private var manualTarget: RosterEntry?

    var body: some View {
        List {
            switch state {
            case .idle, .loading: LoadingView().listRowBackground(Color.clear)
            case .failed(let e, _, _): StateMessage.error(e) { Task { await load() } }.listRowBackground(Color.clear)
            case .loaded(let rows, _):
                if rows.isEmpty { Text(query.isEmpty ? "No one on the roster yet." : "No matches.").foregroundStyle(theme.mutedForeground) }
                ForEach(rows) { r in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(r.displayName).font(.headline)
                            Text(r.rsvpStatus == .going ? "RSVP'd" : "No RSVP").font(.caption).foregroundStyle(theme.mutedForeground)
                        }
                        Spacer()
                        if r.checkedIn {
                            StatusPill(text: "In", systemImage: "checkmark.circle.fill", tone: .positive)
                        } else {
                            Button("Check in") { manualTarget = r }.buttonStyle(.bordered)
                        }
                    }
                    .frame(minHeight: 44)
                }
            }
        }
        .listRowBackground(theme.glassFill)
        .scrollContentBackground(.hidden)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search roster")
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await load()
        }
        .refreshable { await load() }
        .sheet(item: $manualTarget) { r in ManualCheckInSheet(event: event, entry: r) { Task { await load() } } }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do { state = .loaded(try await model.api.roster(eventId: event.id, query: query)) }
        catch let e as APIError { if case .cancelled = e { return }; state = .failed(e) } catch {}
    }
}

struct ManualCheckInSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let event: StaffEvent
    let entry: RosterEntry
    let onDone: () -> Void
    @State private var reason = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { Text("Check in \(entry.displayName) without a scan. The reason is recorded in the audit log.") }
                Section("Reason") {
                    TextField("e.g. Phone died, verified ID", text: $reason, axis: .vertical).lineLimit(2...4)
                }
                if let error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(theme.destructive) }
            }
            .navigationTitle("Manual check-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Check in") { Task { await submit() } }.disabled(reason.trimmed.count < 3 || busy)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func submit() async {
        busy = true; defer { busy = false }
        do {
            _ = try await model.api.manualCheckIn(eventId: event.id, userId: entry.userId, reason: reason.trimmed)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onDone(); dismiss()
        } catch let e as APIError { error = e.userMessage } catch {}
    }
}
