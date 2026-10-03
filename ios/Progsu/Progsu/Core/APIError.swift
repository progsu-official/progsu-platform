import Foundation

/// Typed error surface for the mobile API. Codes mirror the envelope contract in docs/ios/API.md.
enum APIError: Error, Equatable, Sendable {
    case unauthenticated(String)
    case forbidden(String)
    case notFound(String)
    case invalidInput(String)
    case conflict(String)
    case rateLimited(String, retryAfter: TimeInterval?)
    case notOnboarded(String)
    case featureOff(String)
    case unavailable(String)
    case server(code: String, message: String)
    case offline
    case timedOut
    case cancelled
    case decoding(String)
    case transport(String)

    /// Maps an envelope error code plus HTTP status to a case. Unknown codes fall back on status.
    static func from(code: String?, message: String?, status: Int, retryAfter: TimeInterval? = nil) -> APIError {
        // No envelope means the response did not come from the mobile API (proxy page, old deploy); say so plainly.
        let msg = (message?.isEmpty == false ? message! : "Progsu couldn't answer that request (HTTP \(status)).")
        switch code {
        case "unauthenticated": return .unauthenticated(msg)
        case "forbidden": return .forbidden(msg)
        case "not_found": return .notFound(msg)
        case "invalid_input": return .invalidInput(msg)
        case "conflict": return .conflict(msg)
        case "rate_limited": return .rateLimited(msg, retryAfter: retryAfter)
        case "not_onboarded": return .notOnboarded(msg)
        case "feature_off": return .featureOff(msg)
        case "unavailable": return .unavailable(msg)
        case "internal": return .server(code: "internal", message: msg)
        default:
            switch status {
            case 401: return .unauthenticated(msg)
            case 403: return .forbidden(msg)
            case 404: return .notFound(msg)
            case 400, 422: return .invalidInput(msg)
            case 409: return .conflict(msg)
            case 429: return .rateLimited(msg, retryAfter: retryAfter)
            case 503: return .unavailable(msg)
            default: return .server(code: code ?? "http_\(status)", message: msg)
            }
        }
    }

    /// Retrying is only safe for transient failures; 4xx outcomes are answers, not glitches.
    var isRetryable: Bool {
        switch self {
        case .timedOut, .transport: return true
        case .server(let code, _): return code == "internal" || code.hasPrefix("http_5")
        default: return false
        }
    }

    var userMessage: String {
        switch self {
        case .unauthenticated: return "Your session ended. Sign in again to continue."
        case .forbidden(let m), .notFound(let m), .invalidInput(let m), .conflict(let m), .unavailable(let m): return m
        case .rateLimited: return "Too many attempts. Wait a minute and try again."
        case .notOnboarded: return "Finish setting up your account to use this."
        case .featureOff: return "This isn't available right now."
        case .server: return "Something went wrong on our side. Try again in a moment."
        case .offline: return "You're offline. Connect to the internet and try again."
        case .timedOut: return "The request took too long. Check your connection and try again."
        case .cancelled: return "Cancelled."
        case .decoding: return "The app couldn't read the server's response. Update the app if this keeps happening."
        case .transport: return "Couldn't reach Progsu. Check your connection and try again."
        }
    }
}

extension APIError: LocalizedError {
    var errorDescription: String? { userMessage }
}
