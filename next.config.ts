import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // No landing page for now — temporary (307) so browsers don't cache it once one returns.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
  // Photos are shown straight from Google Drive, which refuses image requests (429) that name
  // another site as the referrer. "same-origin" sends no referrer to other sites, but still
  // sends it within this app.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "same-origin" }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
