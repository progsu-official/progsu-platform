import SwiftUI

struct PointsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var state: Loadable<PointsSummary> = .idle
    @State private var entries: [PointsEntry] = []
    @State private var cursor: String?

    var body: some View {
        List {
            switch state {
            case .idle, .loading: LoadingView().listRowBackground(Color.clear)
            case .failed(let e, _, _): StateMessage.error(e) { Task { await load() } }.listRowBackground(Color.clear)
            case .loaded(let s, _):
                Section {
                    VStack(alignment: .leading) {
                        Eyebrow("Balance")
                        Text("\(s.balance)").font(.system(size: 48, weight: .bold)).monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                }
                .listRowBackground(theme.glassFill)
                Section("History") {
                    if entries.isEmpty {
                        Text("No points yet. Check in at events to earn them.").foregroundStyle(theme.mutedForeground)
                    }
                    ForEach(entries) { e in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(e.label)
                                Text(e.createdAt.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(theme.mutedForeground)
                            }
                            Spacer()
                            Text(e.amount > 0 ? "+\(e.amount)" : "\(e.amount)")
                                .font(.headline).monospacedDigit()
                                .foregroundStyle(e.amount >= 0 ? theme.success : theme.destructive)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if cursor != nil { ProgressView().task { await more() } }
                }
                .listRowBackground(theme.glassFill)
            }
        }
        .progsuScreen()
        .navigationTitle("Points")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let s = try await model.api.points()
            entries = s.items; cursor = s.nextCursor; state = .loaded(s)
        } catch let e as APIError { if case .cancelled = e { return }; state = .failed(e) } catch {}
    }

    private func more() async {
        guard let c = cursor else { return }
        if let s = try? await model.api.points(cursor: c) { entries += s.items; cursor = s.nextCursor } else { cursor = nil }
    }
}
