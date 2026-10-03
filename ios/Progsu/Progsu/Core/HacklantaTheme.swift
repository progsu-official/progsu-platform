import Foundation

/// Decides whether the Hacklanta theme is active. Window bounds are absolute instants from the server,
/// so device timezone and DST never shift the switch-over; the edition `timeZone` is only for display.
enum HacklantaThemeWindow {
    static func isActive(edition: HacklantaEditionSummary?, now: Date, manualPreview: Bool) -> Bool {
        if manualPreview { return true }
        guard let edition else { return false }
        switch edition.themeOverride {
        case .forceOn: return true
        case .forceOff: return false
        case .auto: return edition.startsAt <= now && now < edition.endsAt
        }
    }

    /// Next instant the auto decision could flip, so the app can schedule a single re-evaluation.
    static func nextTransition(edition: HacklantaEditionSummary?, after now: Date) -> Date? {
        guard let edition, edition.themeOverride == .auto else { return nil }
        if now < edition.startsAt { return edition.startsAt }
        if now < edition.endsAt { return edition.endsAt }
        return nil
    }
}

/// Groups sessions by calendar day in the edition's timezone (not the device's), so an attendee
/// browsing from another zone still sees "Saturday" sessions under Saturday.
enum ScheduleGrouping {
    struct Day: Identifiable, Hashable {
        let id: String
        let date: DateComponents
        let sessions: [HacklantaSession]
    }

    static func days(_ sessions: [HacklantaSession], timeZone: TimeZone) -> [Day] {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let grouped = Dictionary(grouping: sessions) { s -> String in
            let c = cal.dateComponents([.year, .month, .day], from: s.startsAt)
            return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        }
        return grouped.keys.sorted().map { key in
            let items = grouped[key]!.sorted { ($0.startsAt, $0.title) < ($1.startsAt, $1.title) }
            return Day(id: key, date: cal.dateComponents([.year, .month, .day], from: items[0].startsAt), sessions: items)
        }
    }
}

enum NowNext {
    /// Open-ended sessions (null `endsAt`) count as "now" for this long after they start.
    static let openEndedGrace: TimeInterval = 30 * 60

    static func compute(_ sessions: [HacklantaSession], now: Date) -> (now: [HacklantaSession], next: HacklantaSession?) {
        let live = sessions.filter { $0.status != .cancelled }
        let current = live.filter { s in
            s.startsAt <= now && now < (s.endsAt ?? s.startsAt.addingTimeInterval(openEndedGrace))
        }.sorted { $0.startsAt < $1.startsAt }
        let next = live.filter { $0.startsAt > now }.min { $0.startsAt < $1.startsAt }
        return (current, next)
    }
}

enum SessionFilter: String, CaseIterable, Identifiable {
    case all, food, workshops, activities, ceremonies
    var id: String { rawValue }
    var label: String {
        switch self { case .all: "All"; case .food: "Food"; case .workshops: "Workshops"; case .activities: "Activities"; case .ceremonies: "Ceremonies" }
    }
    func matches(_ s: HacklantaSession) -> Bool {
        switch self {
        case .all: true
        case .food: s.kind == .food
        case .workshops: s.kind == .workshop
        case .activities: [.activity, .social].contains(s.kind)
        case .ceremonies: [.ceremony, .milestone].contains(s.kind)
        }
    }
}
