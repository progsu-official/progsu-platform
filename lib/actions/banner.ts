"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, err, ok } from "./result";
import {
  MAX_BANNER_BYTES,
  type CreateBannerUploadUrlInput,
  type FinalizeBannerUploadInput,
  type SetProfileNoteInput,
  createBannerUploadUrlSchema,
  finalizeBannerUploadSchema,
  setProfileNoteSchema,
} from "./banner-schemas";

const BUCKET = "banners";

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

export async function createBannerUploadUrl(
  rawInput: CreateBannerUploadUrlInput
): Promise<ActionResult<UploadUrlData>> {
  const parsed = createBannerUploadUrlSchema.safeParse(rawInput);
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

  // Storage policy enforces the {auth.uid()}/ prefix; the random name keeps
  // the public URL non-guessable.
  const storagePath = `${user.id}/${randomUUID()}.${EXT_BY_MIME[mimeType]}`;

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    return err("INTERNAL", signErr?.message ?? "Could not sign upload URL.");
  }

  return ok({
    path: storagePath,
    signedUrl: signed.signedUrl,
    token: signed.token,
  });
}

export async function finalizeBannerUpload(
  rawInput: FinalizeBannerUploadInput
): Promise<ActionResult<{ bannerUrl: string }>> {
  const parsed = finalizeBannerUploadSchema.safeParse(rawInput);
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

  // Re-check the stored object server-side. The client claimed a size and MIME
  // when signing; this is the only point where we see what actually landed.
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
  if (size === 0 || size > MAX_BANNER_BYTES) {
    await admin.storage.from(BUCKET).remove([path]);
    return err("BANNER_TOO_LARGE", "Banner exceeds the 4 MB limit.");
  }
  if (!/^image\/(jpeg|png|webp)/i.test(mime)) {
    await admin.storage.from(BUCKET).remove([path]);
    return err("BANNER_BAD_MIME", "Only JPEG, PNG, or WebP images are allowed.");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const { data: prev } = await supabase
    .from("profiles")
    .select("banner_url")
    .eq("id", user.id)
    .single();

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ banner_url: publicUrl })
    .eq("id", user.id);
  if (updateErr) return err("INTERNAL", updateErr.message);

  await removeOwnedObject(admin, prev?.banner_url ?? null);

  await supabase.rpc("write_audit", {
    p_action: "banner_updated",
    p_actor: user.id,
    p_target: user.id,
    p_metadata: { path, file_size: size },
  });

  revalidatePath("/profile");
  revalidatePath("/members", "layout");
  return ok({ bannerUrl: publicUrl });
}

export async function removeBanner(): Promise<ActionResult<{ removed: true }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const { data: prev } = await supabase
    .from("profiles")
    .select("banner_url")
    .eq("id", user.id)
    .single();

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ banner_url: null })
    .eq("id", user.id);
  if (updateErr) return err("INTERNAL", updateErr.message);

  await removeOwnedObject(createAdminClient(), prev?.banner_url ?? null);

  await supabase.rpc("write_audit", {
    p_action: "banner_removed",
    p_actor: user.id,
    p_target: user.id,
    p_metadata: {},
  });

  revalidatePath("/profile");
  revalidatePath("/members", "layout");
  return ok({ removed: true });
}

export async function setProfileNote(
  rawInput: SetProfileNoteInput
): Promise<ActionResult<{ note: string | null }>> {
  const parsed = setProfileNoteSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const { note } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "You must be signed in.");

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ note })
    .eq("id", user.id);
  if (updateErr) return err("INTERNAL", updateErr.message);

  revalidatePath("/profile");
  revalidatePath("/members", "layout");
  return ok({ note });
}

// Deletes the storage object behind a public banner URL, but only when it
// lives in our bucket.
async function removeOwnedObject(
  admin: ReturnType<typeof createAdminClient>,
  bannerUrl: string | null
) {
  if (!bannerUrl) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = bannerUrl.indexOf(marker);
  if (idx === -1) return;
  const objectPath = bannerUrl.slice(idx + marker.length);
  if (objectPath) {
    await admin.storage.from(BUCKET).remove([objectPath]);
  }
}
