import CryptoKit
import Foundation
import Security

/// Sign in with Apple replay protection: Apple receives SHA256(nonce), Supabase receives the raw nonce
/// and verifies the hash embedded in the ID token.
enum Nonce {
    static let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")

    static func random(length: Int = 32) -> String {
        precondition(length > 0)
        var bytes = [UInt8](repeating: 0, count: length)
        let status = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        if status != errSecSuccess {
            // SecRandom failing is not recoverable in a meaningful way; fall back to the system CSPRNG.
            var rng = SystemRandomNumberGenerator()
            bytes = (0..<length).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
        }
        // 256 is divisible by 64, so modulo introduces no bias.
        return String(bytes.map { charset[Int($0) % charset.count] })
    }

    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
