// Roadmap wave 5: document layout settings (25) and per-user dashboard preferences (26).
import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, isAdminUser } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';

const settings = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();
settings.use('/*', authMiddleware);

export const DEFAULT_LAYOUT = {
  companyName: 'Al Hayat Furniture Group', tagline: '', address: '', phone: '', email: '', website: '',
  accentColor: '#066006', showLogo: true, paperSize: 'a4', fontScale: 1,
  footerText: 'Thank you for your business.', terms: '', showSignatures: false, showGeneratedAt: true,
};
const PAPER = ['a4', 'letter', 'a5'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function readLayout(db: any) {
  const row = await db.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'document_layout'").first() as any;
  const value = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
  return { ...DEFAULT_LAYOUT, ...(value || {}), updated_at: row?.updated_at ?? null };
}

settings.get('/document-layout', async (c) => c.json(await readLayout(c.env.DB)));
settings.put('/document-layout', async (c) => {
  if (!isAdminUser(c.get('jwtPayload'))) return c.json({ message: 'Only the Owner can change how documents look.' }, 403);
  const b = await c.req.json().catch(() => ({}));
  const color = str(b.accentColor, 7);
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return c.json({ message: 'The colour must look like #066006.' }, 400);
  const scale = b.fontScale === undefined ? 1 : Number(b.fontScale);
  if (!Number.isFinite(scale) || scale < 0.85 || scale > 1.25) return c.json({ message: 'Text size must be between 85% and 125%.' }, 400);
  if (b.paperSize !== undefined && !PAPER.includes(String(b.paperSize))) return c.json({ message: 'Paper is A4, Letter or A5.' }, 400);
  const companyName = str(b.companyName, 80);
  if (!companyName) return c.json({ message: 'Enter the company name shown on documents.' }, 400);
  const value = {
    companyName, tagline: str(b.tagline, 120), address: str(b.address, 200), phone: str(b.phone, 60), email: str(b.email, 120), website: str(b.website, 120),
    accentColor: color || DEFAULT_LAYOUT.accentColor, showLogo: b.showLogo !== false, paperSize: PAPER.includes(String(b.paperSize)) ? String(b.paperSize) : 'a4',
    fontScale: Math.round(scale * 100) / 100, footerText: str(b.footerText, 200), terms: str(b.terms, 1000),
    showSignatures: !!b.showSignatures, showGeneratedAt: b.showGeneratedAt !== false,
  };
  const old = await readLayout(c.env.DB);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO app_settings (key, value, updated_by) VALUES ('document_layout', ?::jsonb, ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`).bind(JSON.stringify(value), c.get('jwtPayload').sub),
    createAuditLogStmt(c, 'DOCUMENT_LAYOUT_SET', 'app_settings', 'document_layout', old, value),
  ]);
  return c.json(await readLayout(c.env.DB));
});

// Per-user preferences (only the signed-in person's own).
const PREF_KEYS = ['dashboard'];
settings.get('/preferences/:key', async (c) => {
  const key = c.req.param('key');
  if (!PREF_KEYS.includes(key)) return c.json({ message: 'Unknown preference.' }, 404);
  const row = await c.env.DB.prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?').bind(c.get('jwtPayload').sub, key).first() as any;
  return c.json({ value: typeof row?.value === 'string' ? JSON.parse(row.value) : (row?.value ?? null) });
});
settings.put('/preferences/:key', async (c) => {
  const key = c.req.param('key');
  if (!PREF_KEYS.includes(key)) return c.json({ message: 'Unknown preference.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  let value: unknown = body.value ?? null;
  if (key === 'dashboard') {
    const widgets = Array.isArray((value as any)?.widgets) ? (value as any).widgets.filter((w: unknown) => typeof w === 'string' && /^[a-z-]{1,40}$/.test(w)).slice(0, 30) : null;
    if (!widgets) return c.json({ message: 'Choose the dashboard blocks to show.' }, 400);
    value = { widgets: Array.from(new Set(widgets)) };
  }
  await c.env.DB.prepare(`INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?::jsonb)
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`).bind(c.get('jwtPayload').sub, key, JSON.stringify(value)).run();
  return c.json({ value });
});

export default settings;
