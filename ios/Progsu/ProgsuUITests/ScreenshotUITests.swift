import XCTest

/// Captures key screens when SCREENSHOT_DIR is set (TEST_RUNNER_SCREENSHOT_DIR on the xcodebuild line).
/// Skipped otherwise, so normal test runs don't write files.
final class ScreenshotUITests: XCTestCase {
    @MainActor
    func testCaptureScreens() throws {
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { throw XCTSkip("SCREENSHOT_DIR not set") }
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        func dismissSystemAlerts() {
            for label in ["Not Now", "Cancel"] where springboard.buttons[label].exists { springboard.buttons[label].tap() }
        }
        func shot(_ name: String) {
            sleep(2)
            dismissSystemAlerts()
            sleep(1)
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
        for (suffix, extra) in [("", [String]()), ("-hacklanta-mode", ["-hacklanta-preview"])] {
            let app = XCUIApplication()
            app.launchArguments = ["-ui-testing"] + extra
            app.launch()
            let tabs = app.tabBars.firstMatch
            _ = tabs.waitForExistence(timeout: 10)
            shot("home\(suffix)")
            tabs.buttons["Events"].tap(); shot("events\(suffix)")
            tabs.buttons["My QR"].tap(); shot("myqr\(suffix)")
            tabs.buttons["Hacklanta"].tap(); shot("hacklanta\(suffix)")
            app.buttons["Map"].tap(); shot("hacklanta-map\(suffix)")
            tabs.buttons["Profile"].tap(); shot("profile\(suffix)")
            app.terminate()
        }
    }
}
