"use client";

import { useState, useTransition } from "react";

import { setOpenToRecruiters } from "@/lib/actions/recruiter";

export function OpenToRecruitersToggle({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    startTransition(async () => {
      const result = await setOpenToRecruiters({ open: next });
      if (!result.ok) {
        setOpen(!next);
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={open}
        disabled={pending}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          open ? "bg-primary" : "bg-muted"
        } ${pending ? "opacity-70" : ""}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
            open ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <span className="text-xs text-muted-foreground">
        {open ? "On" : "Off"}
      </span>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
