// Canonical discriminated-union return shape for every server action.
// Mirrors docs/05-backend-api.md §3 and docs/07-implementation-plan.md conventions.

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "INVALID_INPUT",
  "NOT_FOUND",
  "CONFLICT",
  "DOMAIN_NOT_ALLOWED",
  "OTP_EXPIRED",
  "OTP_INVALID",
  "OTP_LOCKED",
  "EMAIL_TAKEN",
  "RESUME_TOO_LARGE",
  "RESUME_BAD_MIME",
  "AVATAR_TOO_LARGE",
  "AVATAR_BAD_MIME",
  "STORAGE_OBJECT_MISSING",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        field?: string;
        retryAfterMs?: number;
        attemptsRemaining?: number;
      };
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function err(
  code: ErrorCode,
  message: string,
  extra?: {
    field?: string;
    retryAfterMs?: number;
    attemptsRemaining?: number;
  }
): ActionResult<never> {
  return { ok: false, error: { code, message, ...extra } };
}
