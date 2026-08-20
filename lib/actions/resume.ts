"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, err, ok } from "./result";
import {
  MAX_RESUME_BYTES,
  type CreateResumeUploadUrlInput,
  type DeleteResumeInput,
  type FinalizeResumeUploadInput,
  createResumeUploadUrlSchema,
  deleteResumeSchema,
  finalizeResumeUploadSchema,
} from "./resume-schemas";

const BUCKET = "resumes";
const DOWNLOAD_TTL_SECONDS = 5 * 60; // 5 min for member dashboard; admin path uses 15 min

type UploadUrlData = {
  resumeId: string;
  path: string;
  signedUrl: string;
  token: string;
};

export async function createResumeUploadUrl(
  rawInput: CreateResumeUploadUrlInput
): Promise<ActionResult<UploadUrlData>> {
  const parsed = createResumeUploadUrlSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const { fileName, fileSize } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const resumeId = randomUUID();
  const storagePath = `${user.id}/${resumeId}.pdf`;

  // Insert the pending row first (RLS: user_id must be auth.uid(); status='pending';
  // is_current=false). This reserves the storage_path uniqueness.
  const { error: insertErr } = await supabase.from("resumes").insert({
    id: resumeId,
    user_id: user.id,
    storage_path: storagePath,
    file_name: fileName,
    file_size: fileSize,
    mime_type: "application/pdf",
    status: "pending",
    is_current: false,
  });
  if (insertErr) {
    return err("INTERNAL", insertErr.message);
  }

  // Mint a signed upload URL. Storage policy requires the object path to sit under
  // {auth.uid()}/ — matches our storagePath above.
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    // Clean up the pending row so we don't leak it.
    await supabase.from("resumes").delete().eq("id", resumeId);
    return err("INTERNAL", signErr?.message ?? "Could not sign upload URL.");
  }

  return ok({
    resumeId,
    path: storagePath,
    signedUrl: signed.signedUrl,
    token: signed.token,
  });
}

export async function finalizeResumeUpload(
  rawInput: FinalizeResumeUploadInput
): Promise<ActionResult<{ downloadUrl: string; resumeId: string }>> {
  const parsed = finalizeResumeUploadSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid input"
    );
  }
  const { resumeId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  // Fetch the pending row and verify ownership + state.
  const { data: row, error: rowErr } = await supabase
    .from("resumes")
    .select("id, user_id, storage_path, file_size, mime_type, status")
    .eq("id", resumeId)
    .single();
  if (rowErr || !row) return err("NOT_FOUND", "Resume not found.");
  if (row.user_id !== user.id) return err("FORBIDDEN", "Not your resume.");
  if (row.status !== "pending")
    return err("CONFLICT", `Resume is already ${row.status}.`);

  // Server-side re-check of the stored object (size + content-type). Uses service-role
  // because the info endpoint is not surfaced to end users.
  const admin = createAdminClient();
  const infoRes = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/info/${BUCKET}/${row.storage_path}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
    }
  );
  if (!infoRes.ok) {
    return err("STORAGE_OBJECT_MISSING", "Upload did not complete.");
  }
  const info = (await infoRes.json()) as {
    size?: number;
    content_type?: string;
    contentType?: string;
  };
  const size = info.size ?? 0;
  const mime = info.content_type ?? info.contentType ?? "";
  if (size === 0 || size > MAX_RESUME_BYTES) {
    await admin.storage.from(BUCKET).remove([row.storage_path]);
    await supabase.from("resumes").delete().eq("id", resumeId);
    return err("RESUME_TOO_LARGE", "File exceeds 10 MB limit.");
  }
  if (!/^application\/pdf/i.test(mime)) {
    await admin.storage.from(BUCKET).remove([row.storage_path]);
    await supabase.from("resumes").delete().eq("id", resumeId);
    return err("RESUME_BAD_MIME", "Only PDF files are allowed.");
  }

  // Transition pending → active + flip is_current, all inside the RPC.
  const { error: finalizeErr } = await supabase.rpc("finalize_resume_upload", {
    p_resume_id: resumeId,
  });
  if (finalizeErr) return err("INTERNAL", finalizeErr.message);

  await supabase.rpc("write_audit", {
    p_action: "resume_uploaded",
    p_actor: user.id,
    p_target: user.id,
    p_metadata: { resume_id: resumeId, file_size: size },
  });

  // Mint a short-lived signed download URL for the user's dashboard.
  const { data: signedDownload, error: downloadErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, DOWNLOAD_TTL_SECONDS);
  if (downloadErr || !signedDownload) {
    return ok({ resumeId, downloadUrl: "" });
  }
  return ok({ resumeId, downloadUrl: signedDownload.signedUrl });
}

// Short-lived signed URL for previewing your own current resume.
//
// Takes no arguments on purpose: the row is looked up by auth.uid() + is_current,
// so there's no id for a caller to swap. The signing itself goes through the
// user-context client, whose storage policy only permits objects under the
// caller's own {user_id}/ prefix — a second, independent guard.
export async function createResumePreviewUrl(): Promise<
  ActionResult<{ url: string; fileName: string; expiresInSeconds: number }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const { data: row, error: rowErr } = await supabase
    .from("resumes")
    .select("storage_path, file_name")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();
  if (rowErr) return err("INTERNAL", rowErr.message);
  if (!row) return err("NOT_FOUND", "You don't have a resume uploaded yet.");

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, DOWNLOAD_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return err("STORAGE_OBJECT_MISSING", "Couldn't open that resume. Try re-uploading it.");
  }

  return ok({
    url: signed.signedUrl,
    fileName: row.file_name,
    expiresInSeconds: DOWNLOAD_TTL_SECONDS,
  });
}

export async function deleteResume(
  rawInput: DeleteResumeInput
): Promise<ActionResult<{ deleted: true }>> {
  const parsed = deleteResumeSchema.safeParse(rawInput);
  if (!parsed.success) return err("INVALID_INPUT", "Invalid input");
  const { resumeId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const { error } = await supabase.rpc("soft_delete_resume", {
    p_resume_id: resumeId,
  });
  if (error) {
    if (error.code === "P0002") return err("NOT_FOUND", "Resume not found.");
    if (error.code === "P0001" && /current/.test(error.message))
      return err("CONFLICT", "Cannot delete the current resume.");
    if (error.code === "P0001") return err("FORBIDDEN", error.message);
    return err("INTERNAL", error.message);
  }

  await supabase.rpc("write_audit", {
    p_action: "resume_soft_deleted",
    p_actor: user.id,
    p_target: user.id,
    p_metadata: { resume_id: resumeId },
  });

  return ok({ deleted: true });
}
