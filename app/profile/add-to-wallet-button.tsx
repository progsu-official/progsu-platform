"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { addCheckinCodeToWallet } from "@/lib/actions/wallet";

export function AddToWalletButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await addCheckinCodeToWallet();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      window.open(result.data.shareUrl, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={add}
      >
        {pending ? "Preparing…" : "Add to Wallet"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
