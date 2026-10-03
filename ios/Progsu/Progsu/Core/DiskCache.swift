import Foundation

/// JSON snapshot cache in Application Support with `completeUntilFirstUserAuthentication` protection.
/// Public data (config, Hacklanta schedule) and personal data (pass, my events) live in separate
/// directories so logout can purge personal data without dropping the offline schedule.
actor DiskCache {
    enum Scope: String, Sendable { case `public`, user }

    struct Snapshot<T: Sendable>: Sendable {
        let value: T
        let savedAt: Date
    }

    static let shared = DiskCache()

    private let root: URL
    private let decoder = JSONCoding.decoder()
    private let encoder = JSONCoding.encoder()

    init(root: URL? = nil) {
        let base = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ProgsuCache", isDirectory: true)
        self.root = base
    }

    private func dir(_ scope: Scope) throws -> URL {
        let url = root.appendingPathComponent(scope.rawValue, isDirectory: true)
        if !FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutable = url
            try? mutable.setResourceValues(values)
        }
        return url
    }

    func save<T: Encodable & Sendable>(_ value: T, key: String, scope: Scope) {
        do {
            let url = try dir(scope).appendingPathComponent("\(key).json")
            let wrapper = Stored(savedAt: Date(), value: value)
            try encoder.encode(wrapper).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            // Cache writes are best-effort; a failure only costs offline availability.
        }
    }

    func load<T: Decodable & Sendable>(_ type: T.Type, key: String, scope: Scope) -> Snapshot<T>? {
        guard let url = try? dir(scope).appendingPathComponent("\(key).json"),
              let data = try? Data(contentsOf: url),
              let stored = try? decoder.decode(Stored<T>.self, from: data) else { return nil }
        return Snapshot(value: stored.value, savedAt: stored.savedAt)
    }

    func purge(_ scope: Scope) {
        guard let url = try? dir(scope) else { return }
        try? FileManager.default.removeItem(at: url)
    }

}

private struct Stored<T> {
    let savedAt: Date
    let value: T
}
extension Stored: Encodable where T: Encodable {}
extension Stored: Decodable where T: Decodable {}
