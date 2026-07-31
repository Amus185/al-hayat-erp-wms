import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import * as bcrypt from 'bcryptjs';
import { authMiddleware, requirePermissions, requireAdmin, isAdminUser, invalidateUserCache } from '../middleware/auth';
import { logAudit } from '../services/audit';

const branches = new Hono<{ Bindings: Env }>();

branches.use('/*', authMiddleware);

// ── Secure random password generator ────────────────────────────────────────
function generateSecurePassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values).map(v => chars[v % chars.length]).join('');
}

// ── GET all branches ─────────────────────────────────────────────────────────
// Admin: sees all branches
// Branch user: sees only their own branch
branches.get('/', async (c) => {
  const payload = c.get('jwtPayload');

  if (isAdminUser(payload)) {
    const { results } = await c.env.DB.prepare('SELECT * FROM branches ORDER BY name').all();
    return c.json(results);
  }

  // Branch user — only their own branch
  const branch = await c.env.DB.prepare(
    'SELECT * FROM branches WHERE id = ?'
  ).bind(payload.branch_id).first();
  return c.json(branch ? [branch] : []);
});

// ── GET single branch ────────────────────────────────────────────────────────
branches.get('/:id', async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');

  // Branch users can only access their own branch
  if (!isAdminUser(payload) && payload.branch_id !== id) {
    return c.json({ message: 'Access denied' }, 403);
  }

  const branch = await c.env.DB.prepare('SELECT * FROM branches WHERE id = ?').bind(id).first();
  if (!branch) return c.json({ message: 'Branch not found' }, 404);
  return c.json(branch);
});

// ── CREATE branch + auto-provision branch user ────────────────────────────────
// Admin only
branches.post('/', requirePermissions(['manage_users']), requireAdmin, async (c) => {
  const body = await c.req.json();

  if (!body.code || !body.code.trim()) return c.json({ message: 'Branch code is required.' }, 400);
  if (!body.name || !body.name.trim()) return c.json({ message: 'Branch name is required.' }, 400);
  if (!body.city || !body.city.trim()) return c.json({ message: 'City is required.' }, 400);

  // Check code uniqueness
  const existing = await c.env.DB.prepare('SELECT id FROM branches WHERE code = ?').bind(body.code.trim()).first();
  if (existing) return c.json({ message: 'A branch with this code already exists.' }, 409);

  const branchId = uuidv4();

  // Generate branch user credentials — NEVER log the raw password
  const rawPassword = generateSecurePassword(16);
  const passwordHash = bcrypt.hashSync(rawPassword, 12);
  const branchUsername = `branch.${body.code.trim().toLowerCase()}@alhayat.local`;
  const userId = uuidv4();

  // Find the branch_user role
  const branchUserRole = await c.env.DB.prepare(
    "SELECT id FROM roles WHERE code = 'branch_user'"
  ).first();

  if (!branchUserRole) {
    return c.json({ message: 'branch_user role not found. Run migration_branch_users.sql first.' }, 500);
  }

  // Atomic batch: create branch + user + assign role
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO branches (id, code, name, city, address, phone) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(branchId, body.code.trim(), body.name.trim(), body.city.trim(), body.address || null, body.phone || null),

    c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, branch_id, is_active, password_version)
       VALUES (?, ?, ?, ?, ?, 1, 1)`
    ).bind(userId, branchUsername, passwordHash, `${body.name.trim()} Branch User`, branchId),

    c.env.DB.prepare(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)'
    ).bind(userId, branchUserRole.id),
  ]);

  const branch = await c.env.DB.prepare('SELECT * FROM branches WHERE id = ?').bind(branchId).first();

  await logAudit(c, 'BRANCH_CREATE', 'branches', branchId, null, {
    name: body.name.trim(),
    code: body.code.trim(),
    branchUserCreated: true,
    branchUserEmail: branchUsername,
    // rawPassword intentionally NOT logged
  });

  return c.json({
    branch,
    branchUser: {
      id: userId,
      username: branchUsername,
      rawPassword, // Shown ONE TIME only — never persisted in logs
    },
  }, 201);
});

// ── GET branch performance ───────────────────────────────────────────────────
branches.get('/:id/performance', async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');

  if (!isAdminUser(payload) && payload.branch_id !== id) {
    return c.json({ message: 'Access denied' }, 403);
  }

  const result = await c.env.DB.prepare(`
    SELECT 
      b.id, b.code, b.name,
      COUNT(DISTINCT so.id) as order_count,
      COALESCE(SUM(i.total_amount), 0) as invoiced_amount,
      COALESCE(SUM(sol.quantity), 0) as units_sold
    FROM branches b
    LEFT JOIN sales_orders so ON so.branch_id = b.id
    LEFT JOIN invoices i ON i.sales_order_id = so.id AND i.status = 'PAID'
    LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
    WHERE b.id = ?
    GROUP BY b.id, b.code, b.name
  `).bind(id).first();
  if (!result) return c.json({ message: 'Branch not found' }, 404);
  return c.json(result);
});

// ── GET branch inventory ─────────────────────────────────────────────────────
branches.get('/:id/inventory', async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');

  if (!isAdminUser(payload) && payload.branch_id !== id) {
    return c.json({ message: 'Access denied' }, 403);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT p.name, p.sku, p.barcode,
           s.quantity_on_hand, s.quantity_reserved,
           (s.quantity_on_hand - s.quantity_reserved) as available_quantity
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.branch_id = ? AND s.owner_type = 'BRANCH'
    ORDER BY p.name ASC
  `).bind(id).all();
  return c.json(results);
});

// ── REGENERATE branch user credentials (admin only) ──────────────────────────
// Invalidates ALL existing sessions for the branch user.
branches.post('/:id/regenerate-credentials', requireAdmin, async (c) => {
  const branchId = c.req.param('id');

  const branch = await c.env.DB.prepare('SELECT * FROM branches WHERE id = ?').bind(branchId).first();
  if (!branch) return c.json({ message: 'Branch not found' }, 404);

  const branchUser = await c.env.DB.prepare(
    'SELECT id, email, password_version FROM users WHERE branch_id = ? AND is_active = 1 LIMIT 1'
  ).bind(branchId).first();

  if (!branchUser) return c.json({ message: 'No branch user found for this branch.' }, 404);

  const rawPassword = generateSecurePassword(16);
  const passwordHash = bcrypt.hashSync(rawPassword, 12);
  const newVersion = ((branchUser.password_version as number) || 1) + 1;

  // Update password + increment version + wipe all refresh tokens (invalidates all sessions)
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, password_version = ? WHERE id = ?'
    ).bind(passwordHash, newVersion, branchUser.id),
    c.env.DB.prepare(
      'DELETE FROM refresh_tokens WHERE user_id = ?'
    ).bind(branchUser.id),
  ]);

  invalidateUserCache(branchUser.id as string);

  await logAudit(c, 'BRANCH_CREDENTIALS_REGENERATED', 'branches', branchId, null, {

    branchUserEmail: branchUser.email,
    newPasswordVersion: newVersion,
    // rawPassword intentionally NOT logged
  });

  return c.json({
    message: 'Credentials regenerated. All existing sessions have been invalidated.',
    branchUser: {
      id: branchUser.id,
      username: branchUser.email,
      rawPassword, // ONE-TIME only
    },
  });
});

export default branches;
