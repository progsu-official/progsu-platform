import "server-only";

import type { ErrorCode } from "@/lib/actions/result";
import { ApiError, type ApiErrorCode } from "./http";

// Maps shared domain ActionResult errors (web codes) onto the mobile envelope.
const MAP: Partial<Record<ErrorCode, ApiErrorCode>> = {
  UNAUTHORIZED: "unauthenticated",
  FORBIDDEN: "forbidden",
  RATE_LIMITED: "rate_limited",
  OTP_LOCKED: "rate_limited",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  EMAIL_TAKEN: "conflict",
  ACCOUNT_EXISTS: "conflict",
  INTERNAL: "internal",
};

export function actionErrorToApi(error: {
  code: ErrorCode;
  message: string;
  field?: string;
  retryAfterMs?: number;
}): ApiError {
  const code = MAP[error.code] ?? "invalid_input";
  return new ApiError(code, code === "internal" ? "Something went wrong." : error.message, {
    field: error.field,
    retryAfterMs: error.retryAfterMs,
  });
}
