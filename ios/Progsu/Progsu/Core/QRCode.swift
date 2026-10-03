import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

enum QRCode {
    /// Renders black-on-white modules with a 4-module quiet zone (ISO/IEC 18004 minimum), scaled with
    /// nearest-neighbour so module edges stay sharp for scanners.
    static func image(for payload: String, correction: String = "M", scale: Int = 12) -> UIImage? {
        guard let matrix = modules(for: payload, correction: correction) else { return nil }
        let quiet = 4
        let size = matrix.count + quiet * 2
        let px = size * scale
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: px, height: px), format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: px, height: px))
            UIColor.black.setFill()
            for (y, row) in matrix.enumerated() {
                for (x, on) in row.enumerated() where on {
                    ctx.fill(CGRect(x: (x + quiet) * scale, y: (y + quiet) * scale, width: scale, height: scale))
                }
            }
        }
    }

    /// Module matrix without CoreImage's built-in margin. `true` = dark module.
    static func modules(for payload: String, correction: String = "M") -> [[Bool]]? {
        guard !payload.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = correction
        guard let output = filter.outputImage else { return nil }
        let context = CIContext(options: [.useSoftwareRenderer: true])
        guard let cg = context.createCGImage(output, from: output.extent) else { return nil }
        let w = cg.width, h = cg.height
        var pixels = [UInt8](repeating: 0, count: w * h)
        guard let gray = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                   space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        gray.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var grid = (0..<h).map { y in (0..<w).map { x in pixels[y * w + x] < 128 } }
        // Strip CoreImage's own margin so the quiet zone is exactly what we draw.
        while let first = grid.first, !first.contains(true) { grid.removeFirst() }
        while let last = grid.last, !last.contains(true) { grid.removeLast() }
        while !grid.isEmpty, grid.allSatisfy({ $0.first == false }) { grid = grid.map { Array($0.dropFirst()) } }
        while !grid.isEmpty, grid.allSatisfy({ $0.last == false }) { grid = grid.map { Array($0.dropLast()) } }
        return grid.isEmpty ? nil : grid
    }

    /// "AB12CD34" -> "AB12 CD34" for reading aloud at a check-in desk.
    static func formatShortCode(_ code: String) -> String {
        let clean = code.uppercased().filter { $0.isLetter || $0.isNumber }
        var out = ""
        for (i, ch) in clean.enumerated() {
            if i > 0 && i % 4 == 0 { out.append(" ") }
            out.append(ch)
        }
        return out
    }

    /// Spelled-out version for VoiceOver ("A B 1 2 ...").
    static func spokenShortCode(_ code: String) -> String {
        code.uppercased().filter { $0.isLetter || $0.isNumber }.map(String.init).joined(separator: " ")
    }
}

/// Drops repeat reads of the same code within a window so one held-up QR doesn't fire N requests.
struct ScanDebouncer {
    var window: TimeInterval = 2.5
    private var last: (code: String, at: Date)?

    init(window: TimeInterval = 2.5) { self.window = window }

    mutating func shouldAccept(_ raw: String, now: Date = Date()) -> String? {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, code.count <= 512 else { return nil }
        if let last, last.code == code, now.timeIntervalSince(last.at) < window { return nil }
        last = (code, now)
        return code
    }
}
