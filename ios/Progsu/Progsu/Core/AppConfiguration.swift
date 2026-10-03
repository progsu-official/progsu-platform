import Foundation

/// Build-time configuration injected from xcconfig through Info.plist.
struct AppConfiguration: Sendable {
    let supabaseURL: URL?
    let supabaseAnonKey: String
    let apiBaseURL: URL
    let universalLinkHost: String

    static let authCallbackURL = URL(string: "progsu://auth-callback")!

    static let current: AppConfiguration = {
        let info = Bundle.main.infoDictionary ?? [:]
        func string(_ key: String) -> String {
            (info[key] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        }
        let supa = string("ProgsuSupabaseURL")
        let api = string("ProgsuAPIBaseURL")
        return AppConfiguration(
            supabaseURL: supa.isEmpty ? nil : URL(string: supa),
            supabaseAnonKey: string("ProgsuSupabaseAnonKey"),
            apiBaseURL: URL(string: api.isEmpty ? "https://members.progsu.com" : api)!,
            universalLinkHost: string("ProgsuUniversalLinkHost").isEmpty ? "members.progsu.com" : string("ProgsuUniversalLinkHost")
        )
    }()

    var mobileAPIBase: URL { apiBaseURL.appendingPathComponent("api/mobile/v1") }
    var isAuthConfigured: Bool { supabaseURL != nil && !supabaseAnonKey.isEmpty }
}
