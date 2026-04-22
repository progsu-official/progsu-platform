import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Playwright session helper. Bypasses Google OAuth by:
//   1. Calling signInWithPassword on an anon client to mint a session.
//   2. Running that session through @supabase/ssr's cookie adapter, which
//      serializes the session EXACTLY the way the real app does.
//   3. Copying the resulting cookies into Playwright's browser context.
//
// Why not hand-serialize `sb-<ref>-auth-token`? The cookie format has changed
// between @supabase/ssr versions (it's base64 in 0.5+, raw JSON before, and
// will change again). Going through the library keeps us version-agnostic.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type CookieShape = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

export async function signInAndInjectCookies(
  context: BrowserContext,
  email: string,
  password: string,
  baseURL = "http://127.0.0.1:3000"
): Promise<{ userId: string }> {
  // First, mint a session on the plain JS client.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session || !data.user) {
    throw new Error(`signIn ${email}: ${error?.message}`);
  }

  // Now feed that session through @supabase/ssr so we capture the cookies
  // exactly the way the real app would write them. Using an in-memory cookie
  // jar so we don't touch the real request context.
  const jar = new Map<string, CookieShape>();
  const ssrClient = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return Array.from(jar.values()).map((c) => ({
          name: c.name,
          value: c.value,
        }));
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) {
          jar.set(c.name, {
            name: c.name,
            value: c.value,
            options: c.options ?? {},
          });
        }
      },
    },
  });

  // Trigger ssr to write the session cookies.
  await ssrClient.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  const host = new URL(baseURL).hostname;
  await context.addCookies(
    Array.from(jar.values()).map((c) => {
      const opts = c.options;
      const rawSameSite = typeof opts.sameSite === "string" ? opts.sameSite : "lax";
      const sameSite: "Strict" | "Lax" | "None" =
        rawSameSite === "strict"
          ? "Strict"
          : rawSameSite === "none"
            ? "None"
            : "Lax";
      const rawPath = typeof opts.path === "string" ? opts.path : "/";
      const rawHttpOnly = typeof opts.httpOnly === "boolean" ? opts.httpOnly : true;
      const rawSecure = typeof opts.secure === "boolean" ? opts.secure : false;
      const rawExpires =
        opts.expires instanceof Date
          ? Math.floor(opts.expires.getTime() / 1000)
          : (data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600);
      return {
        name: c.name,
        value: c.value,
        domain: host,
        path: rawPath,
        httpOnly: rawHttpOnly,
        secure: rawSecure,
        sameSite,
        expires: rawExpires,
      };
    })
  );

  return { userId: data.user.id };
}

export function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
