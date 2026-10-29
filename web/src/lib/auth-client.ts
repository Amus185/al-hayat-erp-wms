// Better Auth client for staff sign-in (server: backend/src/auth.ts).
// Same-origin /api/auth: in production through the Pages proxy, in
// development through Vite's proxy. The session is an HttpOnly cookie; this
// page never sees the token.
import { createAuthClient } from 'better-auth/react';
import { adminClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  plugins: [adminClient()],
});
