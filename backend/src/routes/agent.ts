/**
 * AI assistant support. The assistant itself runs in a Cloudflare Worker
 * (ai-agent/); this file is everything it may touch in the ERP.
 *
 *   POST /agent/session              staff token  → a 5-minute agent token (rate limited per user)
 *   POST /agent/tools/:name          agent token  → read-only lookups, scoped like the staff app
 *   POST /agent/proposals            agent token  → records a change the assistant suggests (nothing runs)
 *   POST /agent/actions/:id/execute  staff token  → the user confirmed: run it through the normal route
 *   POST /agent/actions/:id/cancel   staff token
 *
 * The Worker never gets database access or a normal login token. Agent tokens
 * carry the user's session id, so signing out, deactivation or a password
 * change cut the assistant off at once, and permissions are read from the
 * database on every call.
 */
import { Hono, type Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import { Env, uuidv4 } from '../db';
import { asUser, authMiddleware, loadAuthState, payloadFrom, type JwtPayload } from '../middleware/auth';
import { resultForModel, sourceUrl } from '../services/agent-data';
import { hasAllBranchAccess } from '../services/branch-scope';
import { logAudit } from '../services/audit';
import { getAgentSecret } from '../security-config';
import inventory from './inventory';
import products from './products';

type Vars = { jwtPayload: JwtPayload };
const agent = new Hono<{ Bindings: Env; Variables: Vars }>();

export const AGENT_TOKEN_TTL_S = 5 * 60;
const DEFAULT_MESSAGES_PER_HOUR = 60;
/** Assistant messages per user per hour (AGENT_MESSAGES_PER_HOUR; raise it on a paid plan). */
export function messagesPerHour(): number {
  const n = Math.floor(Number(typeof process !== 'undefined' ? process.env.AGENT_MESSAGES_PER_HOUR : undefined));
  return n > 0 ? Math.min(n, 10_000) : DEFAULT_MESSAGES_PER_HOUR;
}
const PROPOSAL_TTL_MIN = 15;

const notConfigured = (c: Context) => c.json({ message: 'Kaaliyaha weli laguma diyaarin nidaamka. La xiriir maamulaha.' }, 503);

// ── tokens ───────────────────────────────────────────────────────────────────

/** One agent token per assistant message, counted against the user's hourly limit. */
agent.post('/session', authMiddleware, async (c) => {
  const secret = getAgentSecret();
  if (!secret) return notConfigured(c);
  const p = c.get('jwtPayload');
  const db = c.env.DB;
  await db.prepare(`DELETE FROM agent_usage WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`).run();
  const used = await db.prepare(`SELECT COUNT(*)::int AS n FROM agent_usage WHERE user_id = ? AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'`)
    .bind(p.sub).first() as any;
  const limit = messagesPerHour();
  if (Number(used?.n) >= limit) {
    return c.json({ message: `Waxaad gaartay xadka ${limit} fariimood ee saacaddan. Fadlan dib isku day goor dambe.` }, 429);
  }
  await db.prepare('INSERT INTO agent_usage (id, user_id) VALUES (?, ?)').bind(uuidv4(), p.sub).run();
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ typ: 'agent', sub: p.sub, sid: p.sid, pwd_ver: p.pwd_ver, iat: now, exp: now + AGENT_TOKEN_TTL_S }, secret, 'HS256');
  return c.json({ token, expiresIn: AGENT_TOKEN_TTL_S, name: p.name });
});

/** Accepts only agent tokens, and loads the user's live permissions like authMiddleware does. */
async function agentAuth(c: Context<{ Bindings: Env; Variables: Vars }>, next: () => Promise<void>) {
  const header = c.req.header('Authorization') || '';
  if (!header.startsWith('Bearer ')) return c.json({ message: 'Unauthorized' }, 401);
  const secret = getAgentSecret();
  if (!secret) return notConfigured(c);
  let claims: any;
  try {
    claims = await verify(header.replace(/^Bearer /, ''), secret, 'HS256');
  } catch {
    return c.json({ message: 'Invalid or expired assistant token' }, 401);
  }
  if (claims?.typ !== 'agent' || !claims.sub || !claims.sid) return c.json({ message: 'Invalid or expired assistant token' }, 401);
  const user: any = await loadAuthState(c.env.DB, claims.sub, claims.sid);
  if (!user || Number(user.is_active) !== 1 || user.banned || !user.session_live || Number(user.password_version) !== Number(claims.pwd_ver)) {
    return c.json({ message: 'Session ended. Please sign in again.' }, 401);
  }
  c.set('jwtPayload', payloadFrom(user, claims.sub, claims.sid));
  await next();
}

// ── helpers ──────────────────────────────────────────────────────────────────

const can = (p: JwtPayload, perm: string) => p.permissions.includes(perm);
/** null = every branch; otherwise only this branch (no branch → nothing). */
const branchScope = (p: JwtPayload): string | null | false =>
  hasAllBranchAccess(p) || p.role === 'admin' ? null : (p.branch_id ?? false);
const text = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const money = (n: unknown) => Math.round(Number(n || 0) * 100) / 100;
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
const refuse = (c: Context, why: string) => c.json({ error: why }, 200); // tool errors go back to the model as text

/** Finds one product by id, SKU or name. Returns candidates when the name is ambiguous. */
async function findProduct(db: any, query: string): Promise<{ product?: any; candidates?: any[] }> {
  const q = query.trim();
  if (!q) return { candidates: [] };
  const exact = await db.prepare(`
    SELECT id, sku, name, selling_price, reorder_level FROM products
    WHERE id = ? OR LOWER(sku) = LOWER(?) OR LOWER(name) = LOWER(?) ORDER BY COALESCE(is_active, 1) DESC LIMIT 2
  `).bind(q, q, q).all();
  if ((exact.results || []).length === 1) return { product: exact.results[0] };
  const { results } = await db.prepare(`
    SELECT id, sku, name, selling_price, reorder_level FROM products
    WHERE (name ILIKE ? OR sku ILIKE ?) AND COALESCE(is_active, 1) = 1 ORDER BY name LIMIT 6
  `).bind(like(q), like(q)).all();
  const rows = results || [];
  return rows.length === 1 ? { product: rows[0] } : { candidates: rows.map((r: any) => ({ name: r.name, sku: r.sku })) };
}

async function branchByName(db: any, name: string): Promise<any | null> {
  if (!name) return null;
  return db.prepare('SELECT id, name FROM branches WHERE id = ? OR LOWER(name) = LOWER(?) OR name ILIKE ? ORDER BY (LOWER(name) = LOWER(?)) DESC LIMIT 1')
    .bind(name, name, like(name), name).first();
}

const PERIOD_SQL: Record<string, string> = {
  today: `date_trunc('day', CURRENT_TIMESTAMP)`,
  week: `date_trunc('week', CURRENT_TIMESTAMP)`,
  month: `date_trunc('month', CURRENT_TIMESTAMP)`,
  year: `date_trunc('year', CURRENT_TIMESTAMP)`,
};

// ── read-only tools ──────────────────────────────────────────────────────────

const tools = new Hono<{ Bindings: Env; Variables: Vars }>();
tools.use('/*', agentAuth);

tools.post('/search_products', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const q = text(body.query, 80);
  const scope = branchScope(c.get('jwtPayload'));
  if (scope === false) return refuse(c, 'Your account is not linked to a branch, so stock cannot be shown.');
  const { results } = await c.env.DB.prepare(`
    SELECT p.name, p.sku, p.selling_price, COALESCE(cat.name, '') AS category, COALESCE(p.is_active, 1) AS is_active,
           COALESCE(p.is_published, 0) AS on_website,
           (SELECT COALESCE(SUM(s.quantity_on_hand), 0) FROM inventory_stock s
             WHERE s.product_id = p.id AND (?::text IS NULL OR (s.owner_type = 'BRANCH' AND s.branch_id = ?)))::int AS units_on_hand
    FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE (? = '' OR p.name ILIKE ? OR p.sku ILIKE ? OR cat.name ILIKE ?)
    ORDER BY COALESCE(p.is_active, 1) DESC, p.name LIMIT 10
  `).bind(scope, scope, q, like(q), like(q), like(q)).all();
  return c.json({
    products: (results || []).map((r: any) => ({
      name: r.name, sku: r.sku, price: money(r.selling_price), category: r.category || null,
      active: Number(r.is_active) === 1, onWebsite: Number(r.on_website) === 1, unitsOnHand: Number(r.units_on_hand),
    })),
  });
});

tools.post('/get_stock', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const p = c.get('jwtPayload');
  const scope = branchScope(p);
  if (scope === false) return refuse(c, 'Your account is not linked to a branch, so stock cannot be shown.');
  const found = await findProduct(c.env.DB, text(body.product));
  if (!found.product) return refuse(c, found.candidates?.length ? `Several products match: ${JSON.stringify(found.candidates)}. Ask which one.` : 'No product matches that name or SKU.');
  const { results } = await c.env.DB.prepare(`
    SELECT COALESCE(b.name, w.name, 'Unknown') AS location, s.owner_type, s.quantity_on_hand, s.quantity_reserved
    FROM inventory_stock s LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.product_id = ? AND (?::text IS NULL OR (s.owner_type = 'BRANCH' AND s.branch_id = ?))
    ORDER BY s.quantity_on_hand DESC
  `).bind(found.product.id, scope, scope).all();
  return c.json({
    product: found.product.name, sku: found.product.sku, reorderLevel: Number(found.product.reorder_level),
    locations: (results || []).map((r: any) => ({
      location: r.location, type: r.owner_type === 'BRANCH' ? 'branch' : 'warehouse',
      onHand: Number(r.quantity_on_hand), heldForWebOrders: Number(r.quantity_reserved),
    })),
  });
});

tools.post('/get_low_stock', async (c) => {
  const p = c.get('jwtPayload');
  if (!can(p, 'view_reports')) return refuse(c, 'You do not have permission to see stock reports.');
  const scope = branchScope(p);
  if (scope === false) return refuse(c, 'Your account is not linked to a branch.');
  // At or below the reorder level, per location the user may see.
  const { results } = await c.env.DB.prepare(`
    SELECT p.name, p.sku, p.reorder_level, COALESCE(b.name, w.name, 'Unknown') AS location, s.quantity_on_hand
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN warehouses w ON w.id = s.warehouse_id
    WHERE COALESCE(p.is_active, 1) = 1 AND s.quantity_on_hand <= p.reorder_level
      AND (?::text IS NULL OR (s.owner_type = 'BRANCH' AND s.branch_id = ?))
    ORDER BY (s.quantity_on_hand - p.reorder_level), p.name LIMIT 25
  `).bind(scope, scope).all();
  return c.json({
    items: (results || []).map((r: any) => ({ name: r.name, sku: r.sku, location: r.location, onHand: Number(r.quantity_on_hand), reorderLevel: Number(r.reorder_level) })),
  });
});

tools.post('/get_sales_summary', async (c) => {
  const p = c.get('jwtPayload');
  if (!can(p, 'view_reports')) return refuse(c, 'You do not have permission to see sales figures.');
  const scope = branchScope(p);
  if (scope === false) return refuse(c, 'Your account is not linked to a branch.');
  const body = await c.req.json().catch(() => ({}));
  const period = Object.hasOwn(PERIOD_SQL, body.period) ? body.period as string : 'week';
  const since = PERIOD_SQL[period];
  const db = c.env.DB;
  const totals = await db.prepare(`
    SELECT COUNT(*)::int AS invoices, COALESCE(SUM(i.total_amount - i.discount_amount), 0) AS net_sales,
           COALESCE(SUM(CASE WHEN i.status = 'PAID' THEN i.total_amount - i.discount_amount ELSE 0 END), 0) AS paid
    FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE i.status <> 'CANCELLED' AND i.issued_at >= ${since} AND (?::text IS NULL OR so.branch_id = ?)
  `).bind(scope, scope).first() as any;
  const { results: top } = await db.prepare(`
    SELECT p.name, SUM(il.quantity)::int AS units, SUM(il.quantity * il.unit_price) AS revenue
    FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN sales_orders so ON so.id = i.sales_order_id JOIN products p ON p.id = il.product_id
    WHERE i.status <> 'CANCELLED' AND i.issued_at >= ${since} AND (?::text IS NULL OR so.branch_id = ?)
    GROUP BY p.name ORDER BY units DESC LIMIT 5
  `).bind(scope, scope).all();
  return c.json({
    period, scope: scope ? 'your branch' : 'all branches',
    invoices: Number(totals?.invoices || 0), netSales: money(totals?.net_sales), paid: money(totals?.paid),
    topProducts: (top || []).map((r: any) => ({ name: r.name, units: Number(r.units), revenue: money(r.revenue) })),
  });
});

tools.post('/list_orders', async (c) => {
  const p = c.get('jwtPayload');
  if (!can(p, 'manage_sales')) return refuse(c, 'You do not have permission to see orders.');
  const scope = branchScope(p);
  if (scope === false) return refuse(c, 'Your account is not linked to a branch.');
  const body = await c.req.json().catch(() => ({}));
  const status = text(body.status, 20).toUpperCase();
  const limit = Math.min(10, Math.max(1, Math.floor(Number(body.limit)) || 5));
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT so.order_number, so.status, so.total_amount, so.created_at, COALESCE(cu.name, 'Walk-in') AS customer, b.name AS branch,
           EXISTS (SELECT 1 FROM storefront_requests r WHERE r.converted_order_id = so.id) AS from_website
    FROM sales_orders so LEFT JOIN customers cu ON cu.id = so.customer_id LEFT JOIN branches b ON b.id = so.branch_id
    WHERE (? = '' OR so.status = ?) AND (?::text IS NULL OR so.branch_id = ?)
    ORDER BY so.created_at DESC LIMIT ?
  `).bind(status, status, scope, scope, limit).all();
  const newWeb = await db.prepare(`SELECT COUNT(*)::int AS n FROM storefront_requests WHERE status = 'NEW'`).first() as any;
  return c.json({
    orders: (results || []).map((r: any) => ({
      number: r.order_number, status: r.status, total: money(r.total_amount), customer: r.customer, branch: r.branch,
      fromWebsite: !!r.from_website, date: new Date(r.created_at).toISOString().slice(0, 10),
    })),
    newWebsiteRequests: Number(newWeb?.n || 0),
  });
});

/**
 * Any part of the ERP, read through its own API route as this user: the same
 * permission checks, branch scope and figures as the staff screens.
 * Body: { source, id?, filters? } (see services/agent-data.ts).
 */
tools.post('/get_data', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const target = sourceUrl(String(body.source ?? ''), body.id, body.filters);
  if ('error' in target) return refuse(c, target.error);
  const p = c.get('jwtPayload');
  const { default: app } = await import('../index');
  const res = await app.fetch(new Request(target.url), asUser(c.env, p));
  const data: any = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) {
    return refuse(c, `You do not have permission to see this (${data?.message || 'access denied'}). Tell the user so; do not guess.`);
  }
  if (res.status === 404) return refuse(c, 'Not found. Check the id or look it up again.');
  if (!res.ok || data === null) return refuse(c, `The system could not load this (${data?.message || data?.error || res.status}).`);
  return c.body(resultForModel(data, !can(p, 'costs.view')), 200, { 'Content-Type': 'application/json' });
});

agent.route('/tools', tools);

// ── proposals: the assistant may only suggest changes ───────────────────────

agent.post('/proposals', agentAuth, async (c) => {
  const p = c.get('jwtPayload');
  const body = await c.req.json().catch(() => ({}));
  const action = text(body.action, 30);
  const args = (body.args && typeof body.args === 'object') ? body.args : {};
  const db = c.env.DB;

  let stored: Record<string, unknown>;
  let summary: string;
  if (action === 'adjust_stock') {
    if (!can(p, 'manage_inventory')) return refuse(c, 'You do not have permission to change stock.');
    const qty = Number(args.quantity);
    if (!Number.isInteger(qty) || qty === 0 || Math.abs(qty) > 10000) return refuse(c, 'The quantity must be a whole number between -10000 and 10000, not 0.');
    const found = await findProduct(db, text(args.product));
    if (!found.product) return refuse(c, found.candidates?.length ? `Several products match: ${JSON.stringify(found.candidates)}. Ask which one.` : 'No product matches that name or SKU.');
    // Branch users change their own branch only; others name a branch.
    const scope = branchScope(p);
    let branch: any = null;
    if (scope) branch = await db.prepare('SELECT id, name FROM branches WHERE id = ?').bind(scope).first();
    else if (scope === null) {
      branch = await branchByName(db, text(args.location));
      if (!branch) {
        const { results } = await db.prepare('SELECT name FROM branches ORDER BY name').all();
        return refuse(c, `Which branch? Options: ${(results || []).map((r: any) => r.name).join(', ')}.`);
      }
    }
    if (!branch) return refuse(c, 'Your account is not linked to a branch.');
    const now = await db.prepare(`SELECT COALESCE(SUM(quantity_on_hand), 0)::int AS n FROM inventory_stock WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?`)
      .bind(found.product.id, branch.id).first() as any;
    const before = Number(now?.n || 0);
    if (before + qty < 0) return refuse(c, `Only ${before} in stock at ${branch.name}; cannot remove ${-qty}.`);
    const reason = text(args.reason, 200) || 'Stock adjustment';
    stored = { productId: found.product.id, branchId: branch.id, quantity: qty, reason };
    // Shown to the manager on the Confirm card, in Somali.
    summary = `${qty > 0 ? 'Ku dar' : 'Ka dhim'} ${Math.abs(qty)} xabbo oo ${found.product.name} ah, ${branch.name} (${before} -> ${before + qty}). Sababta: ${reason}`;
  } else if (action === 'set_price') {
    if (!can(p, 'manage_inventory')) return refuse(c, 'You do not have permission to change prices.');
    const price = Math.round(Number(args.price) * 100) / 100;
    if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return refuse(c, 'The price must be a positive amount.');
    const found = await findProduct(db, text(args.product));
    if (!found.product) return refuse(c, found.candidates?.length ? `Several products match: ${JSON.stringify(found.candidates)}. Ask which one.` : 'No product matches that name or SKU.');
    stored = { productId: found.product.id, price };
    summary = `Beddel qiimaha iibka ee ${found.product.name}: ${money(found.product.selling_price).toFixed(2)} -> ${price.toFixed(2)}.`;
  } else {
    return refuse(c, 'Unknown action. Only adjust_stock and set_price can be proposed.');
  }

  const id = uuidv4();
  await db.prepare(`INSERT INTO agent_actions (id, user_id, action, args, summary, expires_at)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP + make_interval(mins => ?))`)
    .bind(id, p.sub, action, JSON.stringify(stored), summary, PROPOSAL_TTL_MIN).run();
  return c.json({ proposal: { id, action, summary, expiresInMinutes: PROPOSAL_TTL_MIN } });
});

// ── the user confirms (or cancels) in the staff app ─────────────────────────

agent.post('/actions/:id/execute', authMiddleware, async (c) => {
  const p = c.get('jwtPayload');
  const id = c.req.param('id');
  const db = c.env.DB;
  // Claim it: only the user it was proposed to, only once, only before it expires.
  const claim = await db.prepare(`
    UPDATE agent_actions SET status = 'RUNNING', handled_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP
    RETURNING action, args, summary
  `).bind(id, p.sub).all();
  const row = claim.results?.[0] as any;
  if (!row) return c.json({ message: 'This suggestion was already handled or has expired. Ask the assistant again.' }, 409);
  const args = JSON.parse(row.args);

  // Run it through the normal route as this user, so permissions, branch
  // rules, validation, audit and accounting are exactly the usual ones. (The
  // user's login may be a cookie, which a forwarded header would not carry.)
  const headers = { 'Content-Type': 'application/json' };
  const env = asUser(c.env, p);
  let res: Response;
  if (row.action === 'adjust_stock') {
    res = await inventory.fetch(new Request('http://internal/adjust', {
      method: 'POST', headers,
      body: JSON.stringify({
        productId: args.productId, branchId: args.branchId, quantity: Math.abs(args.quantity),
        direction: args.quantity > 0 ? 'INCREASE' : 'DECREASE', notes: `AI assistant (confirmed): ${args.reason}`,
      }),
    }), env as any);
  } else if (row.action === 'set_price') {
    res = await products.fetch(new Request(`http://internal/${args.productId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ sellingPrice: args.price }),
    }), env as any);
  } else {
    res = new Response(JSON.stringify({ message: 'Unknown action.' }), { status: 400 });
  }
  const out: any = await res.json().catch(() => ({}));
  const ok = res.status >= 200 && res.status < 300;
  await db.prepare('UPDATE agent_actions SET status = ?, result = ? WHERE id = ?')
    .bind(ok ? 'DONE' : 'FAILED', ok ? 'ok' : String(out?.message || res.status).slice(0, 300), id).run();
  await logAudit(c as any, 'AGENT_ACTION_CONFIRMED', 'agent_actions', id, null, { action: row.action, ok });
  if (!ok) return c.json({ message: out?.message || 'The change could not be made.' }, (res.status >= 400 && res.status < 600 ? res.status : 400) as any);
  return c.json({ success: true, summary: row.summary });
});

agent.post('/actions/:id/cancel', authMiddleware, async (c) => {
  const done = await c.env.DB.prepare(`
    UPDATE agent_actions SET status = 'CANCELLED', handled_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 'PENDING'
  `).bind(c.req.param('id'), c.get('jwtPayload').sub).run();
  if (!done.meta?.changes) return c.json({ message: 'This suggestion was already handled.' }, 409);
  return c.json({ success: true });
});

// ── chat history (the signed-in user's own conversations) ───────────────────

export const MAX_CONVERSATIONS_LISTED = 100;
export const MAX_MESSAGES_PER_CONVERSATION = 400;
const MAX_MESSAGE_CHARS = 20_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The conversation, if it is this user's; otherwise null (answered as "not found"). */
async function ownConversation(c: Context<{ Bindings: Env; Variables: Vars }>, id: string) {
  if (!SAFE_ID.test(id)) return null;
  return c.env.DB.prepare('SELECT id, title, created_at, updated_at FROM agent_conversations WHERE id = ? AND user_id = ?')
    .bind(id, c.get('jwtPayload').sub).first() as Promise<any>;
}
const notFound = (c: Context) => c.json({ message: 'Wada-hadalkan lama helin.' }, 404);
const titleFrom = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '') || 'Wada-hadal';

agent.get('/conversations', authMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT c.id, c.title, c.created_at, c.updated_at, (SELECT COUNT(*) FROM agent_messages m WHERE m.conversation_id = c.id)::int AS message_count
    FROM agent_conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT ?
  `).bind(c.get('jwtPayload').sub, MAX_CONVERSATIONS_LISTED).all();
  return c.json((results || []).map((r: any) => ({
    id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, messageCount: Number(r.message_count),
  })));
});

agent.post('/conversations', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = uuidv4();
  await c.env.DB.prepare('INSERT INTO agent_conversations (id, user_id, title) VALUES (?, ?, ?)')
    .bind(id, c.get('jwtPayload').sub, titleFrom(body.title)).run();
  return c.json({ id, title: titleFrom(body.title) }, 201);
});

/**
 * One conversation with its messages. Suggested changes come with their
 * current state from agent_actions (done, cancelled, expired or still open),
 * so a reopened chat never offers to confirm something already handled.
 */
agent.get('/conversations/:id', authMiddleware, async (c) => {
  const conv = await ownConversation(c, c.req.param('id') ?? '');
  if (!conv) return notFound(c);
  const p = c.get('jwtPayload');
  const { results } = await c.env.DB.prepare(
    'SELECT id, role, content, proposal_ids, created_at FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
  ).bind(conv.id).all();
  const rows = (results || []) as any[];
  const proposalIds = rows.flatMap((r) => { try { return JSON.parse(r.proposal_ids || '[]') as string[]; } catch { return []; } })
    .filter((x) => typeof x === 'string' && SAFE_ID.test(x));
  const actions = new Map<string, any>();
  if (proposalIds.length) {
    const ph = proposalIds.map(() => '?').join(', ');
    const { results: acts } = await c.env.DB.prepare(`
      SELECT id, action, summary, status, expires_at > CURRENT_TIMESTAMP AS live,
             GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)) / 60))::int AS minutes_left
      FROM agent_actions WHERE user_id = ? AND id IN (${ph})
    `).bind(p.sub, ...proposalIds).all();
    for (const a of (acts || []) as any[]) actions.set(a.id, a);
  }
  const stateOf = (a: any) => a.status === 'DONE' ? 'done' : a.status === 'CANCELLED' ? 'dismissed' : a.status === 'FAILED' ? 'failed'
    : a.status === 'PENDING' && a.live ? 'open' : 'expired';
  return c.json({
    id: conv.id, title: conv.title, createdAt: conv.created_at, updatedAt: conv.updated_at,
    messages: rows.map((r) => {
      let ids: string[] = [];
      try { ids = JSON.parse(r.proposal_ids || '[]'); } catch { /* none */ }
      return {
        id: r.id, role: r.role, content: r.content, createdAt: r.created_at,
        proposals: ids.map((pid) => actions.get(pid)).filter(Boolean).map((a: any) => ({
          id: a.id, action: a.action, summary: a.summary, state: stateOf(a), expiresInMinutes: Number(a.minutes_left),
        })),
      };
    }),
  });
});

agent.post('/conversations/:id/messages', authMiddleware, async (c) => {
  const conv = await ownConversation(c, c.req.param('id') ?? '');
  if (!conv) return notFound(c);
  const body = await c.req.json().catch(() => ({}));
  const role = body.role === 'user' || body.role === 'assistant' ? body.role : null;
  const content = typeof body.content === 'string' ? body.content.slice(0, MAX_MESSAGE_CHARS) : '';
  if (!role || !content.trim()) return c.json({ message: 'A message needs a role (user or assistant) and text.' }, 400);
  const proposalIds = Array.isArray(body.proposalIds) ? body.proposalIds.filter((x: unknown) => typeof x === 'string' && SAFE_ID.test(x)).slice(0, 20) : [];
  const db = c.env.DB;
  const count = await db.prepare('SELECT COUNT(*)::int AS n FROM agent_messages WHERE conversation_id = ?').bind(conv.id).first() as any;
  if (Number(count?.n) >= MAX_MESSAGES_PER_CONVERSATION) {
    return c.json({ message: 'Wada-hadalkan aad buu u dheer yahay. Fadlan bilow wada-hadal cusub.' }, 409);
  }
  const id = uuidv4();
  await db.batch([
    db.prepare('INSERT INTO agent_messages (id, conversation_id, role, content, proposal_ids) VALUES (?, ?, ?, ?, ?)')
      .bind(id, conv.id, role, content, proposalIds.length ? JSON.stringify(proposalIds) : null),
    db.prepare('UPDATE agent_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(conv.id),
  ]);
  return c.json({ id }, 201);
});

agent.patch('/conversations/:id', authMiddleware, async (c) => {
  const conv = await ownConversation(c, c.req.param('id') ?? '');
  if (!conv) return notFound(c);
  const body = await c.req.json().catch(() => ({}));
  const title = titleFrom(body.title);
  await c.env.DB.prepare('UPDATE agent_conversations SET title = ? WHERE id = ?').bind(title, conv.id).run();
  return c.json({ id: conv.id, title });
});

agent.delete('/conversations/:id', authMiddleware, async (c) => {
  const conv = await ownConversation(c, c.req.param('id') ?? '');
  if (!conv) return notFound(c);
  await c.env.DB.prepare('DELETE FROM agent_conversations WHERE id = ?').bind(conv.id).run();
  return c.body(null, 204);
});

export default agent;
