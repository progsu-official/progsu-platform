import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` and `next build` both write to .next by default, so building
  // while the dev server is up overwrites the chunks it is serving and the
  // running app starts 404ing its own CSS. Builds go somewhere else.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  experimental: {
    // Client-side Router Cache lifetimes. Next 15 defaults `dynamic` to 0,
    // which means a force-dynamic route is refetched in full every time it is
    // navigated to -- including going back to a page the user loaded ten
    // seconds ago. Every member surface here is force-dynamic, so the whole
    // app behaved as if nothing was ever cached: leaving /events and
    // returning re-ran the layout's auth work and the page's queries from
    // scratch, with the browser sitting on the old page for the duration.
    //
    // 30s is short enough that a stale RSVP count is not a real risk, and
    // Server Actions invalidate the router cache on their own, so anything
    // the member actually changes refreshes immediately regardless.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },

  // /dashboard became /profile. Members have this bookmarked and it has gone
  // out in notification emails, so the old paths keep working permanently
  // rather than 404ing. Deep paths carry their hash/query through too.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/profile", permanent: true },
      {
        source: "/dashboard/:path*",
        destination: "/profile/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
