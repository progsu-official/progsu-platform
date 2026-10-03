import EventKit
import EventKitUI
import PassKit
import SwiftUI

/// Presents the system event editor. iOS 17 runs this out of process, so no calendar access is requested;
/// the user decides whether to save.
struct AddToCalendarSheet: UIViewControllerRepresentable {
    let title: String
    let start: Date
    let end: Date?
    let location: String?
    let notes: String?
    let url: URL?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = start
        event.endDate = end ?? start.addingTimeInterval(3600)
        event.location = location
        event.notes = notes
        event.url = url
        let vc = EKEventEditViewController()
        vc.eventStore = store
        vc.event = event
        vc.editViewDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: EKEventEditViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let dismiss: DismissAction
        init(dismiss: DismissAction) { self.dismiss = dismiss }
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            dismiss()
        }
    }
}

struct AddPassSheet: UIViewControllerRepresentable {
    let pass: PKPass
    func makeUIViewController(context: Context) -> UIViewController {
        PKAddPassesViewController(pass: pass) ?? UIViewController()
    }
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

/// Tracks whether Wallet passes are offered for this build/server. A 503 `unavailable` hides the button
/// for the rest of the session instead of showing an error every time.
@MainActor
@Observable
final class WalletAvailability {
    static let shared = WalletAvailability()
    var serverUnavailable = false
    var deviceSupported: Bool { PKAddPassesViewController.canAddPasses() }
}
