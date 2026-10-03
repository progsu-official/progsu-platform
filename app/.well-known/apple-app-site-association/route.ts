import { appSiteAssociationConfig } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Paths mirror what ios/Progsu/Progsu/Core/DeepLink.swift parses on the
// universal-link host. Only single-segment ids are handled there, so deeper
// paths are excluded first (first match wins) and fall through to the web.
// /checkin is deliberately absent: the parser maps it to My QR, but on the web
// it is the door-staff page, and claiming it would hijack that page on any
// phone with the app installed.
const components = [
  { "/": "/events/*/*", exclude: true },
  { "/": "/events/*", comment: "event detail" },
  { "/": "/announcements/*/*", exclude: true },
  { "/": "/announcements/*", comment: "announcement" },
  { "/": "/hacklanta/sessions/*/*", exclude: true },
  { "/": "/hacklanta/sessions/*", comment: "Hacklanta session" },
];

export function GET() {
  const config = appSiteAssociationConfig();
  if (!config) return new Response("Not found", { status: 404 });
  return Response.json(
    {
      applinks: {
        details: [{ appIDs: [config.appId], components }],
      },
      webcredentials: { apps: [config.appId] },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
