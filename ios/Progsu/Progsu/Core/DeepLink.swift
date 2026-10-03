import Foundation

enum DeepLink: Equatable, Sendable {
    case event(slug: String)
    case announcement(id: String)
    case hacklantaSession(id: String)
    case myQR
    case authCallback(URL)

    /// Accepts `progsu://event/<slug>`, `progsu://announcement/<id>`, `progsu://hacklanta/session/<id>`,
    /// `progsu://pass`, `progsu://auth-callback?...`, and universal links on the members host mirroring web routes.
    static func parse(_ url: URL, universalLinkHost: String = AppConfiguration.current.universalLinkHost) -> DeepLink? {
        let parts: [String]
        let isCustomScheme = url.scheme?.lowercased() == "progsu"
        if url.scheme?.lowercased() == "progsu" {
            guard let host = url.host?.lowercased() else { return nil }
            if host == "auth-callback" { return .authCallback(url) }
            parts = [host] + url.pathComponents.filter { $0 != "/" }
        } else if ["https"].contains(url.scheme?.lowercased() ?? ""), url.host?.lowercased() == universalLinkHost.lowercased() {
            parts = url.pathComponents.filter { $0 != "/" }
        } else {
            return nil
        }
        let safe = parts.map { $0.removingPercentEncoding ?? $0 }
        guard let first = safe.first?.lowercased() else { return nil }
        func valid(_ s: String) -> Bool {
            !s.isEmpty && s.count <= 200 && s.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        }
        switch (first, safe.count) {
        case ("event", 2), ("events", 2):
            return valid(safe[1]) ? .event(slug: safe[1]) : nil
        case ("announcement", 2), ("announcements", 2):
            return valid(safe[1]) ? .announcement(id: safe[1]) : nil
        case ("hacklanta", 3) where ["session", "sessions"].contains(safe[1].lowercased()):
            return valid(safe[2]) ? .hacklantaSession(id: safe[2]) : nil
        // Custom scheme only: the AASA claims /events/*, /announcements/*, /hacklanta/sessions/*, never /checkin.
        case ("pass", 1) where isCustomScheme, ("checkin", 1) where isCustomScheme:
            return .myQR
        default:
            return nil
        }
    }
}
