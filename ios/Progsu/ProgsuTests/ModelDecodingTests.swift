import XCTest
@testable import Progsu

func fixture(_ name: String) throws -> Data {
    let bundle = Bundle(for: BundleToken.self)
    let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json"), "missing fixture \(name).json")
    return try Data(contentsOf: url)
}
final class BundleToken {}

private struct Envelope<T: Decodable>: Decodable { let ok: Bool; let data: T }

final class ModelDecodingTests: XCTestCase {
    let decoder = JSONCoding.decoder()

    func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try decoder.decode(Envelope<T>.self, from: fixture(name)).data
    }

    func testConfig() throws {
        let c = try decode(AppConfig.self, "config")
        XCTAssertEqual(c.hacklanta?.slug, "hacklanta-ii")
        XCTAssertEqual(c.hacklanta?.themeOverride, .auto)
        XCTAssertGreaterThanOrEqual(c.minSupportedBuild, 1)
        XCTAssertFalse(c.features.wallet)
    }

    func testMe() throws {
        let me = try decode(Me.self, "me")
        XCTAssertTrue(me.onboarding.fullyOnboarded)
        XCTAssertNil(me.onboarding.nextStep, "a fully onboarded member has no next step")
        XCTAssertEqual(me.isStaff, !me.staffAssignments.isEmpty)
        XCTAssertNotEqual(me.affiliation, .unknown)
        XCTAssertNotNil(me.consentVersions["privacy_policy"])
        XCTAssertFalse(me.nameForDisplay.isEmpty)
        XCTAssertNotEqual(me.nameForDisplay, me.email, "first/last name should win over email")

        let fresh = try decode(Me.self, "me_not_onboarded")
        XCTAssertFalse(fresh.onboarding.fullyOnboarded)
        XCTAssertNotNil(fresh.onboarding.nextStep)
        XCTAssertFalse(fresh.isStaff)
    }

    func testEvents() throws {
        let page = try decode(Page<EventSummary>.self, "events")
        XCTAssertFalse(page.items.isEmpty)
        XCTAssertEqual(Set(page.items.map(\.id)).count, page.items.count)
        XCTAssertEqual(page.items.map(\.startsAt), page.items.map(\.startsAt).sorted(), "upcoming list is chronological")
        for e in page.items { XCTAssertNotNil(TimeZone(identifier: e.timeZone)) }
        XCTAssertFalse(try decode(Page<EventSummary>.self, "events_anon").items.isEmpty)

        let detail = try decode(EventDetail.self, "event_detail")
        XCTAssertNotNil(detail.viewer, "authenticated detail carries a viewer block")
        XCTAssertNotNil(detail.viewer?.rsvpStatus)
        XCTAssertLessThan(detail.startsAt, detail.endsAt)
        XCTAssertTrue(detail.rsvpOpen(now: detail.startsAt.addingTimeInterval(-3600)))
        XCTAssertFalse(detail.rsvpOpen(now: detail.endsAt.addingTimeInterval(60)))
        XCTAssertNil(try decode(EventDetail.self, "event_detail_anon").viewer, "anonymous detail has no viewer")

        let mine = try decode(ItemList<MyEvent>.self, "my_events").items
        XCTAssertFalse(mine.isEmpty)
        XCTAssertTrue(mine.allSatisfy { $0.rsvpStatus != nil })
        XCTAssertNotNil(try decode(RSVPResult.self, "rsvp").effectiveStatus)
    }

    func testPassPointsAnnouncements() throws {
        let pass = try decode(CheckInPass.self, "pass")
        XCTAssertFalse(pass.qrPayload.isEmpty)
        XCTAssertEqual(pass.shortCode.count, 8)
        XCTAssertEqual(pass.shortCode, pass.shortCode.uppercased())

        let p = try decode(PointsSummary.self, "points")
        XCTAssertFalse(p.items.isEmpty)
        XCTAssertEqual(p.balance, p.items.map(\.amount).reduce(0, +), "single-page ledger sums to the balance")
        XCTAssertTrue(p.items.allSatisfy { !$0.label.isEmpty })

        let items = try decode(Page<Announcement>.self, "announcements").items
        XCTAssertFalse(items.isEmpty)
        XCTAssertEqual(items.map(\.publishedAt), items.map(\.publishedAt).sorted(by: >), "feed is newest first")
        for a in items { XCTAssertEqual(a.isImportant, a.priority == "important") }
    }

    func testStaff() throws {
        let events = try decode(ItemList<StaffEvent>.self, "staff_events").items
        XCTAssertFalse(events.isEmpty)
        for e in events { XCTAssertGreaterThanOrEqual(e.checkedInCount, 0); XCTAssertGreaterThanOrEqual(e.goingCount, 0) }

        let first = try decode(ScanResponse.self, "staff_scan_checked_in")
        XCTAssertEqual(first.result, .checkedIn)
        XCTAssertNotNil(first.attendee)
        XCTAssertNotNil(first.checkedInAt)
        XCTAssertGreaterThan(first.pointsAwarded, 0)
        let repeatScan = try decode(ScanResponse.self, "staff_scan")
        XCTAssertEqual(repeatScan.result, .alreadyCheckedIn)
        XCTAssertEqual(repeatScan.pointsAwarded, 0, "a repeat scan never re-awards")
        let invalid = try decode(ScanResponse.self, "staff_scan_invalid")
        XCTAssertEqual(invalid.result, .invalidCode)
        XCTAssertNil(invalid.attendee)

        let roster = try decode(ItemList<RosterEntry>.self, "roster").items
        XCTAssertFalse(roster.isEmpty)
        for r in roster { XCTAssertEqual(r.checkedIn, r.checkedInAt != nil); XCTAssertNotEqual(r.rsvpStatus, .unknown) }
        let unknown = #"{"userId":"u","displayName":"X","rsvpStatus":"brand_new","checkedIn":false,"checkedInAt":null}"#
        XCTAssertEqual(try decoder.decode(RosterEntry.self, from: Data(unknown.utf8)).rsvpStatus, .unknown)
    }

    func testHacklantaGuideFromRealSchedule() throws {
        let g = try decode(HacklantaGuide.self, "hacklanta")
        XCTAssertEqual(g.sessions.count, 37)
        XCTAssertTrue(g.edition.scheduleTentative)
        XCTAssertTrue(g.sessions.contains { $0.endsAt == nil }, "open-ended sessions must decode")
        XCTAssertTrue(g.sessions.contains { $0.pointsNote != nil })
        XCTAssertTrue(g.floors.isEmpty)
        XCTAssertFalse(g.roomLabels.isEmpty)
        XCTAssertEqual(Set(g.roomLabels).count, g.roomLabels.count)
        let days = ScheduleGrouping.days(g.sessions, timeZone: TimeZone(identifier: g.edition.timeZone)!)
        XCTAssertEqual(days.map(\.id), ["2026-10-09", "2026-10-10", "2026-10-11"])

        let me = try decode(HacklantaMe.self, "hacklanta_me")
        XCTAssertFalse(me.linked)
        XCTAssertNil(me.application, "unlinked state carries no application")
    }

    func testDeletionAndErrorEnvelopes() throws {
        XCTAssertEqual(try decode(DeleteAccountResult.self, "me_delete").status, "completed")
        struct E: Decodable { let ok: Bool; let error: APIEnvelopeError; let requestId: String }
        let expected = ["error": "unauthenticated", "error_forbidden": "forbidden", "error_not_found": "not_found", "error_unavailable": "unavailable"]
        for (name, code) in expected {
            let e = try decoder.decode(E.self, from: fixture(name))
            XCTAssertFalse(e.ok)
            XCTAssertEqual(e.error.code, code)
            XCTAssertFalse(e.error.message.isEmpty)
            XCTAssertFalse(e.requestId.isEmpty)
        }
    }

    func testAllScanResultsDecode() throws {
        for r in ScanResult.allCases {
            let json = #"{"result":"\#(r.rawValue)","attendee":null,"pointsAwarded":0,"checkedInAt":null}"#
            XCTAssertEqual(try decoder.decode(ScanResponse.self, from: Data(json.utf8)).result, r)
        }
    }
}
