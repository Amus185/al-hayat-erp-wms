import { uuidv4 } from '../db';

function isDeepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!isDeepEqual(a[i], b[i])) return false;
      }
      return true;
    } else {
      if (Array.isArray(b)) return false;
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      for (const key of keysA) {
        if (key === 'updated_at' || key === 'created_at') continue; // ignore timestamp diffs
        if (!keysB.includes(key)) return false;
        if (!isDeepEqual(a[key], b[key])) return false;
      }
      return true;
    }
  }
  return false;
}

export function createAuditLogStmt(
  c: any,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue?: any,
  newValue?: any
) {
  // Prevent duplicate/empty audits
  if (oldValue !== undefined && newValue !== undefined && isDeepEqual(oldValue, newValue)) {
    return null;
  }

  const id = uuidv4();
  let actorUserId = null;
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload && jwtPayload.sub) actorUserId = jwtPayload.sub;
  } catch (_) {}

  let ipAddress = null;
  let userAgent = null;
  try {
    ipAddress =
      c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For') ||
      c.req.header('x-real-ip') ||
      null;
    userAgent = c.req.header('User-Agent') || null;
  } catch (_) {}

  const oldValStr = oldValue !== undefined && oldValue !== null
    ? (typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue))
    : null;
  const newValStr = newValue !== undefined && newValue !== null
    ? (typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue))
    : null;

  return c.env.DB.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, actorUserId, action, entityType, entityId, oldValStr, newValStr, ipAddress, userAgent);
}

export async function logAudit(
  c: any,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue?: any,
  newValue?: any
) {
  try {
    const stmt = createAuditLogStmt(c, action, entityType, entityId, oldValue, newValue);
    if (stmt) {
      await stmt.run();
    }
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
