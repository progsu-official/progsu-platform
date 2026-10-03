import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, sign } from "node:crypto";

// AES-256-GCM envelope: v1.<iv>.<tag>.<ciphertext>, each base64url.
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, key: Buffer): string {
  const [v, iv, tag, ct] = envelope.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// ES256 JWT (Apple client secrets and APNs provider tokens).
export function signEs256Jwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKeyPem: string
): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${enc({ alg: "ES256", ...header })}.${enc(claims)}`;
  const sig = sign("sha256", Buffer.from(input), { key: privateKeyPem, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}
