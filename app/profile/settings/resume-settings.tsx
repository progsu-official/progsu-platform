"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ResumePreview } from "../resume-preview";
import { cn } from "@/lib/utils";
import {
  createResumeUploadUrl,
  finalizeResumeUpload,
} from "@/lib/actions/resume";

const MAX_BYTES = 10 * 1024 * 1024;

export function ResumeSettings({
  currentFileName,
  currentUploadedAt,
}: {
  currentFileName: string | null;
  currentUploadedAt: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading"; percent: number }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);

  function pickFile(f: File | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      setStatus({ kind: "error", message: "Pick a .pdf file." });
      return;
    }
    if (f.size > MAX_BYTES) {
      setStatus({ kind: "error", message: "File is larger than 10 MB." });
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
          setStatus({
            kind: "uploading",
            percent: Math.round((e.loaded / e.total) * 100),
          });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(blob);
    });
  }

  function onUpload() {
    if (!file) return;
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
          message: e instanceof Error ? e.message : "Upload failed",
        });
        return;
      }
      const finalized = await finalizeResumeUpload({
        resumeId: created.data.resumeId,
      });
      if (!finalized.ok) {
        setStatus({ kind: "error", message: finalized.error.message });
        return;
      }
      setStatus({ kind: "saved" });
      setFile(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {currentFileName ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-4 text-sm">
          <div className="min-w-0">
            <p className="text-muted-foreground">Current resume</p>
            <p className="truncate font-medium">{currentFileName}</p>
            {currentUploadedAt ? (
              <p className="text-xs text-muted-foreground">
                uploaded {new Date(currentUploadedAt).toLocaleDateString()}
              </p>
            ) : null}
          </div>
          <ResumePreview fileName={currentFileName} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No current resume.</p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-6 py-8 text-center",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 bg-muted/10"
        )}
      >
        <p className="text-sm text-muted-foreground">
          Drop a new PDF or{" "}
          <button
            type="button"
            className="text-primary underline underline-offset-4"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
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
            {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
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
          <p className="text-xs text-muted-foreground">{status.percent}%</p>
        </div>
      ) : null}

      {status.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">{status.message}</p>
      ) : null}
      {status.kind === "saved" ? (
        <p role="status" className="text-sm text-primary">Resume replaced.</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button onClick={onUpload} disabled={!file || pending} size="lg">
          {pending ? "Uploading…" : currentFileName ? "Replace resume" : "Upload resume"}
        </Button>
      </div>
    </div>
  );
}
