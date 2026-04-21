import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { env, requireServerEnv } from "@/lib/env";

export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}
