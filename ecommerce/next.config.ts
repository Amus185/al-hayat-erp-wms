import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// Public hostname of the photo bucket (e.g. photos.example.com). Only photos
// from this host may be optimised and served.
const imageHost = process.env.IMAGE_HOSTNAME;
// Development only: a stand-in for the photo bucket on this computer.
const allowLocalImages = !isProd && process.env.ALLOW_LOCAL_IMAGES === "1";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This app has its own lockfile inside a larger repo: pin the project root so Next does not guess.
  turbopack: { root: process.cwd() },
  images: {
    remotePatterns: [
      ...(imageHost ? [{ protocol: "https" as const, hostname: imageHost, pathname: "/products/**" }] : []),
      ...(allowLocalImages ? [{ protocol: "http" as const, hostname: "127.0.0.1", port: "9100", pathname: "/**" }] : []),
    ],
    dangerouslyAllowLocalIP: allowLocalImages,
    // Photo files get a new name on every upload, so a resized copy never goes stale.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
