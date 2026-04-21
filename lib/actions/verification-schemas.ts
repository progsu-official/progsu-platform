import { z } from "zod";

// Shared zod schemas + types for the verification actions. Lives outside of the
// "use server" module because Next's server-action loader refuses to load files
// that export anything other than async functions.

export const StudentEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: "Enter a valid email address" })
  .max(254);

export const requestStudentEmailCodeSchema = z.object({
  studentEmail: StudentEmailSchema,
});

export const verifyStudentEmailCodeSchema = z.object({
  studentEmail: StudentEmailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/u, { message: "Code must be 6 digits" }),
});

export type RequestStudentEmailCodeInput = z.infer<
  typeof requestStudentEmailCodeSchema
>;
export type VerifyStudentEmailCodeInput = z.infer<
  typeof verifyStudentEmailCodeSchema
>;

// Config (defaults match the OTP contract in docs/07-implementation-plan.md §1.1).
export const OTP_TTL_MINUTES_DEFAULT = 10;
export const OTP_MAX_ATTEMPTS_DEFAULT = 5;
export const OTP_BCRYPT_COST_DEFAULT = 12;

export const SEND_BUCKET = "otp_send";
export const SEND_WINDOW_SEC = 15 * 60;
export const SEND_MAX = 3;
export const SEND_COOLDOWN_SEC = 60;

export const VERIFY_BUCKET = "otp_verify";
export const VERIFY_WINDOW_SEC = 15 * 60;
export const VERIFY_MAX = 5;
