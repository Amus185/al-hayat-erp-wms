// OpenNext adapter settings for Cloudflare Workers (see wrangler.jsonc).
// No incremental cache: every page reads prices and stock live from the ERP
// (src/lib/erp.ts fetches with cache: "no-store"), so there is nothing to store.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
