"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function DoneRedirect() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.push("/profile"), 1800);
    return () => clearTimeout(t);
  }, [router]);
  return null;
}
