import { serve } from '@hono/node-server';
import app from './index';

const port = Number(process.env.PORT) || 3000;

console.log(`🚀 Al Hayat ERP & WMS API server starting on port ${port}...`);
console.log(`🔗 Health check available at http://localhost:${port}/api/v1/health`);

serve({
  fetch: app.fetch,
  port,
});
