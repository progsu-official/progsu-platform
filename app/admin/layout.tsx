import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, first_name")
    .eq("id", user.id)
    .single();

  // 404 (not 403) for non-admins so admin surface doesn't leak route existence.
  if (!profile?.is_admin) notFound();

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <aside className="hidden w-56 border-r bg-muted/20 md:flex md:flex-col">
          <div className="border-b px-4 py-4">
            <Link href="/admin" className="text-base font-semibold tracking-tight">
              Progsu · Admin
            </Link>
          </div>
          <nav className="flex-1 space-y-1 px-2 py-3 text-sm">
            <AdminNavLink href="/admin">Overview</AdminNavLink>
            <AdminNavLink href="/admin/members">Members</AdminNavLink>
            <AdminNavLink href="/admin/export">Export</AdminNavLink>
            <AdminNavLink href="/admin/domain-requests">
              Domain requests
            </AdminNavLink>
            <AdminNavLink href="/admin/audit">Audit log</AdminNavLink>
            <AdminNavLink href="/admin/settings">Settings</AdminNavLink>
          </nav>
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            Signed in as {profile.first_name ?? user.email}
            <form action={signOut} className="mt-2">
              <button
                type="submit"
                className="w-full rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent/10"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

function AdminNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
    >
      {children}
    </Link>
  );
}
