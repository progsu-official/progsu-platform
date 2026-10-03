import Foundation

struct APIEnvelopeError: Decodable, Sendable {
    let code: String
    let message: String
    let field: String?
    let retryAfterMs: Double?
}

private struct ErrorEnvelope: Decodable {
    let ok: Bool
    let error: APIEnvelopeError?
    let requestId: String?
}

private struct DataEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T
}

struct EmptyResponse: Decodable, Sendable {}

enum HTTPMethod: String, Sendable { case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE" }

/// Supplies the bearer token. `forceRefresh` is set after a 401 so a stale token gets one refresh attempt.
typealias AccessTokenProvider = @Sendable (_ forceRefresh: Bool) async -> String?

/// Single entry point for the mobile API. Decodes the `{ok,data}` envelope, maps error codes,
/// applies timeouts, and retries transient failures for idempotent requests only.
actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let tokenProvider: AccessTokenProvider
    private let maxRetries: Int
    private let decoder = JSONCoding.decoder()
    private let encoder = JSONCoding.encoder()

    init(baseURL: URL, session: URLSession? = nil, maxRetries: Int = 2, tokenProvider: @escaping AccessTokenProvider) {
        self.baseURL = baseURL
        self.maxRetries = maxRetries
        self.tokenProvider = tokenProvider
        if let session {
            self.session = session
        } else {
            let cfg = URLSessionConfiguration.default
            cfg.timeoutIntervalForRequest = 20
            cfg.timeoutIntervalForResource = 60
            cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
            cfg.urlCache = nil
            cfg.waitsForConnectivity = false
            self.session = URLSession(configuration: cfg)
        }
    }

    func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = [], auth: AuthRequirement = .optional) async throws -> T {
        try await send(method: .get, path: path, query: query, body: Optional<String>.none, auth: auth, idempotencyKey: nil)
    }

    func send<T: Decodable & Sendable, B: Encodable & Sendable>(
        method: HTTPMethod,
        path: String,
        query: [URLQueryItem] = [],
        body: B?,
        auth: AuthRequirement = .required,
        idempotencyKey: String? = nil
    ) async throws -> T {
        let data = try await raw(method: method, path: path, query: query, body: body, auth: auth, idempotencyKey: idempotencyKey, accept: "application/json").0
        do {
            if T.self == EmptyResponse.self, let empty = EmptyResponse() as? T { return empty }
            return try decoder.decode(DataEnvelope<T>.self, from: data).data
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// Returns raw bytes for non-JSON payloads such as `.pkpass`.
    func download(_ path: String, accept: String) async throws -> Data {
        try await raw(method: .get, path: path, query: [], body: Optional<String>.none, auth: .required, idempotencyKey: nil, accept: accept).0
    }

    enum AuthRequirement: Sendable { case none, optional, required }

    private func raw<B: Encodable & Sendable>(
        method: HTTPMethod, path: String, query: [URLQueryItem], body: B?,
        auth: AuthRequirement, idempotencyKey: String?, accept: String
    ) async throws -> (Data, HTTPURLResponse) {
        let canRetry = method == .get || method == .delete || method == .put || idempotencyKey != nil
        var attempt = 0
        var forceRefresh = false
        while true {
            try Task.checkCancellation()
            var request = try buildRequest(method: method, path: path, query: query, body: body, idempotencyKey: idempotencyKey, accept: accept)
            if auth != .none, let token = await tokenProvider(forceRefresh) {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            } else if auth == .required {
                throw APIError.unauthenticated("Sign in to continue.")
            }
            do {
                let (data, response) = try await perform(request)
                if (200..<300).contains(response.statusCode) { return (data, response) }
                let env = try? decoder.decode(ErrorEnvelope.self, from: data)
                let retryAfter = env?.error?.retryAfterMs.map { $0 / 1000 }
                    ?? response.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
                let error = APIError.from(code: env?.error?.code, message: env?.error?.message, status: response.statusCode, retryAfter: retryAfter)
                if case .unauthenticated = error, auth != .none, !forceRefresh {
                    forceRefresh = true
                    continue
                }
                throw error
            } catch let error as APIError {
                guard canRetry, error.isRetryable, attempt < maxRetries else { throw error }
                attempt += 1
                try await Task.sleep(for: .milliseconds(Self.backoffMillis(attempt: attempt)))
            }
        }
    }

    static func backoffMillis(attempt: Int) -> Int {
        let base = 400 * Int(pow(2.0, Double(attempt - 1)))
        return base + Int.random(in: 0...200)
    }

    private func buildRequest<B: Encodable>(method: HTTPMethod, path: String, query: [URLQueryItem], body: B?, idempotencyKey: String?, accept: String) throws -> URLRequest {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw APIError.invalidInput("Bad request path.") }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue(accept, forHTTPHeaderField: "Accept")
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.transport("No HTTP response") }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch is CancellationError {
            throw APIError.cancelled
        } catch let error as URLError {
            switch error.code {
            case .cancelled: throw APIError.cancelled
            case .timedOut: throw APIError.timedOut
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                throw APIError.offline
            default: throw APIError.transport(error.localizedDescription)
            }
        }
    }
}
