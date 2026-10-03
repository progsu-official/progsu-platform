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
        XCTAssertEqual(c.hacklanta?.scheduleTentative, true)
        XCTAssertFalse(c.features.wallet)
    }

    func testMe() throws {
        let me = try decode(Me.self, "me")
        XCTAssertTrue(me.isStaff)
        XCTAssertEqual(me.affiliation, .gsuStudent)
        XCTAssertEqual(me.onboarding.nextStep, "consent")
        XCTAssertFalse(me.onboarding.fullyOnboarded)
        XCTAssertEqual(me.consentVersions["privacy_policy"], "v8")
        XCTAssertEqual(me.nameForDisplay, "Pat Lee")
    }

    func testEvents() throws {
        let page = try decode(Page<EventSummary>.self, "events")
        XCTAssertEqual(page.items.count, 1)
        XCTAssertNotNil(page.nextCursor)
        let detail = try decode(EventDetail.self, "event_detail")
        XCTAssertEqual(detail.viewer?.rsvpStatus, .going)
        XCTAssertEqual(detail.startsAt, JSONCoding.parseISO8601("2026-10-15T22:00:00Z"))
        XCTAssertTrue(detail.rsvpOpen(now: JSONCoding.parseISO8601("2026-10-01T00:00:00Z")!))
        XCTAssertFalse(detail.rsvpOpen(now: JSONCoding.parseISO8601("2026-10-17T00:00:00Z")!))
        XCTAssertEqual(try decode(ItemList<MyEvent>.self, "my_events").items.first?.rsvpStatus, .going)
    }

    func testPassPointsAnnouncements() throws {
        XCTAssertEqual(try decode(CheckInPass.self, "pass").shortCode, "SYNTHETI")
        let p = try decode(PointsSummary.self, "points")
        XCTAssertEqual(p.items.map(\.amount), [5, -5])
        XCTAssertEqual(p.items[0].label, "Intro to Swift")
        XCTAssertEqual(p.items[1].label, "Duplicate")
        let a = try decode(Page<Announcement>.self, "announcements").items[0]
        XCTAssertEqual(a.read, false)
        XCTAssertTrue(a.isImportant)
    }

    func testStaff() throws {
        XCTAssertEqual(try decode(ItemList<StaffEvent>.self, "staff_events").items[0].checkedInCount, 3)
        XCTAssertEqual(try decode(ScanResponse.self, "staff_scan").result, .alreadyCheckedIn)
        XCTAssertEqual(try decode(ItemList<RosterEntry>.self, "roster").items[1].rsvpStatus, .waitlisted)
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
        XCTAssertEqual(try decode(HacklantaMe.self, "hacklanta_me").application?.team?.memberFirstNames, ["Pat", "Sam"])
    }

    func testAllScanResultsDecode() throws {
        for r in ScanResult.allCases {
            let json = #"{"result":"\#(r.rawValue)","attendee":null,"pointsAwarded":0,"checkedInAt":null}"#
            XCTAssertEqual(try decoder.decode(ScanResponse.self, from: Data(json.utf8)).result, r)
        }
    }
}
