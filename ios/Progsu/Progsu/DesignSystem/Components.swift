import SwiftUI

/// The `.ambient-field` radial violet wash every member surface sits on.
struct AmbientField: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        GeometryReader { geo in
            ZStack {
                theme.background
                if !reduceTransparency {
                    RadialGradient(colors: [theme.fieldPrimary, .clear], center: UnitPoint(x: 0.12, y: -0.1),
                                   startRadius: 0, endRadius: max(geo.size.width, geo.size.height) * 0.75)
                    RadialGradient(colors: [theme.fieldSecondary, .clear], center: UnitPoint(x: 1.05, y: 0.05),
                                   startRadius: 0, endRadius: max(geo.size.width, geo.size.height) * 0.55)
                }
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// `.glass`: translucent fill + specular top edge + hairline. No backdrop blur for scrolling content.
struct GlassCard: ViewModifier {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: ProgsuTheme.radius, style: .continuous)
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(reduceTransparency ? AnyShapeStyle(theme.card) : AnyShapeStyle(theme.glassFill), in: shape)
            .overlay(shape.strokeBorder(theme.hairline, lineWidth: 1))
            .overlay(alignment: .top) {
                shape.stroke(LinearGradient(colors: [theme.specular, .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.08)), lineWidth: 1)
            }
    }
}

extension View {
    func glassCard(padding: CGFloat = 16) -> some View { modifier(GlassCard(padding: padding)) }

    /// Screen scaffold: ambient field behind, themed foreground.
    func progsuScreen() -> some View { modifier(ScreenModifier()) }
}

private struct ScreenModifier: ViewModifier {
    @Environment(\.theme) private var theme
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background { AmbientField() }
            .foregroundStyle(theme.foreground)
    }
}

struct Eyebrow: View {
    @Environment(\.theme) private var theme
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.6)
            .foregroundStyle(theme.mutedForeground)
            .accessibilityAddTraits(.isHeader)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    var destructive = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 16)
            .foregroundStyle(destructive ? Color.white : theme.primaryForeground)
            .background(destructive ? theme.destructive : theme.primary, in: RoundedRectangle(cornerRadius: ProgsuTheme.radius, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: ProgsuTheme.radius, style: .continuous)
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 16)
            .foregroundStyle(theme.foreground)
            .background(theme.glassFill, in: shape)
            .overlay(shape.strokeBorder(theme.hairline))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
    }
}

/// Status chip that always pairs colour with an icon and text so state never relies on colour alone.
struct StatusPill: View {
    @Environment(\.theme) private var theme
    enum Tone { case neutral, positive, warning, negative, accent }
    let text: String
    let systemImage: String
    var tone: Tone = .neutral

    var body: some View {
        let color: Color = switch tone {
        case .neutral: theme.mutedForeground
        case .positive: theme.success
        case .warning: theme.warning
        case .negative: theme.destructive
        case .accent: theme.primary
        }
        Label(text, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
    }
}

/// Loadable wrapper so every screen renders the same loading / empty / error / offline vocabulary.
enum Loadable<Value: Sendable>: Sendable {
    case idle
    case loading
    case loaded(Value, savedAt: Date? = nil)
    case failed(APIError, cached: Value? = nil, savedAt: Date? = nil)

    var value: Value? {
        switch self {
        case .loaded(let v, _): return v
        case .failed(_, let c, _): return c
        default: return nil
        }
    }
    var isLoading: Bool { if case .loading = self { return true } else { return false } }
}

struct StateMessage: View {
    @Environment(\.theme) private var theme
    let title: String
    let message: String
    let systemImage: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .regular))
                .foregroundStyle(theme.primary)
                .accessibilityHidden(true)
            Text(title).font(.headline).multilineTextAlignment(.center)
            Text(message).font(.subheadline).foregroundStyle(theme.mutedForeground).multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(maxWidth: 240)
                    .padding(.top, 4)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    static func error(_ error: APIError, retry: @escaping () -> Void) -> StateMessage {
        switch error {
        case .offline:
            return StateMessage(title: "You're offline", message: error.userMessage, systemImage: "wifi.slash", actionTitle: "Try again", action: retry)
        case .featureOff:
            return StateMessage(title: "Not available", message: error.userMessage, systemImage: "pause.circle")
        default:
            return StateMessage(title: "Couldn't load this", message: error.userMessage, systemImage: "exclamationmark.triangle", actionTitle: "Try again", action: retry)
        }
    }
}

struct LastUpdatedBanner: View {
    @Environment(\.theme) private var theme
    let savedAt: Date
    var body: some View {
        Label {
            Text("Offline. Last updated \(savedAt.formatted(.relative(presentation: .named)))")
        } icon: {
            Image(systemName: "icloud.slash")
        }
        .font(.footnote)
        .foregroundStyle(theme.mutedForeground)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct LoadingView: View {
    var label = "Loading"
    var body: some View {
        ProgressView(label)
            .frame(maxWidth: .infinity, minHeight: 160)
    }
}

enum EventFormatting {
    static func dateLine(start: Date, end: Date?, timeZone: String) -> String {
        let tz = TimeZone(identifier: timeZone) ?? .current
        var day = Date.FormatStyle(date: .abbreviated, time: .omitted).weekday(.abbreviated)
        day.timeZone = tz
        var time = Date.FormatStyle(date: .omitted, time: .shortened)
        time.timeZone = tz
        var s = "\(start.formatted(day)) · \(start.formatted(time))"
        if let end { s += " – \(end.formatted(time))" }
        if tz.identifier != TimeZone.current.identifier, let abbr = tz.abbreviation(for: start) { s += " \(abbr)" }
        return s
    }
}
