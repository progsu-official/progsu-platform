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
      // Not window.open(url, "_blank"): that's a new-window popup, and
      // popup blockers (iOS Safari especially) require it to fire
      // synchronously inside the click handler. This call happens after
      // awaiting the server action, so the browser silently blocks it —
      // no error, the button just goes back to normal with nothing
      // having happened. A same-tab navigation is never treated as a
      // popup, so it's never blocked, and landing on the page IS the
      // feedback that it worked.
      window.location.href = result.data.shareUrl;
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
