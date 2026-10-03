import XCTest

/// End-to-end walk against a LOCAL stack (DEBUG build, Debug API_BASE_URL). Skipped unless E2E_PHASE is set
/// (TEST_RUNNER_E2E_PHASE on the xcodebuild line). Phases run in order with backend setup between them:
/// anon -> member -> staff -> delete. Uses the DEBUG-only password sign-in, so it needs a password user.
final class LocalE2EUITests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private var app: XCUIApplication!

    override func setUp() { continueAfterFailure = false }

    private func shot(_ name: String) {
        sleep(1)
        let png = XCUIScreen.main.screenshot().pngRepresentation
        if let dir = env["SCREENSHOT_DIR"] {
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("e2e-\(name).png"))
        }
        let a = XCTAttachment(data: png, uniformTypeIdentifier: "public.png"); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func launch() {
        app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 15))
    }

    private func tab(_ name: String) { app.tabBars.buttons[name].tap() }

    private func type(_ field: XCUIElement, _ text: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap(); field.typeText(text)
    }

    private func flip(_ label: String) {
        let sw = app.switches[label].firstMatch
        XCTAssertTrue(sw.waitForExistence(timeout: 10), label)
        sw.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
    }

    private func waitText(_ text: String, timeout: TimeInterval = 15) -> Bool {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.waitForExistence(timeout: timeout)
    }

    @MainActor
    func testLocalE2E() throws {
        guard let phase = env["E2E_PHASE"] else { throw XCTSkip("E2E_PHASE not set") }
        launch()
        switch phase {
        case "anon": try anon()
        case "member": try member()
        case "staff": try staff()
        case "delete": try deleteAccount()
        default: XCTFail("unknown phase \(phase)")
        }
    }

    private func anon() throws {
        XCTAssertTrue(waitText("iOS E2E build night"), "Home shows the local event")
        shot("anon-home")
        tab("Events")
        XCTAssertTrue(waitText("iOS E2E build night"))
        shot("anon-events")
        tab("Hacklanta")
        XCTAssertTrue(waitText("Hacker check-in", timeout: 20) || waitText("Opening ceremony", timeout: 5), "real schedule loads")
        shot("anon-hacklanta")
    }

    private func member() throws {
        tab("Profile")
        let open = app.buttons["debug-signin-open"]
        if open.waitForExistence(timeout: 8) {
            open.tap()
            type(app.textFields["debug-signin-email"], env["E2E_EMAIL"] ?? "")
            type(app.secureTextFields["debug-signin-password"], env["E2E_PASSWORD"] ?? "")
            shot("member-debug-signin")
            app.buttons["debug-signin-submit"].tap()
            XCTAssertTrue(app.navigationBars["DEBUG sign-in"].waitForNonExistence(timeout: 20), "debug sheet closes on success")
        }
        sleep(3)
        shot("member-after-signin")
        // Onboarding: profile step, nonstudent path.
        XCTAssertTrue(app.textFields["First name"].waitForExistence(timeout: 20), "onboarding profile step")
        type(app.textFields["First name"], "Ivy")
        type(app.textFields["Last name"], "Tester")
        app.buttons["Not a student"].firstMatch.tap()
        XCTAssertFalse(app.textFields["Major"].exists, "nonstudent hides major")
        type(app.textFields["Phone number"], "4045550123")
        shot("member-onboarding-profile")
        app.buttons["Continue"].tap()

        XCTAssertTrue(app.navigationBars["Consent"].waitForExistence(timeout: 15), "consent step")
        flip(app.switches.element(boundBy: 0).label)
        flip(app.switches.element(boundBy: 1).label)
        flip("I confirm I am 18 or older")
        shot("member-onboarding-consent")
        app.buttons["Accept and continue"].tap()
        XCTAssertTrue(app.navigationBars["Consent"].waitForNonExistence(timeout: 15), "onboarding finished")

        tab("Events")
        let row = app.staticTexts["iOS E2E build night"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        let rsvp = app.buttons["RSVP"]
        XCTAssertTrue(rsvp.waitForExistence(timeout: 15))
        rsvp.tap()
        XCTAssertTrue(waitText("You're going"), "RSVP confirmed")
        shot("member-rsvp")

        tab("My QR")
        XCTAssertTrue(app.images["Check-in QR code"].waitForExistence(timeout: 15), "pass shows QR")
        shot("member-myqr")
    }

    private func staff() throws {
        tab("Profile")
        let entry = app.buttons["staff-entry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 15), "staff entry appears after grant")
        shot("staff-profile")
        entry.tap()
        let ev = app.staticTexts["iOS E2E build night"].firstMatch
        XCTAssertTrue(ev.waitForExistence(timeout: 15))
        shot("staff-home")
        ev.tap()

        app.buttons["Roster"].tap()
        XCTAssertTrue(waitText("Ivy"), "roster loads the RSVP")
        shot("staff-roster-before")

        app.buttons["Scan"].tap()
        type(app.textFields["ABCD 1234"], env["E2E_CODE"] ?? "")
        app.buttons["Check"].tap()
        XCTAssertTrue(waitText("points awarded"), "checked in with points")
        shot("staff-scan-checked-in")
        type(app.textFields["ABCD 1234"], env["E2E_CODE"] ?? "")
        app.buttons["Check"].tap()
        sleep(2)
        shot("staff-scan-repeat")

        app.buttons["Roster"].tap()
        XCTAssertTrue(waitText("In"))
        shot("staff-roster-after")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Announcements"].firstMatch.tap()
        XCTAssertTrue(waitText("Hacklanta II check-in opens Friday 3pm"), "announcement feed")
        shot("announcements")
        app.staticTexts["Hacklanta II check-in opens Friday 3pm"].firstMatch.tap()
        sleep(1)
        shot("announcement-detail")
    }

    private func deleteAccount() throws {
        tab("Profile")
        XCTAssertTrue(waitText("Ivy"), "still signed in")
        shot("delete-profile-points")
        app.buttons["Settings"].firstMatch.tap()
        let del = app.buttons["Delete my account"].firstMatch
        XCTAssertTrue(del.waitForExistence(timeout: 10))
        del.tap()
        type(app.textFields["delete-confirm-field"], "DELETE")
        shot("delete-confirm")
        app.textFields["delete-confirm-field"].typeText("\n")
        app.navigationBars["Delete account"].swipeUp()
        sleep(1)
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Delete my account'")).allElementsBoundByIndex.last { $0.isHittable }
        XCTAssertNotNil(confirm, "confirm button in sheet")
        confirm?.tap()
        XCTAssertTrue(app.navigationBars["Delete account"].waitForNonExistence(timeout: 20), "sheet closes after delete")
        sleep(2)
        tab("Profile")
        XCTAssertTrue(app.buttons["debug-signin-open"].waitForExistence(timeout: 15), "signed out after delete")
        shot("delete-signed-out")
    }
}
