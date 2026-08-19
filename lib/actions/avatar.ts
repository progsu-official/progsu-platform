"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, err, ok } from "./result";
import {
  MAX_AVATAR_BYTES,
  type CreateAvatarUploadUrlInput,
  type FinalizeAvatarUploadInput,
  createAvatarUploadUrlSchema,
  finalizeAvatarUploadSchema,
} from "./avatar-schemas";

const BUCKET = "avatars";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type UploadUrlData = {
  path: string;
  signedUrl: string;
  token: string;
};

export async function createAvatarUploadUrl(
  rawInput: CreateAvatarUploadUrlInput
): Promise<ActionResult<UploadUrlData>> {
  const parsed = createAvatarUploadUrlSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const { mimeType } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  // Random object name under the caller's prefix — storage policy enforces
  // the {auth.uid()}/ prefix, randomness keeps URLs non-guessable.
  const storagePath = `${user.id}/${randomUUID()}.${EXT_BY_MIME[mimeType]}`;

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    return err("INTERNAL", signErr?.message ?? "Could not sign upload URL.");
  }

  return ok({ path: storagePath, signedUrl: signed.signedUrl, token: signed.token });
}

export async function finalizeAvatarUpload(
  rawInput: FinalizeAvatarUploadInput
): Promise<ActionResult<{ avatarUrl: string }>> {
  const parsed = finalizeAvatarUploadSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid input"
    );
  }
  const { path } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");
  if (!path.startsWith(`${user.id}/`)) {
    return err("FORBIDDEN", "Not your upload.");
  }

  // Server-side re-check of the stored object (size + content-type), same
  // pattern as finalizeResumeUpload. Service-role because the info endpoint
  // is not surfaced to end users.
  const admin = createAdminClient();
  const infoRes = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/info/${BUCKET}/${path}`,
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
  if (size === 0 || size > MAX_AVATAR_BYTES) {
    await admin.storage.from(BUCKET).remove([path]);
    return err("AVATAR_TOO_LARGE", "Photo exceeds the 2 MB limit.");
  }
  if (!/^image\/(jpeg|png|webp)/i.test(mime)) {
    await admin.storage.from(BUCKET).remove([path]);
    return err("AVATAR_BAD_MIME", "Only JPEG, PNG, or WebP images are allowed.");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // Remember the previous object so we can garbage-collect it after the swap.
  const { data: prev } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .single();

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", user.id);
  if (updateErr) return err("INTERNAL", updateErr.message);

  await removeOwnedObject(admin, prev?.avatar_url ?? null);

  await supabase.rpc("write_audit", {
    p_action: "avatar_updated",
    p_actor: user.id,
    p_target: user.id,
    p_metadata: { path, file_size: size },
  });

  revalidatePath("/dashboard");
  return ok({ avatarUrl: publicUrl });
}

export async function removeAvatar(): Promise<ActionResult<{ removed: true }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const { data: prev } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .single();

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);
  if (updateErr) return err("INTERNAL", updateErr.message);

  await removeOwnedObject(createAdminClient(), prev?.avatar_url ?? null);

  await supabase.rpc("write_audit", {
    p_action: "avatar_removed",
    p_actor: user.id,
    p_target: user.id,
    p_metadata: {},
  });

  revalidatePath("/dashboard");
  return ok({ removed: true });
}

// Deletes the storage object behind a public avatar URL, but only when it
// lives in our avatars bucket (Google-hosted OAuth avatars are left alone).
async function removeOwnedObject(
  admin: ReturnType<typeof createAdminClient>,
  avatarUrl: string | null
) {
  if (!avatarUrl) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = avatarUrl.indexOf(marker);
  if (idx === -1) return;
  const objectPath = avatarUrl.slice(idx + marker.length);
  if (objectPath) {
    await admin.storage.from(BUCKET).remove([objectPath]);
  }
}
