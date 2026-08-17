import "server-only";

import { render } from "@react-email/render";
import { Resend } from "resend";

export interface SendEmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  // Set to embed inline (referenced via `cid:` in the HTML) instead of a
  // regular downloadable attachment. See EventRsvpConfirmationEmail's QR.
  contentId?: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  react: React.ReactElement;
  text: string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
  attachments?: SendEmailAttachment[];
}

export type SendEmailResult =
  | { ok: true; id: string; transport: "resend" | "log" }
  | { ok: false; code: "RESEND_ERROR" | "CONFIG_ERROR"; message: string };

// In local dev / CI the RESEND_API_KEY is absent; we fall back to a log transport
// so the OTP flow can be exercised end-to-end without real email delivery. Prod
// must set RESEND_API_KEY + RESEND_FROM_EMAIL.
export async function sendEmail(
  input: SendEmailInput
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "dev@progsu.local";
  const html = await render(input.react);

  if (!apiKey) {
    // Log transport — visible in `pnpm dev` output and in integration tests.
    // Do NOT log the plaintext in production.
    const fakeId = `dev_${Date.now().toString(36)}`;
    console.log("[email:log] to=%s subject=%s id=%s", input.to, input.subject, fakeId);
    console.log("[email:log] text preview:\n%s", input.text);
    return { ok: true, id: fakeId, transport: "log" };
  }

  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      react: input.react,
      text: input.text,
      html,
      headers: input.idempotencyKey
        ? { "Idempotency-Key": input.idempotencyKey }
        : undefined,
      tags: input.tags
        ? Object.entries(input.tags).map(([name, value]) => ({ name, value }))
        : undefined,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        contentId: a.contentId,
      })),
    });
    if (error || !data) {
      return {
        ok: false,
        code: "RESEND_ERROR",
        message: error?.message ?? "unknown resend error",
      };
    }
    return { ok: true, id: data.id, transport: "resend" };
  } catch (err) {
    return {
      ok: false,
      code: "RESEND_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
