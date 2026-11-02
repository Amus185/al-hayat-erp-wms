// Staff sign-in, sign-out and session refresh are Better Auth's endpoints
// under /api/auth (src/auth.ts). These are the ERP's own additions.
import { Hono, type Context } from 'hono';
import { Env } from '../db';
import { authMiddleware, PERMISSIONS_OF_USER } from '../middleware/auth';
import { idleTimeoutMinutes } from '../auth';
import { poolOf } from '../services/auth-sessions';

const auth = new Hono<{ Bindings: Env }>();

async function loadProfile(c: Context, userId: string) {
  const r = await poolOf(c).query(`
    SELECT u.id, u.email, u.full_name, u.branch_id,
           (SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = u.id
             ORDER BY (r.code = 'admin') DESC, (r.code = 'accountant') DESC, r.code LIMIT 1) AS role_code,
           (${PERMISSIONS_OF_USER}) AS permissions
    FROM users u WHERE u.id = $1 AND u.is_active = 1`, [userId]);
  const u = r.rows[0];
  if (!u) return null;
  return {
    id: u.id as string,
    email: u.email as string,
    fullName: u.full_name as string,
    permissions: u.permissions ? String(u.permissions).split(',') : [],
    branchId: (u.branch_id as string | null) ?? null,
    role: (u.role_code as string) || 'branch_user',
  };
}

function noStore(c: Context) {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
}

/** The signed-in user's ERP profile: name, role, permissions, branch. */
auth.get('/me', authMiddleware, async (c) => {
  noStore(c);
  const user = await loadProfile(c, (c as any).get('jwtPayload').sub);
  if (!user) return c.json({ message: 'Unauthorized' }, 401);
  // The staff app's inactivity timer uses the server's setting.
  return c.json({ user: { ...user, idleTimeoutMinutes: idleTimeoutMinutes() } });
});

/** Ends every session of the signed-in user, on every device. */
auth.post('/logout-all', authMiddleware, async (c) => {
  noStore(c);
  const payload = (c as any).get('jwtPayload');
  await poolOf(c).query('DELETE FROM "session" WHERE "userId" = $1', [payload.sub]);
  return c.body(null, 204);
});

export default auth;
