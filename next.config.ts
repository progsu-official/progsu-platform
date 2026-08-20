import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` and `next build` both write to .next by default, so building
  // while the dev server is up overwrites the chunks it is serving and the
  // running app starts 404ing its own CSS. Builds go somewhere else.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

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
