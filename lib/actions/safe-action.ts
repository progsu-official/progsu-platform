import "server-only";

import type { z } from "zod";

import { log, newRequestId } from "@/lib/log";
import { type ActionResult, err } from "./result";

type Handler<TInput, TOutput> = (input: TInput) => Promise<ActionResult<TOutput>>;

type SafeActionOptions = {
  action: string;
  requireAuthUserId?: string;
};

// Wraps a server action handler in a validate → log → catch shell. Handlers still return
// their own ActionResult; safeAction just ensures consistent logging + turns thrown
// exceptions into { ok: false, error: { code: INTERNAL } } rather than 500s.
export function safeAction<TInput, TOutput>(
  schema: z.ZodType<TInput>,
  handler: Handler<TInput, TOutput>,
  options: SafeActionOptions
): Handler<unknown, TOutput> {
  return async (rawInput: unknown): Promise<ActionResult<TOutput>> => {
    const requestId = newRequestId();
    const start = Date.now();

    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("action invalid input", {
        action: options.action,
        request_id: requestId,
        ok: false,
        error_code: "INVALID_INPUT",
      });
      return err("INVALID_INPUT", issue?.message ?? "Invalid input", {
        field: issue?.path.join("."),
      });
    }

    try {
      const result = await handler(parsed.data);
      log.info("action complete", {
        action: options.action,
        request_id: requestId,
        duration_ms: Date.now() - start,
        ok: result.ok,
        error_code: result.ok ? undefined : result.error.code,
      });
      return result;
    } catch (e) {
      log.error("action threw", {
        action: options.action,
        request_id: requestId,
        duration_ms: Date.now() - start,
        ok: false,
        error_code: "INTERNAL",
        error_message: e instanceof Error ? e.message : String(e),
      });
      return err(
        "INTERNAL",
        "Something went wrong. Please try again."
      );
    }
  };
}
