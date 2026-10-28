// The hosts next/image may load photos from. Shared by next.config.ts (which
// configures the image optimizer) and the ERP client (which drops any photo
// outside this list): next/image throws on a URL that is not allowed, and one
// bad photo URL must not take a whole page down.
// Plain relative imports only: next.config.ts loads this file too.

export interface RemotePattern {
  protocol: "http" | "https";
  hostname: string;
  port?: string;
  pathname: string;
}

export function imageRemotePatterns(env: NodeJS.ProcessEnv = process.env): RemotePattern[] {
  const isProd = env.NODE_ENV === "production";
  // Public hostname of the photo bucket (e.g. photos.example.com).
  const imageHost = env.IMAGE_HOSTNAME;
  // Development only: the local stand-in for the photo bucket.
  const allowLocal = !isProd && env.ALLOW_LOCAL_IMAGES === "1";
  return [
    ...(imageHost
      ? [
          { protocol: "https" as const, hostname: imageHost, pathname: "/products/**" },
          { protocol: "https" as const, hostname: imageHost, pathname: "/categories/**" },
        ]
      : []),
    // Marketing photos only (src/lib/photos.ts).
    { protocol: "https" as const, hostname: "images.unsplash.com", pathname: "/photo-**" },
    ...(allowLocal ? [{ protocol: "http" as const, hostname: "127.0.0.1", port: "9100", pathname: "/**" }] : []),
  ];
}

/** Same matching rules as next/image's remotePatterns, for the patterns above. */
export function isAllowedImageUrl(raw: string, patterns = imageRemotePatterns()): boolean {
  if (raw.startsWith("/") && !raw.startsWith("//")) return true; // same-origin file in /public
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return patterns.some((p) => {
    if (url.protocol !== `${p.protocol}:` || url.hostname !== p.hostname || url.port !== (p.port ?? "")) return false;
    const prefix = p.pathname.replace(/\*\*$/, "");
    return url.pathname.startsWith(prefix);
  });
}
