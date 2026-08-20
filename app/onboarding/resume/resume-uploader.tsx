"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createResumeUploadUrl,
  finalizeResumeUpload,
} from "@/lib/actions/resume";

const MAX_BYTES = 10 * 1024 * 1024;

type UploadStatus =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "signing" }
  | { kind: "uploading"; percent: number }
  | { kind: "finalizing" }
  | { kind: "error"; message: string };

export function ResumeUploader({
  currentFileName,
  currentUploadedAt,
}: {
  currentFileName: string | null;
  currentUploadedAt: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  function pickFile(f: File | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      setStatus({ kind: "error", message: "That isn't a PDF. Pick a .pdf file." });
      return;
    }
    if (f.size > MAX_BYTES) {
      setStatus({
        kind: "error",
        message: "File is larger than 10 MB.",
      });
      return;
    }
    setStatus({ kind: "idle" });
    setFile(f);
  }

  async function uploadWithProgress(url: string, blob: Blob) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("content-type", "application/pdf");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          setStatus({ kind: "uploading", percent });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(blob);
    });
  }

  function onUpload() {
    if (!file) return;
    setStatus({ kind: "signing" });
    startTransition(async () => {
      const created = await createResumeUploadUrl({
        fileName: file.name,
        fileSize: file.size,
      });
      if (!created.ok) {
        setStatus({ kind: "error", message: created.error.message });
        return;
      }
      try {
        setStatus({ kind: "uploading", percent: 0 });
        await uploadWithProgress(created.data.signedUrl, file);
      } catch (e) {
        setStatus({
          kind: "error",
          message: e instanceof Error ? e.message : "Upload failed.",
        });
        return;
      }
      setStatus({ kind: "finalizing" });
      const finalized = await finalizeResumeUpload({
        resumeId: created.data.resumeId,
      });
      if (!finalized.ok) {
        setStatus({ kind: "error", message: finalized.error.message });
        return;
      }
      setStatus({ kind: "idle" });
      setFile(null);
      router.push("/onboarding/consent");
      router.refresh();
    });
  }

  const busy =
    pending ||
    status.kind === "signing" ||
    status.kind === "uploading" ||
    status.kind === "finalizing" ||
    status.kind === "validating";

  return (
    <div className="space-y-4">
      {currentFileName ? (
        <div className="rounded-md border border-muted-foreground/20 bg-background p-4 text-sm">
          <p className="text-muted-foreground">Current resume</p>
          <p className="font-medium">{currentFileName}</p>
          {currentUploadedAt ? (
            <p className="text-xs text-muted-foreground">
              uploaded {new Date(currentUploadedAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) pickFile(dropped);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 bg-muted/10"
        )}
      >
        <p className="text-sm text-muted-foreground">
          Drop a PDF here or{" "}
          <button
            type="button"
            className="text-primary underline underline-offset-4"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            choose a file
          </button>
          .
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <p className="text-xs">
            Selected: <span className="font-medium">{file.name}</span> (
            {(file.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        ) : null}
      </div>

      {status.kind === "uploading" ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${status.percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Uploading… {status.percent}%
          </p>
        </div>
      ) : null}

      {status.kind === "signing" || status.kind === "finalizing" ? (
        <p className="text-xs text-muted-foreground">
          {status.kind === "signing" ? "Preparing upload…" : "Finalizing…"}
        </p>
      ) : null}

      {status.kind === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {status.message}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          PDF only · 10 MB max · we never post your resume publicly
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={() => {
              router.push("/onboarding/consent");
            }}
          >
            Skip for now
          </Button>
          <Button
            onClick={onUpload}
            disabled={!file || busy}
            size="lg"
          >
            {busy ? "Uploading…" : "Upload and continue"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Heads up: recruiters browsing the member list only see profiles with a
        resume on file. You can come back and upload any time from your
        profile.
      </p>
    </div>
  );
}
