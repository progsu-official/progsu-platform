@preconcurrency import AVFoundation
import SwiftUI
import UIKit

/// Camera preview + QR metadata detection. Calls `onCode` on the main actor for every read;
/// the caller debounces.
struct QRScannerView: UIViewRepresentable {
    let torchOn: Bool
    let onCode: @MainActor (String) -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        context.coordinator.configure(view)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        context.coordinator.setTorch(torchOn)
    }

    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        private let session = AVCaptureSession()
        private let queue = DispatchQueue(label: "progsu.scanner")
        private let onCode: @MainActor (String) -> Void
        private var device: AVCaptureDevice?

        init(onCode: @escaping @MainActor (String) -> Void) { self.onCode = onCode }

        func configure(_ view: PreviewView) {
            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill
            queue.async { [self] in
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                      let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { return }
                self.device = device
                session.beginConfiguration()
                session.addInput(input)
                let output = AVCaptureMetadataOutput()
                if session.canAddOutput(output) {
                    session.addOutput(output)
                    output.setMetadataObjectsDelegate(self, queue: .main)
                    output.metadataObjectTypes = [.qr]
                }
                session.commitConfiguration()
                session.startRunning()
            }
        }

        func setTorch(_ on: Bool) {
            queue.async { [self] in
                guard let device, device.hasTorch, (try? device.lockForConfiguration()) != nil else { return }
                device.torchMode = on ? .on : .off
                device.unlockForConfiguration()
            }
        }

        func stop() {
            queue.async { [self] in
                setTorch(false)
                session.stopRunning()
            }
        }

        nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject, let value = obj.stringValue else { return }
            MainActor.assumeIsolated { onCode(value) }
        }
    }
}

extension ScanResult {
    var title: String {
        switch self {
        case .checkedIn: "Checked in"
        case .alreadyCheckedIn: "Already checked in"
        case .wrongEvent: "Different event"
        case .revoked: "Code revoked"
        case .notRsvpd: "No RSVP"
        case .outsideWindow: "Check-in not open"
        case .invalidCode: "Not a Progsu code"
        }
    }
    var detail: String {
        switch self {
        case .checkedIn: "Welcome them in."
        case .alreadyCheckedIn: "This person was already checked in. No points were added."
        case .wrongEvent: "This code is for a different event."
        case .revoked: "This code was revoked. Ask them to refresh My QR in the app."
        case .notRsvpd: "They haven't RSVP'd. Use manual check-in if you're admitting them."
        case .outsideWindow: "This event isn't in its check-in window."
        case .invalidCode: "The code couldn't be read as a Progsu pass."
        }
    }
    var systemImage: String {
        switch self {
        case .checkedIn: "checkmark.circle.fill"
        case .alreadyCheckedIn: "checkmark.circle"
        case .wrongEvent, .outsideWindow: "clock.badge.exclamationmark"
        case .revoked, .invalidCode: "xmark.octagon.fill"
        case .notRsvpd: "person.crop.circle.badge.questionmark"
        }
    }
    var tone: StatusPill.Tone {
        switch self {
        case .checkedIn: .positive
        case .alreadyCheckedIn, .notRsvpd, .wrongEvent, .outsideWindow: .warning
        case .revoked, .invalidCode: .negative
        }
    }
}
