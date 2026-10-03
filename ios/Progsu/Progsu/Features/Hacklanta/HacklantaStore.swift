import Foundation
import Observation

/// Shared Hacklanta data so the schedule, map, agenda and deep-linked sessions read one snapshot.
@MainActor
@Observable
final class HacklantaStore {
    static let shared = HacklantaStore()

    var state: Loadable<HacklantaGuide> = .idle
    var bookmarks: Set<String> = []
    var bookmarkError: String?

    func load(api: ProgsuAPI, cache: DiskCache, signedIn: Bool) async {
        if state.value == nil {
            if let snap = await cache.load(HacklantaGuide.self, key: "hacklanta", scope: .public) {
                state = .loaded(snap.value, savedAt: snap.savedAt)
            } else {
                state = .loading
            }
        }
        do {
            let edition = try await api.hacklanta()
            state = .loaded(edition)
            await cache.save(edition, key: "hacklanta", scope: .public)
        } catch let e as APIError {
            if case .cancelled = e { return }
            let snap = await cache.load(HacklantaGuide.self, key: "hacklanta", scope: .public)
            state = .failed(e, cached: snap?.value, savedAt: snap?.savedAt)
        } catch {}
        if signedIn {
            if let b = try? await api.bookmarks() { bookmarks = Set(b.sessionIds) }
        } else {
            bookmarks = []
        }
    }

    func toggle(_ id: String, api: ProgsuAPI) async {
        let on = !bookmarks.contains(id)
        if on { bookmarks.insert(id) } else { bookmarks.remove(id) }
        bookmarkError = nil
        do {
            try await api.setBookmark(sessionId: id, on: on)
        } catch let e as APIError {
            if on { bookmarks.remove(id) } else { bookmarks.insert(id) }
            bookmarkError = e.userMessage
        } catch {}
    }
}
