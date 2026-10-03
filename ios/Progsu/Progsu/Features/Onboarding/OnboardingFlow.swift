import SwiftUI

/// Hard gates mirror lib/auth/onboarding.ts: profile fields, then current consents.
/// School email verification is offered afterwards and can be skipped (it is soft on the web too).
struct OnboardingFlow: View {
    @Environment(AppModel.self) private var model
    @State private var showEmailStep = false

    var body: some View {
        NavigationStack {
            Group {
                switch model.me?.onboarding.nextStep {
                case "consent": ConsentStep()
                default: ProfileStep()
                }
            }
            .progsuScreen()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Sign out") { Task { await model.signOut() } }
                }
            }
        }
        .interactiveDismissDisabled()
    }
}

struct ProfileStep: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var first = ""
    @State private var last = ""
    @State private var affiliation: AffiliationKind = .gsuStudent
    @State private var school = ""
    @State private var major = ""
    @State private var phone = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Text("Tell us who you are").font(.title2.weight(.bold))
                Text("Officers use this to plan events. Your phone is never shown to other members.")
                    .font(.subheadline).foregroundStyle(theme.mutedForeground)
            }.listRowBackground(Color.clear)
            Section("Name") {
                TextField("First name", text: $first).textContentType(.givenName)
                TextField("Last name", text: $last).textContentType(.familyName)
            }
            Section("Affiliation") {
                Picker("I am", selection: $affiliation) {
                    Text("A Georgia State student").tag(AffiliationKind.gsuStudent)
                    Text("A student at another school").tag(AffiliationKind.otherStudent)
                    Text("Not a student").tag(AffiliationKind.nonstudent)
                }
                .pickerStyle(.inline)
                .labelsHidden()
                if affiliation == .otherStudent {
                    TextField("School name", text: $school).textContentType(.organizationName)
                }
                if affiliation != .nonstudent {
                    TextField("Major", text: $major)
                }
            }
            Section("Phone") {
                TextField("Phone number", text: $phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
            }
            Section {
                Button { Task { await save() } } label: { if busy { ProgressView() } else { Text("Continue") } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!valid || busy)
                if let error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(theme.destructive).font(.footnote) }
            }.listRowBackground(Color.clear)
        }
        .navigationTitle("Your profile")
        .onAppear {
            guard let me = model.me else { return }
            first = me.firstName ?? ""; last = me.lastName ?? ""
            affiliation = me.affiliation == .unknown ? .gsuStudent : me.affiliation
            school = me.affiliation == .otherStudent ? (me.school ?? "") : ""
            major = me.major == "other" ? (me.majorOtherText ?? "") : ""
            phone = me.phoneNumber ?? ""
        }
    }

    private var valid: Bool {
        !first.trimmed.isEmpty && !last.trimmed.isEmpty && phone.filter(\.isNumber).count >= 10
            && (affiliation != .otherStudent || !school.trimmed.isEmpty)
            && (affiliation == .nonstudent || !major.trimmed.isEmpty)
    }

    private func save() async {
        busy = true; error = nil
        defer { busy = false }
        // Majors are slugs from a server table with no mobile endpoint yet, so the app submits the
        // reserved "other" slug plus free text, which the web schema accepts.
        let student = affiliation != .nonstudent
        let patch = ProfilePatch(firstName: first.trimmed, lastName: last.trimmed, affiliation: affiliation,
                                 school: student ? (affiliation == .gsuStudent ? "Georgia State University" : school.trimmed) : nil,
                                 major: student ? "other" : nil, majorOtherText: student ? major.trimmed : nil,
                                 phoneNumber: phone.trimmed)
        do { model.me = try await model.api.updateProfile(patch) }
        catch let e as APIError { error = e.userMessage } catch {}
    }
}

struct ConsentStep: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @State private var privacy = false
    @State private var terms = false
    @State private var adult = false
    @State private var busy = false
    @State private var error: String?

    private func version(_ type: String) -> String { model.me?.consentVersions[type] ?? "" }
    private func site(_ path: String) -> URL { URL(string: "https://\(model.configuration.universalLinkHost)\(path)")! }

    var body: some View {
        Form {
            Section {
                Text("Review and accept").font(.title2.weight(.bold))
                Text("These are the same terms as the Progsu website. Read each one before accepting.")
                    .font(.subheadline).foregroundStyle(theme.mutedForeground)
            }.listRowBackground(Color.clear)
            Section {
                Toggle("I accept the Privacy Policy \(version("privacy_policy"))", isOn: $privacy)
                Link("Read the Privacy Policy", destination: site("/privacy")).font(.footnote)
                Toggle("I accept the Terms of Service \(version("terms_of_service"))", isOn: $terms)
                Link("Read the Terms of Service", destination: site("/terms")).font(.footnote)
                Toggle("I confirm I am 18 or older", isOn: $adult)
            }
            Section {
                Button { Task { await submit() } } label: { if busy { ProgressView() } else { Text("Accept and continue") } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || !(privacy && terms && adult))
                if let error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(theme.destructive).font(.footnote) }
            }.listRowBackground(Color.clear)
        }
        .navigationTitle("Consent")
    }

    private func submit() async {
        busy = true; error = nil
        defer { busy = false }
        let body = ConsentAcceptance(acceptances: ["privacy_policy": privacy, "terms_of_service": terms, "age_confirmation": adult])
        do {
            _ = try await model.api.acceptConsents(body)
            await model.refreshMe()
        } catch let e as APIError { error = e.userMessage } catch {}
    }
}

/// Soft step: proves a school email with an emailed one-time code. Reachable from Profile.
struct StudentEmailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var sent = false
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        Form {
            Section {
                Text("Verify your school email").font(.title3.weight(.bold))
                Text("We email a 6-digit code. Verification is optional but needed for recruiter-facing features.")
                    .font(.subheadline).foregroundStyle(theme.mutedForeground)
            }
            Section {
                TextField("you@student.gsu.edu", text: $email)
                    .textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .disabled(sent)
                if sent {
                    TextField("6-digit code", text: $code).textContentType(.oneTimeCode).keyboardType(.numberPad)
                        .monospacedDigit()
                }
            }
            Section {
                Button(sent ? "Verify code" : "Send code") { Task { await go() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || (sent ? code.filter(\.isNumber).count < 6 : !email.contains("@")))
                if sent { Button("Use a different email") { sent = false; code = "" } }
                if let message { Text(message).font(.footnote) }
            }
        }
        .progsuScreen()
        .navigationTitle("School email")
    }

    private func go() async {
        busy = true; message = nil
        defer { busy = false }
        do {
            if sent {
                _ = try await model.api.verifyStudentEmail(email.trimmed, code: code.filter(\.isNumber))
                await model.refreshMe()
                dismiss()
            } else {
                let r = try await model.api.startStudentEmail(email.trimmed)
                sent = true
                message = "Code sent. It expires at \(r.expiresAt.formatted(date: .omitted, time: .shortened))."
            }
        } catch let e as APIError { message = e.userMessage } catch {}
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
