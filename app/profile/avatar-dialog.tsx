"use client";

import { useRouter } from "next/navigation";

import { createAvatarUploadUrl, finalizeAvatarUpload } from "@/lib/actions/avatar";

import { ImageCropDialog } from "./image-crop-dialog";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
// Avatars render at 96px at the largest; 512 covers retina with room to spare.
const OUTPUT_PX = 512;

export function AvatarDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  async function upload(blob: Blob): Promise<string | null> {
    // Size is the CROPPED blob's, not the original file's — the server checks
    // the object it actually receives.
    const created = await createAvatarUploadUrl({
      mimeType: "image/jpeg",
      fileSize: blob.size,
    });
    if (!created.ok) return created.error.message;

    const put = await fetch(created.data.signedUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: blob,
    });
    if (!put.ok) return `Upload failed (${put.status}).`;

    const finalized = await finalizeAvatarUpload({ path: created.data.path });
    if (!finalized.ok) return finalized.error.message;

    router.refresh();
    return null;
  }

  return (
    <ImageCropDialog
      open={open}
      onClose={onClose}
      onUpload={upload}
      aspect={1}
      outputWidth={OUTPUT_PX}
      outputHeight={OUTPUT_PX}
      shape="circle"
      maxBytes={MAX_BYTES}
      acceptedMimeTypes={ACCEPTED}
      labels={{
        dialog: "Upload a profile photo",
        pickTitle: "Upload a photo",
        adjustTitle: "Adjust your photo",
        pickCta: "Upload photo",
        hint: "JPEG, PNG, or WebP · up to 2 MB",
        confirm: "Set photo",
        uploading: "Uploading your photo…",
      }}
    />
  );
}
