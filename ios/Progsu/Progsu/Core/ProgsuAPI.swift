import Foundation

/// Typed route wrappers over `APIClient`. Paths match docs/ios/API.md.
struct ProgsuAPI: Sendable {
    let client: APIClient

    private func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? s
    }

    func config() async throws -> AppConfig { try await client.get("config", auth: .none) }
    func me() async throws -> Me { try await client.get("me", auth: .required) }
    func updateProfile(_ patch: ProfilePatch) async throws -> Me {
        try await client.send(method: .patch, path: "me/profile", body: patch)
    }
    func acceptConsents(_ body: ConsentAcceptance) async throws -> ConsentResult {
        try await client.send(method: .post, path: "me/consents", body: body, idempotencyKey: UUID().uuidString)
    }
    func startStudentEmail(_ email: String) async throws -> StudentEmailStartResult {
        try await client.send(method: .post, path: "me/student-email/start", body: StudentEmailStart(studentEmail: email))
    }
    func verifyStudentEmail(_ email: String, code: String) async throws -> StudentEmailVerifyResult {
        try await client.send(method: .post, path: "me/student-email/verify", body: StudentEmailVerify(studentEmail: email, code: code))
    }
    func sendAppleAuthorization(code: String) async throws {
        let _: EmptyResponse = try await client.send(method: .post, path: "me/apple-authorization", body: AppleAuthorization(authorizationCode: code), idempotencyKey: UUID().uuidString)
    }
    func deleteAccount() async throws {
        let _: DeleteAccountResult = try await client.send(method: .post, path: "me/delete", body: DeleteAccountRequest(confirm: "DELETE"), idempotencyKey: UUID().uuidString)
    }

    func events(cursor: String? = nil, query: String? = nil, limit: Int = 20) async throws -> Page<EventSummary> {
        var q = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { q.append(.init(name: "cursor", value: cursor)) }
        if let query, !query.isEmpty { q.append(.init(name: "q", value: query)) }
        return try await client.get("events", query: q)
    }
    func event(slug: String) async throws -> EventDetail { try await client.get("events/\(enc(slug))") }
    func rsvp(eventId: String, going: Bool) async throws -> RSVPResult {
        try await client.send(method: .post, path: "events/\(enc(eventId))/rsvp", body: RSVPRequest(desired: going ? "going" : "cancelled"), idempotencyKey: UUID().uuidString)
    }
    func myEvents() async throws -> ItemList<MyEvent> { try await client.get("me/events", auth: .required) }
    func pass() async throws -> CheckInPass { try await client.get("me/pass", auth: .required) }
    func walletPass(eventId: String) async throws -> Data {
        try await client.download("me/events/\(enc(eventId))/wallet", accept: "application/vnd.apple.pkpass")
    }
    func points(cursor: String? = nil) async throws -> PointsSummary {
        try await client.get("me/points", query: cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [], auth: .required)
    }
    func announcements(cursor: String? = nil) async throws -> Page<Announcement> {
        try await client.get("announcements", query: cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [])
    }
    func markAnnouncementRead(_ id: String) async throws {
        let _: EmptyResponse = try await client.send(method: .post, path: "announcements/\(enc(id))/read", body: Optional<String>.none)
    }
    func registerDevice(_ reg: DeviceRegistration) async throws {
        let _: EmptyResponse = try await client.send(method: .post, path: "devices", body: reg, idempotencyKey: reg.token)
    }
    func removeDevice(token: String) async throws {
        let _: EmptyResponse = try await client.send(method: .delete, path: "devices/\(enc(token))", body: Optional<String>.none)
    }

    func hacklanta() async throws -> HacklantaGuide { try await client.get("hacklanta", auth: .none) }
    func bookmarks() async throws -> HacklantaBookmarks { try await client.get("hacklanta/bookmarks", auth: .required) }
    func setBookmark(sessionId: String, on: Bool) async throws {
        let _: EmptyResponse = try await client.send(method: on ? .put : .delete, path: "hacklanta/bookmarks/\(enc(sessionId))", body: Optional<String>.none)
    }
    func hacklantaMe() async throws -> HacklantaMe { try await client.get("hacklanta/me", auth: .required) }
    func startHacklantaLink(email: String) async throws {
        let _: EmptyResponse = try await client.send(method: .post, path: "hacklanta/link/start", body: HacklantaLinkStart(email: email))
    }
    func verifyHacklantaLink(code: String) async throws {
        let _: EmptyResponse = try await client.send(method: .post, path: "hacklanta/link/verify", body: HacklantaLinkVerify(code: code))
    }

    func staffEvents() async throws -> [StaffEvent] {
        let list: ItemList<StaffEvent> = try await client.get("staff/events", auth: .required)
        return list.items
    }
    func scan(eventId: String, code: String) async throws -> ScanResponse {
        try await client.send(method: .post, path: "staff/events/\(enc(eventId))/scan", body: ScanRequest(code: code), idempotencyKey: UUID().uuidString)
    }
    func roster(eventId: String, query: String) async throws -> [RosterEntry] {
        let list: ItemList<RosterEntry> = try await client.get("staff/events/\(enc(eventId))/roster", query: query.isEmpty ? [] : [URLQueryItem(name: "q", value: query)], auth: .required)
        return list.items
    }
    func manualCheckIn(eventId: String, userId: String, reason: String) async throws -> ScanResponse {
        try await client.send(method: .post, path: "staff/events/\(enc(eventId))/manual-checkin", body: ManualCheckInRequest(userId: userId, reason: reason), idempotencyKey: UUID().uuidString)
    }
}
