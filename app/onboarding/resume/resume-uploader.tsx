"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import {
  createResumeUploadUrl,
  finalizeResumeUpload,
} from "@/lib/actions/resume";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbIconPlate,
  OnbIntro,
  OnbPrimaryButton,
  OnbRow,
  OnbRowDivider,
  OnbSecondaryButton,
  OnbSurface,
} from "../_components/shell";

const MAX_BYTES = 10 * 1024 * 1024;

type UploadStatus =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "signing" }
  | { kind: "uploading"; percent: number }
  | { kind: "finalizing" }
  | { kind: "error"; message: string };

function DocumentIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

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
      setStatus({
        kind: "error",
        message: "that isn't a pdf — pick a .pdf file.",
      });
      return;
    }
    if (f.size > MAX_BYTES) {
      setStatus({
        kind: "error",
        message: "that file is over 10 MB.",
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
        else reject(new Error(`upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("network error during upload"));
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
          message: e instanceof Error ? e.message : "upload failed.",
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
    <>
      <OnbSurface>
        <OnbIntro title="add your resume">
          it&apos;s what sponsors and recruiters see when they come scouting —
          without one, you don&apos;t show up for them at all. pdf, up to 10 MB.
        </OnbIntro>

        <div className="mt-2 space-y-4">
          {currentFileName ? (
            <div>
              <OnbRow
                icon={
                  <OnbIconPlate className="bg-secondary">
                    <DocumentIcon />
                  </OnbIconPlate>
                }
                title={currentFileName}
                body={
                  currentUploadedAt
                    ? `on file — uploaded ${new Date(
                        currentUploadedAt,
                      ).toLocaleDateString()}. a new upload replaces it.`
                    : "on file — a new upload replaces it."
                }
              />
              <OnbRowDivider />
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
              "rounded-[18px] border border-dashed px-4 transition-colors md:px-5",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border bg-card/60",
            )}
          >
            <OnbRow
              icon={
                <OnbIconPlate className="bg-secondary">
                  <DocumentIcon />
                </OnbIconPlate>
              }
              title={file ? file.name : "drop your pdf here"}
              body={
                file
                  ? `${(file.size / 1024 / 1024).toFixed(2)} MB — ready when you are.`
                  : "or drag one in."
              }
              action={
                <OnbSecondaryButton
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="w-full md:w-auto"
                >
                  choose a file
                </OnbSecondaryButton>
              }
            />
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {status.kind === "uploading" ? (
            <div className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[hsl(var(--primary))] transition-all"
                  style={{ width: `${status.percent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                uploading… {status.percent}%
              </p>
            </div>
          ) : null}

          {status.kind === "signing" || status.kind === "finalizing" ? (
            <p className="text-xs text-muted-foreground">
              {status.kind === "signing" ? "preparing your upload…" : "finalizing…"}
            </p>
          ) : null}

          {status.kind === "error" ? (
            <OnbErrorBox>{status.message}</OnbErrorBox>
          ) : null}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          never posted publicly — and leave your SSN and address off it.
        </p>
      </OnbSurface>

      <OnbActionBar>
        <div className="flex w-full max-w-[24rem] items-center gap-3">
          <OnbSecondaryButton
            // cta height so both pills in the bar match; width stays natural.
            size="cta"
            className="w-auto flex-none px-5"
            disabled={busy}
            onClick={() => {
              router.push("/onboarding/consent");
            }}
          >
            skip for now
          </OnbSecondaryButton>
          <OnbPrimaryButton
            onClick={onUpload}
            disabled={!file || busy}
            loading={busy}
            className="flex-1"
          >
            {busy ? "uploading…" : "upload and continue"}
          </OnbPrimaryButton>
        </div>
      </OnbActionBar>
    </>
  );
}
