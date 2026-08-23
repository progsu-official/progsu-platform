"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireWalletWalletApiKey } from "@/lib/env";
import { type ActionResult, err, ok } from "./result";

const WALLETWALLET_API_URL = "https://api.walletwallet.dev/api/passes";

// Mints a fresh WalletWallet pass encoding the caller's own personal
// checkin_code — never accepts a code from the client, since that value is
// a live check-in credential and this action's only auth boundary is
// "whoever is signed in gets a pass for their own code."
//
// ponytail: each click mints a brand-new pass rather than updating one by
// stored serialNumber, so a member who regenerates their code after adding
// it to their wallet is left with a stale pass showing the old QR. Add
// serialNumber storage (a profiles column) + a PUT on regenerate if that
// turns out to matter in practice.
export async function addCheckinCodeToWallet(): Promise<
  ActionResult<{ shareUrl: string }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("checkin_code, preferred_name, first_name")
    .eq("id", user.id)
    .maybeSingle();
  const code = (profile as { checkin_code?: string | null } | null)
    ?.checkin_code;
  if (!code) return err("NOT_FOUND", "No check-in code on your profile yet.");

  const holderName =
    (profile as { preferred_name?: string | null; first_name?: string | null })
      .preferred_name ||
    (profile as { first_name?: string | null }).first_name ||
    "Member";

  let res: Response;
  try {
    res = await fetch(WALLETWALLET_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireWalletWalletApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        barcodeValue: code,
        barcodeFormat: "QR",
        organizationName: "Progsu",
        logoText: "Progsu",
        description: `${holderName}'s personal check-in code`,
        colorPreset: "dark",
        primaryFields: [{ label: "Member", value: holderName }],
      }),
    });
  } catch {
    return err("INTERNAL", "Couldn't reach the wallet pass service.");
  }

  if (!res.ok) {
    return err("INTERNAL", `Wallet pass service returned ${res.status}.`);
  }

  const data = (await res.json()) as { shareUrl?: string };
  if (!data.shareUrl) {
    return err("INTERNAL", "Wallet pass service didn't return a share link.");
  }

  return ok({ shareUrl: data.shareUrl });
}
