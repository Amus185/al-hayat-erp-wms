// OpenNext adapter settings for Cloudflare Workers (see wrangler.jsonc).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
  // Keeps the 60-second catalog cache (src/lib/erp.ts) across requests.
  incrementalCache: r2IncrementalCache,
});
