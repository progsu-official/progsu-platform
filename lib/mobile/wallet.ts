import "server-only";

import { deflateSync } from "node:zlib";

import { PKPass } from "passkit-generator";

import { walletConfig } from "@/lib/env";

// Apple Wallet event ticket. The barcode carries only the opaque per-RSVP pass
// token from issue_event_pass() (never a name, email or user id); staff scan
// it with mobile_staff_scan, which resolves it by SHA-256.

export function walletConfigured(): boolean {
  return walletConfig() !== null;
}

// Solid-color PNG so the pass has its required icon without shipping an asset.
function solidPng(size: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export type WalletPassInput = {
  serial: string;
  token: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  locationText: string | null;
  attendeeFirstName: string | null;
};

export function buildEventPass(input: WalletPassInput): Buffer {
  const cfg = walletConfig();
  if (!cfg) throw new Error("wallet not configured");
  const brand: [number, number, number] = [36, 99, 235];
  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeId,
    teamIdentifier: cfg.teamId,
    serialNumber: input.serial,
    organizationName: "Progsu",
    description: `Progsu ticket: ${input.eventTitle}`.slice(0, 120),
    backgroundColor: "rgb(36,99,235)",
    foregroundColor: "rgb(255,255,255)",
    labelColor: "rgb(219,234,254)",
    relevantDate: input.startsAt,
    expirationDate: new Date(Date.parse(input.endsAt) + 6 * 3600_000).toISOString(),
    eventTicket: {
      primaryFields: [{ key: "event", label: "EVENT", value: input.eventTitle }],
      secondaryFields: [
        {
          key: "starts",
          label: "STARTS",
          value: input.startsAt,
          dateStyle: "PKDateStyleMedium",
          timeStyle: "PKDateStyleShort",
        },
      ],
      auxiliaryFields: [
        ...(input.locationText ? [{ key: "where", label: "WHERE", value: input.locationText }] : []),
        ...(input.attendeeFirstName ? [{ key: "name", label: "ATTENDEE", value: input.attendeeFirstName }] : []),
      ],
      backFields: [
        {
          key: "about",
          label: "About this pass",
          value: "Show this code at the door. Re-downloading the pass replaces this one and retires its code.",
        },
      ],
    },
  };
  const pass = new PKPass(
    {
      "pass.json": Buffer.from(JSON.stringify(passJson)),
      "icon.png": solidPng(29, brand),
      "icon@2x.png": solidPng(58, brand),
      "icon@3x.png": solidPng(87, brand),
    },
    {
      wwdr: cfg.wwdr,
      signerCert: cfg.signerCert,
      signerKey: cfg.signerKey,
      signerKeyPassphrase: cfg.signerKeyPassphrase,
    }
  );
  pass.setBarcodes({
    message: input.token,
    format: "PKBarcodeFormatQR",
    messageEncoding: "iso-8859-1",
  });
  return pass.getAsBuffer();
}
