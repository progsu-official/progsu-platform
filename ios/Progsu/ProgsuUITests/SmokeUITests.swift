import XCTest

final class SmokeUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testLoggedOutTabsNavigate() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 10))
        for name in ["Events", "My QR", "Hacklanta", "Profile", "Home"] {
            tabs.buttons[name].tap()
        }
        tabs.buttons["My QR"].tap()
        XCTAssertTrue(app.staticTexts["Your check-in code"].waitForExistence(timeout: 5), "logged-out My QR shows sign-in")
        tabs.buttons["Hacklanta"].tap()
        XCTAssertTrue(app.buttons["Schedule"].waitForExistence(timeout: 5))
    }
}
