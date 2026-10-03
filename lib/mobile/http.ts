import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Envelope + error plumbing for /api/mobile/v1 (docs/ios/API.md).

export const API_ERROR_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  rate_limited: 429,
  not_onboarded: 403,
  feature_off: 404,
  unavailable: 503,
  internal: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly extra: { retryAfterMs?: number; field?: string } = {}
  ) {
    super(message);
  }
}

export function fail(code: ApiErrorCode, message: string, extra?: ApiError["extra"]): never {
  throw new ApiError(code, message, extra);
}

type PgLikeError = { code?: string | null; message?: string | null } | null | undefined;

// Raised messages from our SECURITY DEFINER helpers look like
// "fn_name: human text". Only the human part is safe to show.
function stripFnPrefix(message: string): string {
  const m = message.match(/^[a-z_][a-z0-9_]*: (.+)$/);
  return (m ? m[1] : message).slice(0, 200);
}

export function pgError(error: PgLikeError): ApiError {
  const code = error?.code ?? "";
  const raw = error?.message ?? "";
  const lower = raw.toLowerCase();
  if (code === "P0002") return new ApiError("not_found", stripFnPrefix(raw) || "Not found.");
  if (code === "23505") return new ApiError("conflict", "That already exists.");
  if (code === "42501") return new ApiError("forbidden", "Not allowed.");
  if (code === "P0001") {
    if (lower.includes("rate limited")) return new ApiError("rate_limited", "Too many requests.");
    if (lower.includes("event is full")) return new ApiError("conflict", "This event is full.");
    if (lower.includes("not fully onboarded")) return new ApiError("not_onboarded", "Finish onboarding first.");
    if (
      lower.includes("admin only") ||
      lower.includes("not event staff") ||
      lower.includes("unauthenticated") ||
      lower.includes("not visible") ||
      lower.includes("service_role only")
    ) {
      return new ApiError("forbidden", stripFnPrefix(raw));
    }
    return new ApiError("invalid_input", stripFnPrefix(raw));
  }
  return new ApiError("internal", "Something went wrong.");
}

export type RouteContext = {
  req: NextRequest;
  requestId: string;
  params: Record<string, string>;
};

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, requestId: string, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(
    { ok: true, data },
    {
      status: init?.status ?? 200,
      headers: { ...NO_STORE, "X-Request-Id": requestId, ...(init?.headers ?? {}) },
    }
  );
}

export function errorResponse(e: ApiError, requestId: string) {
  const headers: Record<string, string> = { ...NO_STORE, "X-Request-Id": requestId };
  if (e.code === "rate_limited" && e.extra.retryAfterMs) {
    headers["Retry-After"] = String(Math.ceil(e.extra.retryAfterMs / 1000));
  }
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: e.code,
        message: e.message,
        ...(e.extra.field ? { field: e.extra.field } : {}),
        ...(e.extra.retryAfterMs ? { retryAfterMs: e.extra.retryAfterMs } : {}),
      },
      requestId,
    },
    { status: API_ERROR_STATUS[e.code], headers }
  );
}

// Wraps a route handler: kill switch first (before any auth work), request id,
// and a catch-all that never leaks internal error text.
export function mobileRoute(
  name: string,
  handler: (ctx: RouteContext) => Promise<Response>
) {
  return async (
    req: NextRequest,
    segment: { params: Promise<Record<string, string | string[]>> }
  ): Promise<Response> => {
    const requestId = randomUUID();
    if (!env.FEATURE_MOBILE_API) {
      return errorResponse(new ApiError("feature_off", "Not available."), requestId);
    }
    const start = Date.now();
    try {
      const rawParams = (await segment?.params) ?? {};
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawParams)) {
        params[k] = Array.isArray(v) ? v.join("/") : v;
      }
      const res = await handler({ req, requestId, params });
      log.info("mobile api", { action: name, request_id: requestId, duration_ms: Date.now() - start, ok: true });
      return res;
    } catch (e) {
      if (e instanceof ApiError) {
        log.warn("mobile api error", {
          action: name,
          request_id: requestId,
          duration_ms: Date.now() - start,
          ok: false,
          error_code: e.code,
        });
        return errorResponse(e, requestId);
      }
      log.error("mobile api threw", {
        action: name,
        request_id: requestId,
        duration_ms: Date.now() - start,
        ok: false,
        error_code: "internal",
        error_message: e instanceof Error ? e.message : String(e),
      });
      return errorResponse(new ApiError("internal", "Something went wrong."), requestId);
    }
  };
}

export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 64 * 1024) fail("invalid_input", "Body too large.");
    body = text.length === 0 ? {} : JSON.parse(text);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    fail("invalid_input", "Body must be JSON.");
  }
  return parseOr400(schema, body);
}

export function parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail("invalid_input", issue?.message ?? "Invalid input.", {
      field: issue?.path.join(".") || undefined,
    });
  }
  return parsed.data;
}

// Durable rate limit. Called as its own statement BEFORE the operation it
// guards, so a failing operation still spends the hit.
export async function rateLimit(bucket: string, key: string, max: number, windowSeconds: number) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .rpc("consume_rate_limit", {
      p_bucket: `mobile_${bucket}`,
      p_key: key,
      p_max_hits: max,
      p_window_seconds: windowSeconds,
    })
    .single();
  if (error) throw pgError(error);
  const row = data as { allowed: boolean; retry_after_ms: number } | null;
  if (row && !row.allowed) {
    fail("rate_limited", "Too many requests. Try again later.", {
      retryAfterMs: row.retry_after_ms,
    });
  }
}

export function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

// Opaque (timestamp, uuid) cursor, base64url JSON.
export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify([ts, id])).toString("base64url");
}

export function decodeCursor(raw: string | null): { ts: string; id: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(v) &&
      typeof v[0] === "string" &&
      typeof v[1] === "string" &&
      !Number.isNaN(Date.parse(v[0])) &&
      /^[0-9a-f-]{36}$/i.test(v[1])
    ) {
      return { ts: new Date(v[0]).toISOString(), id: v[1] };
    }
  } catch {
    // fall through
  }
  fail("invalid_input", "Bad cursor.", { field: "cursor" });
}

export function pageLimit(req: NextRequest, def = 20): number {
  const raw = req.nextUrl.searchParams.get("limit");
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) fail("invalid_input", "limit must be 1..50", { field: "limit" });
  return n;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(value: string | undefined, name = "id"): string {
  if (!value || !UUID_RE.test(value)) fail("not_found", "Not found.", { field: name });
  return value.toLowerCase();
}
