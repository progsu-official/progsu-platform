import SwiftUI
import UIKit

extension UIColor {
    convenience init(h: CGFloat, s: CGFloat, l: CGFloat, a: CGFloat = 1) {
        // HSL -> HSB so tokens can be copied verbatim from app/globals.css.
        let s1 = s / 100, l1 = l / 100
        let v = l1 + s1 * min(l1, 1 - l1)
        let sb = v == 0 ? 0 : 2 * (1 - l1 / v)
        self.init(hue: h / 360, saturation: sb, brightness: v, alpha: a)
    }

    convenience init(hex: UInt32, a: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
    }

    static func dynamic(light: UIColor, dark: UIColor) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? dark : light }
    }
}

/// Token set mirroring app/globals.css (`:root` / `.dark`). Hacklanta is a separate variant drawn from
/// the hacklanta-ii site palette (ink/paper/cyan/pink/violet/lime) and is always dark.
struct ProgsuTheme: Equatable, Sendable {
    enum Variant: String, Sendable { case progsu, hacklanta }
    let variant: Variant

    var background: Color
    var foreground: Color
    var mutedForeground: Color
    var primary: Color
    var primaryForeground: Color
    var secondaryAccent: Color
    var card: Color
    var glassFill: Color
    var hairline: Color
    var specular: Color
    var destructive: Color
    var success: Color
    var warning: Color
    var fieldPrimary: Color
    var fieldSecondary: Color
    var forcedScheme: ColorScheme?

    static let radius: CGFloat = 12

    static let progsu = ProgsuTheme(
        variant: .progsu,
        background: Color(UIColor.dynamic(light: .white, dark: UIColor(h: 260, s: 10, l: 5.5))),
        foreground: Color(UIColor.dynamic(light: UIColor(h: 222.2, s: 47.4, l: 11.2), dark: UIColor(h: 260, s: 10, l: 96))),
        mutedForeground: Color(UIColor.dynamic(light: UIColor(h: 215.4, s: 16.3, l: 42), dark: UIColor(h: 255, s: 7, l: 66))),
        primary: Color(UIColor.dynamic(light: UIColor(h: 262, s: 83, l: 58), dark: UIColor(h: 258, s: 92, l: 69))),
        primaryForeground: .white,
        secondaryAccent: Color(UIColor.dynamic(light: UIColor(h: 262, s: 83, l: 58), dark: UIColor(h: 258, s: 92, l: 69))),
        card: Color(UIColor.dynamic(light: .white, dark: UIColor(h: 260, s: 8, l: 8.5))),
        glassFill: Color(UIColor.dynamic(light: UIColor(white: 1, alpha: 0.72), dark: UIColor(h: 260, s: 20, l: 70, a: 0.07))),
        hairline: Color(UIColor.dynamic(light: UIColor(white: 0, alpha: 0.09), dark: UIColor(white: 1, alpha: 0.12))),
        specular: Color(UIColor.dynamic(light: UIColor(white: 1, alpha: 0.9), dark: UIColor(white: 1, alpha: 0.14))),
        destructive: Color(UIColor.dynamic(light: UIColor(h: 0, s: 72, l: 48), dark: UIColor(h: 0, s: 72, l: 62))),
        success: Color(UIColor.dynamic(light: UIColor(h: 152, s: 70, l: 30), dark: UIColor(h: 152, s: 60, l: 55))),
        warning: Color(UIColor.dynamic(light: UIColor(h: 32, s: 90, l: 38), dark: UIColor(h: 38, s: 92, l: 60))),
        fieldPrimary: Color(UIColor.dynamic(light: UIColor(h: 262, s: 83, l: 58, a: 0.10), dark: UIColor(h: 258, s: 92, l: 69, a: 0.16))),
        fieldSecondary: Color(UIColor.dynamic(light: UIColor(h: 262, s: 83, l: 58, a: 0.07), dark: UIColor(h: 258, s: 90, l: 60, a: 0.10))),
        forcedScheme: nil
    )

    static let hacklanta = ProgsuTheme(
        variant: .hacklanta,
        background: Color(UIColor(hex: 0x01030a)),
        foreground: Color(UIColor(hex: 0xfaf7ff)),
        mutedForeground: Color(UIColor(hex: 0xa8a2b7)),
        primary: Color(UIColor(hex: 0x21e6d7)),
        primaryForeground: Color(UIColor(hex: 0x01030a)),
        secondaryAccent: Color(UIColor(hex: 0xff316f)),
        card: Color(UIColor(hex: 0x0a0d18)),
        glassFill: Color(UIColor(hex: 0x5935e8, a: 0.12)),
        hairline: Color(UIColor(white: 1, alpha: 0.14)),
        specular: Color(UIColor(white: 1, alpha: 0.18)),
        destructive: Color(UIColor(hex: 0xff316f)),
        success: Color(UIColor(hex: 0x21e6d7)),
        warning: Color(UIColor(hex: 0xf6ce28)),
        fieldPrimary: Color(UIColor(hex: 0x5935e8, a: 0.35)),
        fieldSecondary: Color(UIColor(hex: 0xff316f, a: 0.16)),
        forcedScheme: .dark
    )
}

private struct ThemeKey: EnvironmentKey {
    static let defaultValue = ProgsuTheme.progsu
}

extension EnvironmentValues {
    var theme: ProgsuTheme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}
