// Company vehicles: one record per vehicle (plate, make, type, usual driver), kept in
// the Employees section and picked on deliveries, so details are not retyped each time.
//
// A vehicle does not permanently belong to one driver: its "usual driver" is only a
// suggestion, and every delivery records the vehicle and the driver of that trip.
// Branch rule: a vehicle belongs to one branch, or to the company (no branch = shared by
// all branches). A branch sees its own and the shared ones, and manages only its own.
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { has, PERM } from '../services/privacy';
import { resolveLoc, locBranch, type Loc } from '../services/branch-scope';
import { likeTerm } from '../services/listing';

const vehicles = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();
vehicles.use('/*', authMiddleware);

const text = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const canManage = (p: any) => has(p, 'manage_users') || has(p, PERM.EMPLOYEES_MANAGE);
const canPick = (p: any) => canManage(p) || has(p, 'manage_sales');

/** Vehicles the caller may see: their branch's and the company-wide ones; the company view sees all. */
function visibleSql(loc: Loc, col = 'v.branch_id'): string {
  if (loc.kind === 'ALL') return '';
  if (loc.kind === 'BRANCH') return ` AND (${col} IS NULL OR ${col} = '${loc.branchId}')`;
  return ` AND ${col} IS NULL`;
}
/** Vehicles the caller may change: the company view all, a branch only its own. */
function manageableSql(loc: Loc, col = 'v.branch_id'): string {
  if (loc.kind === 'ALL') return '';
  if (loc.kind === 'BRANCH') return ` AND ${col} = '${loc.branchId}'`;
  return ' AND FALSE';
}

const SELECT = `
  SELECT v.*, b.name AS branch_name, e.full_name AS driver_employee_name,
         (SELECT COUNT(*)::int FROM deliveries d WHERE d.vehicle_id = v.id AND d.status IN ('PENDING', 'SCHEDULED', 'DISPATCHED', 'PARTIALLY_DELIVERED')) AS open_deliveries
  FROM vehicles v
  LEFT JOIN branches b ON b.id = v.branch_id
  LEFT JOIN employees e ON e.id = v.default_driver_id`;

vehicles.get('/', async (c) => {
  const p = c.get('jwtPayload');
  if (!canPick(p)) return c.json({ message: "You don't have access to company vehicles." }, 403);
  const loc = await resolveLoc(c);
  const q = (c.req.query('q') || '').trim();
  const onlyActive = c.req.query('status') === 'ACTIVE' || c.req.query('active') === '1';
  const params: unknown[] = [];
  let where = `WHERE 1=1 ${visibleSql(loc)}`;
  if (onlyActive) where += " AND v.status = 'ACTIVE'";
  if (q) { where += ' AND (v.plate_number ILIKE ? OR COALESCE(v.make, \'\') ILIKE ? OR COALESCE(v.model, \'\') ILIKE ? OR COALESCE(v.driver_name, \'\') ILIKE ?)'; const t = likeTerm(q); params.push(t, t, t, t); }
  const { results } = await c.env.DB.prepare(`${SELECT} ${where} ORDER BY v.status, v.plate_number LIMIT 500`).bind(...params).all();
  const rows = ((results || []) as any[]).map((v) => ({ ...v, can_edit: canManage(p) && (loc.kind === 'ALL' || (loc.kind === 'BRANCH' && v.branch_id === loc.branchId)) }));
  return c.json(rows);
});

/** Validates and normalises the fields of a vehicle. */
async function readVehicle(c: any, body: any, partial: boolean) {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => { if (!partial || k in body) out[k] = v; };
  put('plate_number', text(body.plate_number ?? body.plateNumber, 30));
  put('make', text(body.make, 60)); put('model', text(body.model, 60));
  put('vehicle_type', text(body.vehicle_type ?? body.vehicleType, 40));
  put('capacity_note', text(body.capacity_note ?? body.capacityNote, 120));
  put('notes', text(body.notes, 500));
  put('driver_name', text(body.driver_name ?? body.driverName, 120));
  put('driver_phone', text(body.driver_phone ?? body.driverPhone, 40));
  if (!partial || 'status' in body) out.status = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (!partial || 'default_driver_id' in body || 'defaultDriverId' in body) {
    const id = text(body.default_driver_id ?? body.defaultDriverId, 80);
    if (id) {
      const emp = await c.env.DB.prepare('SELECT id, full_name, phone FROM employees WHERE id = ?').bind(id).first() as any;
      if (!emp) throw new Error('That employee does not exist.');
      out.default_driver_id = id;
      // The employee's name and phone are the usual driver's details unless typed differently.
      if (!out.driver_name) out.driver_name = emp.full_name;
      if (!out.driver_phone) out.driver_phone = emp.phone ?? null;
    } else out.default_driver_id = null;
  }
  if ('plate_number' in out && !out.plate_number) throw new Error('Enter the vehicle plate number.');
  return out;
}

async function plateTaken(c: any, plate: string, exceptId = ''): Promise<boolean> {
  const row = await c.env.DB.prepare(
    // Compared without spaces, hyphens or case: "HG 1234", "hg-1234" and "HG1234" are one plate.
    "SELECT id FROM vehicles WHERE upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(?, '[^A-Za-z0-9]', '', 'g')) AND id <> ?",
  ).bind(plate, exceptId).first();
  return !!row;
}

vehicles.post('/', async (c) => {
  const p = c.get('jwtPayload');
  if (!canManage(p)) return c.json({ message: "You can't add company vehicles. Ask the Owner or your manager." }, 403);
  const loc = await resolveLoc(c);
  if (loc.kind === 'WAREHOUSE') return c.json({ message: "Vehicles are registered by branches or the company." }, 403);
  const body = await c.req.json().catch(() => ({}));
  let data: Record<string, unknown>;
  try { data = await readVehicle(c, body, false); } catch (e: any) { return c.json({ message: e.message }, 400); }
  if (await plateTaken(c, String(data.plate_number))) return c.json({ message: `A vehicle with plate ${data.plate_number} is already registered.` }, 409);
  // A branch registers for itself; the company view registers a shared vehicle (or for the branch it is viewing).
  let branchId = locBranch(loc);
  if (loc.kind === 'ALL' && body.branchId) {
    if (!(await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(body.branchId).first())) return c.json({ message: 'That branch does not exist.' }, 400);
    branchId = body.branchId;
  }
  const id = uuidv4();
  const cols = Object.keys(data);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO vehicles (id, ${cols.join(', ')}, branch_id, created_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`)
      .bind(id, ...cols.map((k) => data[k]), branchId, p.sub),
    createAuditLogStmt(c, 'VEHICLE_CREATE', 'vehicles', id, null, { ...data, branchId }),
  ]);
  return c.json(await c.env.DB.prepare(`${SELECT} WHERE v.id = ?`).bind(id).first(), 201);
});

vehicles.patch('/:id', async (c) => {
  const p = c.get('jwtPayload');
  if (!canManage(p)) return c.json({ message: "You can't change company vehicles. Ask the Owner or your manager." }, 403);
  const id = c.req.param('id') as string;
  const loc = await resolveLoc(c);
  const old = await c.env.DB.prepare(`SELECT v.* FROM vehicles v WHERE v.id = ? ${manageableSql(loc)}`).bind(id).first() as any;
  if (!old) return c.json({ message: 'Vehicle not found, or it belongs to another branch or the whole company.' }, 404);
  let data: Record<string, unknown>;
  try { data = await readVehicle(c, await c.req.json().catch(() => ({})), true); } catch (e: any) { return c.json({ message: e.message }, 400); }
  if (data.plate_number && (await plateTaken(c, String(data.plate_number), id))) return c.json({ message: `A vehicle with plate ${data.plate_number} is already registered.` }, 409);
  const cols = Object.keys(data);
  if (cols.length) {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE vehicles SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...cols.map((k) => data[k]), id),
      createAuditLogStmt(c, 'VEHICLE_UPDATE', 'vehicles', id, old, data),
    ]);
  }
  return c.json(await c.env.DB.prepare(`${SELECT} WHERE v.id = ?`).bind(id).first());
});

vehicles.delete('/:id', async (c) => {
  const p = c.get('jwtPayload');
  if (!canManage(p)) return c.json({ message: "You can't remove company vehicles. Ask the Owner or your manager." }, 403);
  const id = c.req.param('id') as string;
  const loc = await resolveLoc(c);
  const v = await c.env.DB.prepare(`SELECT v.* FROM vehicles v WHERE v.id = ? ${manageableSql(loc)}`).bind(id).first() as any;
  if (!v) return c.json({ message: 'Vehicle not found, or it belongs to another branch or the whole company.' }, 404);
  const used = await c.env.DB.prepare('SELECT COUNT(*)::int AS n FROM deliveries WHERE vehicle_id = ?').bind(id).first() as any;
  if (Number(used?.n) > 0) {
    return c.json({ message: `This vehicle is on ${used.n} delivery record${used.n === 1 ? '' : 's'}, so it can't be deleted. Mark it Inactive instead: it stays in the history and no longer appears when scheduling deliveries.` }, 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM vehicles WHERE id = ?').bind(id).mustAffect('Already removed'),
    createAuditLogStmt(c, 'VEHICLE_DELETE', 'vehicles', id, { plate_number: v.plate_number }, null),
  ]);
  return c.json({ success: true });
});

/** The active vehicle with this id, if the caller may use it on a delivery. */
export async function usableVehicle(c: any, id: string): Promise<any | null> {
  const loc = await resolveLoc(c);
  return c.env.DB.prepare(`SELECT v.* FROM vehicles v WHERE v.id = ? AND v.status = 'ACTIVE' ${visibleSql(loc)}`).bind(id).first();
}

export default vehicles;
