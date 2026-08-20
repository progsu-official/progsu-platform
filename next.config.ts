import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
