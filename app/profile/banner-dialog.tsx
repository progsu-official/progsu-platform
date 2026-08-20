"use client";

import { useRouter } from "next/navigation";

import {
  BANNER_MIME_TYPES,
  MAX_BANNER_BYTES,
} from "@/lib/actions/banner-schemas";
import {
  createBannerUploadUrl,
  finalizeBannerUpload,
} from "@/lib/actions/banner";

import { ImageCropDialog } from "./image-crop-dialog";

// 3:1 crop. The banner renders full-bleed at a ratio that shifts with the
// viewport (~2.4:1 on phones, ~5:1 at max-w-5xl), so no single frame is exactly
// WYSIWYG everywhere. 3:1 sits between the two: object-cover trims the sides on
// wide screens and the top/bottom on narrow ones, and nothing important falls
// off either way as long as the subject stays near the middle.
const OUTPUT_WIDTH = 1500;
const OUTPUT_HEIGHT = 500;
const MAX_MB = Math.round(MAX_BANNER_BYTES / (1024 * 1024));

export function BannerDialog({
  open,
  onClose,
  hasBanner,
}: {
  open: boolean;
  onClose: () => void;
  hasBanner: boolean;
}) {
  const router = useRouter();

  async function upload(blob: Blob): Promise<string | null> {
    // Size is the CROPPED blob's, not the original file's — the server checks
    // the object it actually receives.
    const created = await createBannerUploadUrl({
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

    const finalized = await finalizeBannerUpload({ path: created.data.path });
    if (!finalized.ok) return finalized.error.message;

    router.refresh();
    return null;
  }

  return (
    <ImageCropDialog
      open={open}
      onClose={onClose}
      onUpload={upload}
      aspect={OUTPUT_WIDTH / OUTPUT_HEIGHT}
      outputWidth={OUTPUT_WIDTH}
      outputHeight={OUTPUT_HEIGHT}
      shape="rect"
      maxBytes={MAX_BANNER_BYTES}
      acceptedMimeTypes={BANNER_MIME_TYPES}
      // A 1600px working image leaves a 3:1 crop barely wider than the 1500px
      // export; 2400 keeps the downscale one-way.
      workingMaxPx={2400}
      widthClassName="max-w-xl"
      labels={{
        dialog: hasBanner ? "Change your banner" : "Add a banner",
        pickTitle: hasBanner ? "Change your banner" : "Add a banner",
        adjustTitle: "Adjust your banner",
        pickCta: "Upload banner",
        hint: `JPEG, PNG, or WebP · up to ${MAX_MB} MB`,
        confirm: "Set banner",
        uploading: "Uploading your banner…",
      }}
    />
  );
}
