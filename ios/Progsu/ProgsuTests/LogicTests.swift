import XCTest
@testable import Progsu

final class NonceTests: XCTestCase {
    func testSHA256KnownVector() {
        XCTAssertEqual(Nonce.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
    func testRandomNonce() {
        let a = Nonce.random(), b = Nonce.random()
        XCTAssertEqual(a.count, 32)
        XCTAssertNotEqual(a, b)
        XCTAssertTrue(a.allSatisfy { Nonce.charset.contains($0) })
    }
}

final class ThemeWindowTests: XCTestCase {
    func edition(_ start: String, _ end: String, tz: String = "America/New_York", override: ThemeOverride = .auto) -> HacklantaEditionSummary {
        HacklantaEditionSummary(slug: "h", name: "H", startsAt: JSONCoding.parseISO8601(start)!, endsAt: JSONCoding.parseISO8601(end)!, timeZone: tz, themeOverride: override, themeActive: false, scheduleTentative: false)
    }
    let d = { (s: String) in JSONCoding.parseISO8601(s)! }

    func testAutoWindowIsHalfOpen() {
        let e = edition("2026-10-09T19:00:00Z", "2026-10-11T22:00:00Z")
        XCTAssertFalse(HacklantaThemeWindow.isActive(edition: e, now: d("2026-10-09T18:59:59Z"), manualPreview: false))
        XCTAssertTrue(HacklantaThemeWindow.isActive(edition: e, now: d("2026-10-09T19:00:00Z"), manualPreview: false))
        XCTAssertFalse(HacklantaThemeWindow.isActive(edition: e, now: d("2026-10-11T22:00:00Z"), manualPreview: false))
    }

    func testOverridesAndPreview() {
        let e = edition("2026-10-09T19:00:00Z", "2026-10-11T22:00:00Z", override: .forceOff)
        XCTAssertFalse(HacklantaThemeWindow.isActive(edition: e, now: d("2026-10-10T00:00:00Z"), manualPreview: false))
        XCTAssertTrue(HacklantaThemeWindow.isActive(edition: e, now: d("2026-10-10T00:00:00Z"), manualPreview: true))
        let on = edition("2026-10-09T19:00:00Z", "2026-10-11T22:00:00Z", override: .forceOn)
        XCTAssertTrue(HacklantaThemeWindow.isActive(edition: on, now: d("2020-01-01T00:00:00Z"), manualPreview: false))
        XCTAssertFalse(HacklantaThemeWindow.isActive(edition: nil, now: Date(), manualPreview: false))
        XCTAssertNil(HacklantaThemeWindow.nextTransition(edition: on, after: Date()))
    }

    func testNextTransition() {
        let e = edition("2026-10-09T19:00:00Z", "2026-10-11T22:00:00Z")
        XCTAssertEqual(HacklantaThemeWindow.nextTransition(edition: e, after: d("2026-10-01T00:00:00Z")), e.startsAt)
        XCTAssertEqual(HacklantaThemeWindow.nextTransition(edition: e, after: d("2026-10-10T00:00:00Z")), e.endsAt)
        XCTAssertNil(HacklantaThemeWindow.nextTransition(edition: e, after: d("2026-10-12T00:00:00Z")))
    }

    /// A window spanning the US fall-back (2026-11-01 06:00Z) stays exact in absolute time.
    func testWindowAcrossDSTUsesInstants() {
        let e = edition("2026-10-31T23:00:00-04:00", "2026-11-01T12:00:00-05:00")
        XCTAssertTrue(HacklantaThemeWindow.isActive(edition: e, now: d("2026-11-01T01:30:00-05:00"), manualPreview: false))
        XCTAssertTrue(HacklantaThemeWindow.isActive(edition: e, now: d("2026-11-01T16:59:59Z"), manualPreview: false))
        XCTAssertFalse(HacklantaThemeWindow.isActive(edition: e, now: d("2026-11-01T17:00:00Z"), manualPreview: false))
    }

    /// Grouping by day uses the venue zone, not the device zone, including across DST.
    func testScheduleGroupingVenueTimezoneAndDST() {
        func s(_ k: String, _ t: String) -> HacklantaSession {
            HacklantaSession(id: k, key: k, title: k, description: nil, kind: .activity, track: nil, roomId: nil, roomLabel: nil, startsAt: d(t), endsAt: nil, status: .scheduled, pointsNote: nil, updatedAt: d(t))
        }
        let ny = TimeZone(identifier: "America/New_York")!
        // 03:30Z on Nov 1 is 23:30 EDT Oct 31; 06:30Z is 01:30 EST Nov 1 (after fall-back).
        let days = ScheduleGrouping.days([s("late", "2026-11-01T03:30:00Z"), s("after", "2026-11-01T06:30:00Z")], timeZone: ny)
        XCTAssertEqual(days.map(\.id), ["2026-10-31", "2026-11-01"])
        let tokyo = ScheduleGrouping.days([s("late", "2026-11-01T03:30:00Z"), s("after", "2026-11-01T06:30:00Z")], timeZone: TimeZone(identifier: "Asia/Tokyo")!)
        XCTAssertEqual(tokyo.map(\.id), ["2026-11-01"])
    }

    func testNowNextOpenEndedAndCancelled() {
        func s(_ k: String, _ t: String, end: String? = nil, status: SessionStatus = .scheduled) -> HacklantaSession {
            HacklantaSession(id: k, key: k, title: k, description: nil, kind: .food, track: nil, roomId: nil, roomLabel: nil, startsAt: d(t), endsAt: end.map(d), status: status, pointsNote: nil, updatedAt: d(t))
        }
        let list = [s("open", "2026-10-09T20:00:00Z"), s("cx", "2026-10-09T20:05:00Z", end: "2026-10-09T21:00:00Z", status: .cancelled), s("later", "2026-10-09T22:00:00Z")]
        let nn = NowNext.compute(list, now: d("2026-10-09T20:10:00Z"))
        XCTAssertEqual(nn.now.map(\.key), ["open"])
        XCTAssertEqual(nn.next?.key, "later")
        XCTAssertTrue(NowNext.compute(list, now: d("2026-10-09T20:40:00Z")).now.isEmpty)
    }
}

final class QRTests: XCTestCase {
    func testModulesAreSquareAndStartWithFinder() throws {
        let m = try XCTUnwrap(QRCode.modules(for: "progsu:pass:v1:abc"))
        XCTAssertEqual(m.count, m[0].count)
        XCTAssertGreaterThanOrEqual(m.count, 21)
        XCTAssertEqual((m.count - 17) % 4, 0, "QR sizes are 17 + 4*version")
        XCTAssertTrue(m[0][0..<7].allSatisfy { $0 }, "top-left finder pattern")
        XCTAssertFalse(m[1][1])
    }
    func testImageHasQuietZone() throws {
        let img = try XCTUnwrap(QRCode.image(for: "x", scale: 4))
        let modules = try XCTUnwrap(QRCode.modules(for: "x")).count
        XCTAssertEqual(Int(img.size.width), (modules + 8) * 4)
    }
    func testEmptyPayload() { XCTAssertNil(QRCode.modules(for: "")) }
    func testShortCodeFormatting() {
        XCTAssertEqual(QRCode.formatShortCode("ab12cd34"), "AB12 CD34")
        XCTAssertEqual(QRCode.formatShortCode("AB-12 CD3"), "AB12 CD3")
        XCTAssertEqual(QRCode.spokenShortCode("ab1"), "A B 1")
    }
    func testDebouncer() {
        var d = ScanDebouncer(window: 2)
        let t = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(d.shouldAccept(" abc\n", now: t), "abc")
        XCTAssertNil(d.shouldAccept("abc", now: t.addingTimeInterval(1)))
        XCTAssertEqual(d.shouldAccept("def", now: t.addingTimeInterval(1)), "def")
        XCTAssertEqual(d.shouldAccept("abc", now: t.addingTimeInterval(4)), "abc")
        XCTAssertNil(d.shouldAccept("   ", now: t))
        XCTAssertNil(d.shouldAccept(String(repeating: "a", count: 600), now: t))
    }
}

final class DeepLinkTests: XCTestCase {
    func p(_ s: String) -> DeepLink? { DeepLink.parse(URL(string: s)!, universalLinkHost: "members.progsu.com") }

    func testCustomScheme() {
        XCTAssertEqual(p("progsu://event/intro-to-swift"), .event(slug: "intro-to-swift"))
        XCTAssertEqual(p("progsu://announcement/a1"), .announcement(id: "a1"))
        XCTAssertEqual(p("progsu://hacklanta/session/opening"), .hacklantaSession(id: "opening"))
        XCTAssertEqual(p("progsu://pass"), .myQR)
        XCTAssertNil(p("https://members.progsu.com/checkin"), "AASA never claims /checkin")
        if case .authCallback = p("progsu://auth-callback?code=x") {} else { XCTFail() }
    }
    func testUniversalLinks() {
        XCTAssertEqual(p("https://members.progsu.com/events/intro-to-swift"), .event(slug: "intro-to-swift"))
        XCTAssertEqual(p("https://members.progsu.com/hacklanta/sessions/opening"), .hacklantaSession(id: "opening"))
        XCTAssertEqual(p("https://MEMBERS.progsu.com/announcements/a1"), .announcement(id: "a1"))
    }
    func testRejects() {
        XCTAssertNil(p("https://evil.example/events/x"))
        XCTAssertNil(p("http://members.progsu.com/events/x"))
        XCTAssertNil(p("progsu://event/../../etc"))
        XCTAssertNil(p("progsu://event"))
        XCTAssertNil(p("progsu://unknown/x"))
        XCTAssertNil(p("https://members.progsu.com/admin/events/x"))
    }
}

final class APIErrorTests: XCTestCase {
    func testCodeMapping() {
        XCTAssertEqual(APIError.from(code: "not_onboarded", message: "m", status: 403), .notOnboarded("m"))
        XCTAssertEqual(APIError.from(code: "feature_off", message: "m", status: 404), .featureOff("m"))
        XCTAssertEqual(APIError.from(code: "rate_limited", message: "m", status: 429, retryAfter: 30), .rateLimited("m", retryAfter: 30))
        XCTAssertEqual(APIError.from(code: "unavailable", message: "m", status: 503), .unavailable("m"))
        XCTAssertEqual(APIError.from(code: nil, message: nil, status: 401), .unauthenticated("Progsu couldn't answer that request (HTTP 401)."))
        XCTAssertEqual(APIError.from(code: "weird", message: "m", status: 502), .server(code: "weird", message: "m"))
        XCTAssertTrue(APIError.from(code: "internal", message: "m", status: 500).isRetryable)
        XCTAssertFalse(APIError.from(code: "conflict", message: "m", status: 409).isRetryable)
    }

    func testClientMapsEnvelopeAndRetries() async throws {
        StubProtocol.reset()
        StubProtocol.responses = [
            (500, #"{"ok":false,"error":{"code":"internal","message":"x"},"requestId":"r"}"#),
            (200, #"{"ok":true,"data":{"qrPayload":"p","shortCode":"S"}}"#),
        ]
        let client = makeClient()
        let pass: CheckInPass = try await client.get("me/pass", auth: .required)
        XCTAssertEqual(pass.shortCode, "S")
        XCTAssertEqual(StubProtocol.requests.count, 2)
        XCTAssertEqual(StubProtocol.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer tok")

        // Same envelope lib/mobile/http.ts errorResponse() emits for not_onboarded (HTTP 403).
        StubProtocol.reset()
        StubProtocol.responses = [(403, #"{"ok":false,"error":{"code":"not_onboarded","message":"Finish onboarding first."},"requestId":"r"}"#)]
        do {
            let _: Me = try await client.get("me", auth: .required)
            XCTFail("expected error")
        } catch let e as APIError {
            XCTAssertEqual(e, .notOnboarded("Finish onboarding first."))
        }
        XCTAssertEqual(StubProtocol.requests.count, 1, "4xx must not retry")

        // Real captured 401: the client refreshes the token exactly once, then surfaces it.
        let unauth = String(data: try fixture("error"), encoding: .utf8)!
        StubProtocol.reset()
        StubProtocol.responses = [(401, unauth), (401, unauth)]
        do {
            let _: Me = try await client.get("me", auth: .required)
            XCTFail("expected error")
        } catch let e as APIError {
            XCTAssertEqual(e, .unauthenticated("Sign in required."))
        }
        XCTAssertEqual(StubProtocol.requests.count, 2, "one forced refresh, no retries")
    }

    func testPostWithoutIdempotencyKeyDoesNotRetry() async throws {
        StubProtocol.reset()
        StubProtocol.responses = [(500, #"{"ok":false,"error":{"code":"internal","message":"x"}}"#)]
        let client = makeClient()
        do {
            let _: EmptyResponse = try await client.send(method: .post, path: "x", body: ["a": "b"])
            XCTFail()
        } catch {}
        XCTAssertEqual(StubProtocol.requests.count, 1)
    }

    func makeClient() -> APIClient {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubProtocol.self]
        return APIClient(baseURL: URL(string: "https://example.test/api/mobile/v1")!, session: URLSession(configuration: cfg), maxRetries: 2) { _ in "tok" }
    }
}

final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var responses: [(Int, String)] = []
    nonisolated(unsafe) static var requests: [URLRequest] = []
    static func reset() { responses = []; requests = [] }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let (status, body) = Self.responses.isEmpty ? (500, "{}") : Self.responses.removeFirst()
        let resp = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
