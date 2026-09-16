import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  // Articles were renamed to Blog in the UI; keep old links working.
  async redirects() {
    return [
      { source: "/articles", destination: "/blog", permanent: true },
      { source: "/articles/:path*", destination: "/blog/:path*", permanent: true },
    ];
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "dpihndeejbirskdrjfeh.supabase.co" }],
  },
};

export default nextConfig;
