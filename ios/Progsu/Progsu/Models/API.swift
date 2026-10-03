import Foundation

// Swift mirror of lib/mobile/contracts.ts. Field names and optionality follow the zod schemas:
// `.nullable()` -> Optional, everything else required, so contract drift fails decoding in tests.
// Server enums that may grow decode unknown values to a fallback case instead of failing.

struct Page<Item: Codable & Sendable & Hashable>: Codable, Sendable, Hashable {
    let items: [Item]
    let nextCursor: String?
}

/// `{items: [...]}` without a cursor (staff events, roster, my events).
struct ItemList<Item: Codable & Sendable & Hashable>: Codable, Sendable, Hashable {
    let items: [Item]
}

// MARK: - Config

enum ThemeOverride: String, Codable, Sendable {
    case auto
    case forceOn = "force_on"
    case forceOff = "force_off"
}

struct HacklantaEditionSummary: Codable, Sendable, Hashable {
    let slug: String
    let name: String
    let startsAt: Date
    let endsAt: Date
    let timeZone: String
    let themeOverride: ThemeOverride
    /// Server's evaluation at response time. The client re-evaluates locally so the switch happens on time
    /// without a refetch; both use the same rule.
    let themeActive: Bool
    let scheduleTentative: Bool
}

struct FeatureSwitches: Codable, Sendable, Hashable {
    let events: Bool
    let hacklanta: Bool
    let wallet: Bool
    let push: Bool
    let appleRevocation: Bool
}

struct AppConfig: Codable, Sendable, Hashable {
    let minSupportedBuild: Int
    let features: FeatureSwitches
    let hacklanta: HacklantaEditionSummary?
}

// MARK: - Me

enum AffiliationKind: String, Codable, Sendable, CaseIterable {
    case gsuStudent = "gsu_student"
    case otherStudent = "other_student"
    case nonstudent
    case unknown
    init(from decoder: Decoder) throws {
        self = AffiliationKind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

struct OnboardingState: Codable, Sendable, Hashable {
    let fullyOnboarded: Bool
    /// `OnboardingStep` from lib/auth/onboarding.ts: hard chain is profile -> consent -> nil.
    let nextStep: String?
    let profileFieldsComplete: Bool
    let requiredConsentsCurrent: Bool
    let studentEmailVerified: Bool
    let hasCurrentResume: Bool
}

struct StaffAssignment: Codable, Sendable, Hashable, Identifiable {
    let eventId: String
    let expiresAt: Date?
    var id: String { eventId }
}

struct Me: Codable, Sendable, Hashable {
    let id: String
    let email: String
    let firstName: String?
    let lastName: String?
    let preferredName: String?
    let avatarUrl: String?
    let phoneNumber: String?
    let affiliation: AffiliationKind
    let institutionName: String?
    let school: String?
    let major: String?
    let majorOtherText: String?
    let studentEmail: String?
    let studentEmailVerified: Bool
    let verifiedGsu: Bool
    let isAdmin: Bool
    let onboarding: OnboardingState
    /// consent_type -> current version string.
    let consentVersions: [String: String]
    let staffAssignments: [StaffAssignment]
    let pointsBalance: Int

    var isStaff: Bool { !staffAssignments.isEmpty }
    var nameForDisplay: String {
        if let preferredName, !preferredName.isEmpty { return [preferredName, lastName].compactMap { $0 }.joined(separator: " ") }
        let joined = [firstName, lastName].compactMap { $0 }.joined(separator: " ")
        return joined.isEmpty ? email : joined
    }
}

/// `updateProfileBody` is `.partial().strict()`: nil fields are omitted by the synthesized encoder.
struct ProfilePatch: Codable, Sendable {
    var firstName: String?
    var lastName: String?
    var preferredName: String?
    var affiliation: AffiliationKind?
    var institutionName: String?
    var school: String?
    var major: String?
    var majorOtherText: String?
    var phoneNumber: String?
}

struct ConsentAcceptance: Codable, Sendable { let acceptances: [String: Bool] }
struct ConsentResult: Codable, Sendable, Hashable { let recorded: [String] }

enum ConsentTypes {
    /// REQUIRED_CONSENT_TYPES in lib/actions/consent-schemas.ts.
    static let required = ["privacy_policy", "terms_of_service", "age_confirmation"]
}

struct StudentEmailStart: Codable, Sendable { let studentEmail: String }
struct StudentEmailStartResult: Codable, Sendable, Hashable { let expiresAt: Date }
struct StudentEmailVerify: Codable, Sendable { let studentEmail: String; let code: String }
struct StudentEmailVerifyResult: Codable, Sendable, Hashable { let studentEmail: String; let verifiedAt: Date }
struct AppleAuthorization: Codable, Sendable { let authorizationCode: String }
struct DeleteAccountRequest: Codable, Sendable { let confirm: String }
struct DeleteAccountResult: Codable, Sendable, Hashable { let status: String; let deletedAt: Date }

// MARK: - Events

enum RSVPStatus: String, Codable, Sendable {
    case going, waitlisted, declined, cancelled
    case unknown
    init(from decoder: Decoder) throws {
        self = RSVPStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

struct EventSummary: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let slug: String
    let title: String
    let startsAt: Date
    let endsAt: Date
    let timeZone: String
    let locationText: String?
    let coverImageUrl: String?
    let capacity: Int?
    let goingCount: Int
    let waitlistEnabled: Bool
    let externalUrl: String?
    let pinned: Bool
}

struct EventHost: Codable, Sendable, Hashable { let displayName: String }

struct ViewerEventState: Codable, Sendable, Hashable {
    let rsvpStatus: RSVPStatus?
    let checkedInAt: Date?
    let pointsAvailable: Int?
    let pointsEarned: Int
    let isStaff: Bool
    var checkedIn: Bool { checkedInAt != nil }
}

enum EventStatus: String, Codable, Sendable {
    case published, cancelled, archived
}

struct EventDetail: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let slug: String
    let title: String
    let startsAt: Date
    let endsAt: Date
    let timeZone: String
    let locationText: String?
    let coverImageUrl: String?
    let capacity: Int?
    let goingCount: Int
    let waitlistEnabled: Bool
    let externalUrl: String?
    let pinned: Bool
    let descriptionMd: String?
    let locationUrl: String?
    let waitlistedCount: Int
    let hosts: [EventHost]
    let status: EventStatus
    let viewer: ViewerEventState?

    /// The contract has no explicit flag; the server enforces the real rule in `rsvp_to_event`.
    func rsvpOpen(now: Date = Date()) -> Bool { status == .published && endsAt > now }
}

struct RSVPRequest: Codable, Sendable { let desired: String }
struct RSVPResult: Codable, Sendable, Hashable { let effectiveStatus: RSVPStatus }

struct MyEvent: Codable, Sendable, Hashable, Identifiable {
    let event: EventSummary
    let rsvpStatus: RSVPStatus?
    let checkedInAt: Date?
    var id: String { event.id }
}

struct CheckInPass: Codable, Sendable, Hashable {
    let qrPayload: String
    let shortCode: String
}

// MARK: - Points

struct PointsEntry: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let amount: Int
    let kind: String
    let eventId: String?
    let eventTitle: String?
    let reason: String?
    let createdAt: Date

    var label: String {
        if let reason, !reason.isEmpty { return reason }
        if let eventTitle { return kind == "reversal" ? "Reversed: \(eventTitle)" : eventTitle }
        return kind == "adjustment" ? "Adjustment" : "Points"
    }
}

struct PointsSummary: Codable, Sendable, Hashable {
    let balance: Int
    let items: [PointsEntry]
    let nextCursor: String?
}

// MARK: - Announcements

struct Announcement: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let title: String
    let body: String
    let audience: String
    let eventId: String?
    let priority: String
    let deepLink: String?
    let publishedAt: Date
    let expiresAt: Date?
    let read: Bool?

    var isImportant: Bool { priority == "important" }
}

// MARK: - Devices

struct DeviceRegistration: Codable, Sendable {
    let token: String
    /// "sandbox" | "production"
    let env: String
}

// MARK: - Hacklanta

struct HacklantaGuideEdition: Codable, Sendable, Hashable {
    let slug: String
    let name: String
    let startsAt: Date
    let endsAt: Date
    let timeZone: String
    let themeOverride: ThemeOverride
    let themeActive: Bool
    let scheduleTentative: Bool
    let venueName: String?
    let venueAddress: String?
    let lat: Double?
    let lng: Double?
    let publishedAt: Date
}

struct HacklantaFloor: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let name: String
    let sort: Int
    let imageUrl: String?
    let version: Int
}

struct HacklantaRoom: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let floorId: String?
    let name: String
    let kind: String
    let description: String?
    let x: Double?
    let y: Double?
}

enum SessionKind: String, Codable, Sendable, CaseIterable {
    case logistics, ceremony, activity, sponsor, food, milestone, help, social, workshop
    case other
    init(from decoder: Decoder) throws {
        self = SessionKind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
    }
    var label: String {
        switch self {
        case .logistics: "Logistics"; case .ceremony: "Ceremony"; case .activity: "Activity"
        case .sponsor: "Sponsor"; case .food: "Food"; case .milestone: "Milestone"; case .help: "Help"
        case .social: "Social"; case .workshop: "Workshop"; case .other: "Other"
        }
    }
    var systemImage: String {
        switch self {
        case .logistics: "info.circle"; case .ceremony: "music.mic"; case .activity: "gamecontroller"
        case .sponsor: "building.2"; case .food: "fork.knife"; case .milestone: "flag.checkered"
        case .help: "questionmark.circle"; case .social: "person.3"; case .workshop: "hammer"; case .other: "circle"
        }
    }
}

enum SessionStatus: String, Codable, Sendable {
    case scheduled, cancelled, moved
}

struct HacklantaSession: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let key: String
    let title: String
    let description: String?
    let kind: SessionKind
    let track: String?
    let roomId: String?
    let roomLabel: String?
    let startsAt: Date
    /// Null for open-ended items ("Starts 9:00 PM").
    let endsAt: Date?
    let status: SessionStatus
    /// Informational only; never presented as a guaranteed award.
    let pointsNote: String?
    let updatedAt: Date
}

struct HacklantaGuide: Codable, Sendable, Hashable {
    let edition: HacklantaGuideEdition
    let floors: [HacklantaFloor]
    let rooms: [HacklantaRoom]
    let sessions: [HacklantaSession]

    /// Room names for the map list: published rooms if any, else distinct session room labels.
    var roomLabels: [String] {
        if !rooms.isEmpty { return rooms.map(\.name) }
        var seen = Set<String>()
        return sessions.compactMap { $0.roomLabel?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    func roomName(for s: HacklantaSession) -> String? {
        s.roomLabel ?? rooms.first { $0.id == s.roomId }?.name
    }
}

struct HacklantaBookmarks: Codable, Sendable, Hashable { let sessionIds: [String] }

struct HacklantaTeam: Codable, Sendable, Hashable {
    let name: String?
    let memberFirstNames: [String]
}

struct HacklantaApplication: Codable, Sendable, Hashable {
    let status: String
    let attendanceConfirmed: Bool
    let team: HacklantaTeam?
}

struct HacklantaMe: Codable, Sendable, Hashable {
    let linked: Bool
    let application: HacklantaApplication?
}

struct HacklantaLinkStart: Codable, Sendable { let email: String }
struct HacklantaLinkVerify: Codable, Sendable { let code: String }

// MARK: - Staff

struct StaffEvent: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let slug: String
    let title: String
    let startsAt: Date
    let endsAt: Date
    let status: String
    let assignmentExpiresAt: Date?
    let goingCount: Int
    let checkedInCount: Int
}

enum ScanResult: String, Codable, Sendable, CaseIterable {
    case checkedIn = "checked_in"
    case alreadyCheckedIn = "already_checked_in"
    case wrongEvent = "wrong_event"
    case revoked
    case notRsvpd = "not_rsvpd"
    case outsideWindow = "outside_window"
    case invalidCode = "invalid_code"
}

struct ScanAttendee: Codable, Sendable, Hashable {
    let displayName: String
    let kind: String
}

struct ScanResponse: Codable, Sendable, Hashable {
    let result: ScanResult
    let attendee: ScanAttendee?
    let pointsAwarded: Int
    let checkedInAt: Date?
}

struct ScanRequest: Codable, Sendable { let code: String }

struct RosterEntry: Codable, Sendable, Hashable, Identifiable {
    let userId: String
    let displayName: String
    let rsvpStatus: RSVPStatus
    let checkedIn: Bool
    let checkedInAt: Date?
    var id: String { userId }
}

struct ManualCheckInRequest: Codable, Sendable { let userId: String; let reason: String }
