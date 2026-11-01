import { serve } from '@hono/node-server';
import app from './index';
import { PgAdapter } from './pg-client';
import { expireStaleRequests } from './services/storefront';

const port = Number(process.env.PORT) || 3000;

console.log(`🚀 Al Hayat ERP & WMS API server v1.1.0 starting on port ${port}...`);
console.log(`🔗 Health check available at http://localhost:${port}/api/v1/health`);

serve({
  fetch: app.fetch,
  port,
});

// Same housekeeping the Worker's Cron Trigger does, every 15 minutes.
if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
  const run = async () => {
    // ssl: hosted Postgres needs it; the adapter turns it off for localhost.
    const db = new PgAdapter(process.env.DATABASE_URL as string, { perRequest: true, ssl: true });
    try {
      const n = await expireStaleRequests(db);
      if (n) console.log(`⏱  ${n} unconfirmed web order(s) expired; stock released.`);
    } catch (err) {
      console.error('Scheduled housekeeping failed:', err);
    } finally {
      await db.close().catch(() => {});
    }
  };
  setInterval(run, 15 * 60 * 1000).unref();
}
