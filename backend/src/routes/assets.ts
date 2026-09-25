import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { 
  postPropertyPurchaseJournalEntry, 
  postRentalPaymentJournalEntry, 
  postPropertyExpenseJournalEntry, 
  postSecurityDepositReceivedJournalEntry, 
  postLivestockPurchaseJournalEntry, 
  postLivestockSaleJournalEntry, 
  postLivestockExpenseJournalEntry, 
  postLivestockDeathJournalEntry, 
  postLivestockBirthJournalEntry, 
  postPropertySaleJournalEntry 
} from '../services/accounting-service';

const assets = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

assets.use('/*', authMiddleware);

// ==========================================
// PROPERTIES
// ==========================================

assets.get('/properties', requirePermissions(['view_reports']), async (c) => {
  const query = `
    SELECT p.*,
      COALESCE((SELECT SUM(monthly_rent) FROM lease_agreements WHERE property_id = p.id AND status = 'ACTIVE'), 0) as expected_monthly_rent
    FROM properties p
    ORDER BY p.created_at DESC
  `;
  const { results } = await c.env.DB.prepare(query).all();
  return c.json(results || []);
});

assets.get('/properties/:id', requirePermissions(['view_reports']), async (c) => {
  const { id } = c.req.param();
  const property = await c.env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
  if (!property) return c.json({ error: 'Property not found' }, 404);

  const { results: leases } = await c.env.DB.prepare(`
    SELECT l.*, t.name as tenant_name 
    FROM lease_agreements l 
    JOIN tenants t ON t.id = l.tenant_id 
    WHERE l.property_id = ? 
    ORDER BY l.created_at DESC
  `).bind(id).all();

  const { results: expenses } = await c.env.DB.prepare(`
    SELECT * FROM property_expenses WHERE property_id = ? ORDER BY expense_date DESC LIMIT 50
  `).bind(id).all();

  return c.json({ ...property, leases: leases || [], expenses: expenses || [] });
});

assets.post('/properties', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();

    const price = Number(body.purchase_price || 0);

    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO properties (id, name, property_type, address, city, area_sqm, purchase_price, purchase_date, current_value, status, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, body.name, body.property_type, body.address, body.city, body.area_sqm, price, body.purchase_date, price, body.status || 'VACANT', body.notes, userId, now, now)
    ]);

    if (price > 0) {
      await postPropertyPurchaseJournalEntry(c, price, body.name, id, userId);
    }

    const created = await c.env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
    return c.json(created, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.patch('/properties/:id', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const now = new Date().toISOString();

    const existing = await c.env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const updates = [];
    const vals = [];
    const allowed = ['name', 'property_type', 'address', 'city', 'area_sqm', 'current_value', 'status', 'notes'];
    
    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      vals.push(now);
      vals.push(id);
      await c.env.DB.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
    }

    const updated = await c.env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
    return c.json(updated);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.post('/properties/:id/sell', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const salePrice = Number(body.sale_price);
    const userId = c.get('jwtPayload').sub;

    const property = await c.env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
    if (!property) return c.json({ error: 'Not found' }, 404);

    await c.env.DB.prepare("UPDATE properties SET status = 'SOLD', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    
    const bookValue = Number(property.purchase_price || 0); // simplistic book value
    await postPropertySaleJournalEntry(c, salePrice, bookValue, String(property.name), id, userId);
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ==========================================
// TENANTS
// ==========================================

assets.get('/tenants', requirePermissions(['view_reports']), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM tenants ORDER BY name ASC').all();
  return c.json(results || []);
});

assets.post('/tenants', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO tenants (id, name, phone, email, id_number, address, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.name, body.phone, body.email, body.id_number, body.address, now, now).run();

    const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    return c.json(tenant, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.patch('/tenants/:id', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const now = new Date().toISOString();
    
    const updates = [];
    const vals = [];
    const allowed = ['name', 'phone', 'email', 'id_number', 'address', 'is_active'];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      vals.push(now);
      vals.push(id);
      await c.env.DB.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
    }
    const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    return c.json(tenant);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ==========================================
// LEASE AGREEMENTS
// ==========================================

assets.get('/lease-agreements', requirePermissions(['view_reports']), async (c) => {
  const query = `
    SELECT l.*, p.name as property_name, t.name as tenant_name 
    FROM lease_agreements l
    JOIN properties p ON p.id = l.property_id
    JOIN tenants t ON t.id = l.tenant_id
    ORDER BY l.created_at DESC
  `;
  const { results } = await c.env.DB.prepare(query).all();
  return c.json(results || []);
});

assets.post('/lease-agreements', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    const deposit = Number(body.deposit_amount || 0);

    const stmts = [
      c.env.DB.prepare(`
        INSERT INTO lease_agreements (id, property_id, tenant_id, monthly_rent, start_date, end_date, payment_day, deposit_amount, status, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
      `).bind(id, body.property_id, body.tenant_id, body.monthly_rent, body.start_date, body.end_date, body.payment_day || 1, deposit, body.notes, userId, now, now),
      c.env.DB.prepare(`UPDATE properties SET status = 'RENTED', updated_at = ? WHERE id = ?`).bind(now, body.property_id)
    ];

    await c.env.DB.batch(stmts);

    if (deposit > 0) {
      const tenant = await c.env.DB.prepare('SELECT name FROM tenants WHERE id = ?').bind(body.tenant_id).first();
      await postSecurityDepositReceivedJournalEntry(c, deposit, String(tenant?.name || 'Tenant'), id, userId);
    }

    const lease = await c.env.DB.prepare('SELECT * FROM lease_agreements WHERE id = ?').bind(id).first();
    return c.json(lease, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.patch('/lease-agreements/:id', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const now = new Date().toISOString();

    const updates = [];
    const vals = [];
    const allowed = ['monthly_rent', 'end_date', 'payment_day', 'status', 'notes'];
    
    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      vals.push(now);
      vals.push(id);
      await c.env.DB.prepare(`UPDATE lease_agreements SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
      
      if (body.status === 'TERMINATED' || body.status === 'EXPIRED') {
        const lease = await c.env.DB.prepare('SELECT property_id FROM lease_agreements WHERE id = ?').bind(id).first();
        if (lease) {
          await c.env.DB.prepare("UPDATE properties SET status = 'VACANT', updated_at = ? WHERE id = ?").bind(now, lease.property_id).run();
        }
      }
    }

    const updated = await c.env.DB.prepare('SELECT * FROM lease_agreements WHERE id = ?').bind(id).first();
    return c.json(updated);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ==========================================
// RENTAL PAYMENTS
// ==========================================

assets.post('/rental-payments', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    const amount = Number(body.amount || 0);

    await c.env.DB.prepare(`
      INSERT INTO rental_payments (id, lease_agreement_id, amount, payment_method, payment_date, period_month, period_year, notes, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.lease_agreement_id, amount, body.payment_method || 'CASH', body.payment_date, body.period_month, body.period_year, body.notes, userId, now).run();

    const lease = await c.env.DB.prepare(`
      SELECT t.name FROM lease_agreements l JOIN tenants t ON t.id = l.tenant_id WHERE l.id = ?
    `).bind(body.lease_agreement_id).first();

    await postRentalPaymentJournalEntry(c, amount, String(lease?.name || 'Tenant'), id, userId);

    const payment = await c.env.DB.prepare('SELECT * FROM rental_payments WHERE id = ?').bind(id).first();
    return c.json(payment, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.get('/rental-payments', requirePermissions(['view_reports']), async (c) => {
  const { property_id, tenant_id } = c.req.query();
  let query = `
    SELECT r.*, p.name as property_name, t.name as tenant_name, u.full_name as recorded_by_name
    FROM rental_payments r
    JOIN lease_agreements l ON l.id = r.lease_agreement_id
    JOIN properties p ON p.id = l.property_id
    JOIN tenants t ON t.id = l.tenant_id
    LEFT JOIN users u ON u.id = r.recorded_by
    WHERE 1=1
  `;
  const params = [];
  if (property_id) { query += ' AND p.id = ?'; params.push(property_id); }
  if (tenant_id) { query += ' AND t.id = ?'; params.push(tenant_id); }
  query += ' ORDER BY r.payment_date DESC, r.created_at DESC';

  const stmt = c.env.DB.prepare(query);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const { results } = await bound.all();
  return c.json(results || []);
});

assets.get('/rental-summary', requirePermissions(['view_reports']), async (c) => {
  const queryExpected = `SELECT COALESCE(SUM(monthly_rent), 0) as expected FROM lease_agreements WHERE status = 'ACTIVE'`;
  const { expected } = await c.env.DB.prepare(queryExpected).first() as any || { expected: 0 };
  
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const queryCollected = `SELECT COALESCE(SUM(amount), 0) as collected FROM rental_payments WHERE period_month = ? AND period_year = ?`;
  const { collected } = await c.env.DB.prepare(queryCollected).bind(currentMonth, currentYear).first() as any || { collected: 0 };

  return c.json({
    expected_this_month: expected,
    collected_this_month: collected,
    overdue_count: 0 // Simplification for now
  });
});

// ==========================================
// PROPERTY EXPENSES
// ==========================================

assets.post('/property-expenses', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    const amount = Number(body.amount || 0);

    await c.env.DB.prepare(`
      INSERT INTO property_expenses (id, property_id, title, amount, category, expense_date, payment_method, notes, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.property_id, body.title, amount, body.category || 'MAINTENANCE', body.expense_date, body.payment_method || 'CASH', body.notes, userId, now).run();

    await postPropertyExpenseJournalEntry(c, amount, body.title, id, userId);

    const expense = await c.env.DB.prepare('SELECT * FROM property_expenses WHERE id = ?').bind(id).first();
    return c.json(expense, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.get('/property-expenses', requirePermissions(['view_reports']), async (c) => {
  const { property_id } = c.req.query();
  let query = `
    SELECT e.*, p.name as property_name, u.full_name as recorded_by_name
    FROM property_expenses e
    JOIN properties p ON p.id = e.property_id
    LEFT JOIN users u ON u.id = e.recorded_by
    WHERE 1=1
  `;
  const params = [];
  if (property_id) { query += ' AND p.id = ?'; params.push(property_id); }
  query += ' ORDER BY e.expense_date DESC, e.created_at DESC';

  const stmt = c.env.DB.prepare(query);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const { results } = await bound.all();
  return c.json(results || []);
});

// ==========================================
// LIVESTOCK
// ==========================================

assets.get('/livestock', requirePermissions(['view_reports']), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM livestock ORDER BY created_at DESC').all();
  return c.json(results || []);
});

assets.get('/livestock/:id', requirePermissions(['view_reports']), async (c) => {
  const { id } = c.req.param();
  const livestock = await c.env.DB.prepare('SELECT * FROM livestock WHERE id = ?').bind(id).first();
  if (!livestock) return c.json({ error: 'Not found' }, 404);

  const { results: transactions } = await c.env.DB.prepare('SELECT * FROM livestock_transactions WHERE livestock_id = ? ORDER BY transaction_date DESC').bind(id).all();
  const { results: expenses } = await c.env.DB.prepare('SELECT * FROM livestock_expenses WHERE livestock_id = ? ORDER BY expense_date DESC').bind(id).all();

  return c.json({ ...livestock, transactions: transactions || [], expenses: expenses || [] });
});

assets.post('/livestock', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    const cost = Number(body.unit_cost || 0);
    const qty = Number(body.quantity || 1);
    const total = cost * qty;

    await c.env.DB.prepare(`
      INSERT INTO livestock (id, animal_type, breed, tag_number, name, quantity, unit_cost, total_value, purchase_date, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `).bind(id, body.animal_type, body.breed, body.tag_number || null, body.name, qty, cost, total, body.purchase_date, body.notes, userId, now, now).run();

    if (total > 0) {
      await postLivestockPurchaseJournalEntry(c, total, `${qty} ${body.animal_type} (${body.breed || 'Unknown'})`, id, userId);
    }

    const ls = await c.env.DB.prepare('SELECT * FROM livestock WHERE id = ?').bind(id).first();
    return c.json(ls, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.patch('/livestock/:id', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const now = new Date().toISOString();

    const updates = [];
    const vals = [];
    const allowed = ['name', 'tag_number', 'status', 'notes'];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      vals.push(now);
      vals.push(id);
      await c.env.DB.prepare(`UPDATE livestock SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
    }
    const ls = await c.env.DB.prepare('SELECT * FROM livestock WHERE id = ?').bind(id).first();
    return c.json(ls);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.post('/livestock/:id/sell', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    
    const ls = await c.env.DB.prepare('SELECT * FROM livestock WHERE id = ?').bind(id).first() as any;
    if (!ls) return c.json({ error: 'Not found' }, 404);

    const sellQty = Number(body.quantity || ls.quantity);
    const sellPrice = Number(body.total_amount);
    
    // Simplistic: proportional cost
    const proportion = sellQty / Number(ls.quantity);
    const costOfSold = Number(ls.total_value) * proportion;

    const txId = uuidv4();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO livestock_transactions (id, livestock_id, transaction_type, quantity, unit_price, total_amount, buyer_seller_name, transaction_date, notes, recorded_by, created_at)
        VALUES (?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(txId, id, sellQty, sellPrice / sellQty, sellPrice, body.buyer_seller_name, body.transaction_date, body.notes, userId, now),
      c.env.DB.prepare(`
        UPDATE livestock SET 
          quantity = quantity - ?,
          total_value = total_value - ?,
          status = CASE WHEN quantity - ? <= 0 THEN 'SOLD' ELSE status END,
          updated_at = ?
        WHERE id = ?
      `).bind(sellQty, costOfSold, sellQty, now, id)
    ]);

    await postLivestockSaleJournalEntry(c, sellPrice, costOfSold, `Sale of ${sellQty} ${ls.animal_type}`, txId, userId);
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.post('/livestock/:id/birth', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    
    const qty = Number(body.quantity || 1);
    const estValue = Number(body.estimated_value || 0);
    const txId = uuidv4();

    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO livestock_transactions (id, livestock_id, transaction_type, quantity, unit_price, total_amount, transaction_date, notes, recorded_by, created_at)
        VALUES (?, ?, 'BIRTH', ?, ?, ?, ?, ?, ?, ?)
      `).bind(txId, id, qty, estValue / qty, estValue, body.transaction_date || now, body.notes, userId, now),
      c.env.DB.prepare(`
        UPDATE livestock SET 
          quantity = quantity + ?,
          total_value = total_value + ?,
          updated_at = ?
        WHERE id = ?
      `).bind(qty, estValue, now, id)
    ]);

    if (estValue > 0) {
      await postLivestockBirthJournalEntry(c, estValue, `Birth of ${qty} offspring`, txId, userId);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.post('/livestock/:id/death', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    
    const ls = await c.env.DB.prepare('SELECT * FROM livestock WHERE id = ?').bind(id).first() as any;
    if (!ls) return c.json({ error: 'Not found' }, 404);

    const deathQty = Number(body.quantity || 1);
    const proportion = deathQty / Number(ls.quantity);
    const lostValue = Number(ls.total_value) * proportion;
    const txId = uuidv4();

    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO livestock_transactions (id, livestock_id, transaction_type, quantity, total_amount, transaction_date, notes, recorded_by, created_at)
        VALUES (?, ?, 'DEATH', ?, ?, ?, ?, ?, ?)
      `).bind(txId, id, deathQty, lostValue, body.transaction_date || now, body.notes, userId, now),
      c.env.DB.prepare(`
        UPDATE livestock SET 
          quantity = quantity - ?,
          total_value = total_value - ?,
          status = CASE WHEN quantity - ? <= 0 THEN 'DECEASED' ELSE status END,
          updated_at = ?
        WHERE id = ?
      `).bind(deathQty, lostValue, deathQty, now, id)
    ]);

    if (lostValue > 0) {
      await postLivestockDeathJournalEntry(c, lostValue, `Death of ${deathQty} ${ls.animal_type}`, txId, userId);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ==========================================
// LIVESTOCK EXPENSES
// ==========================================

assets.post('/livestock-expenses', requirePermissions(['manage_purchasing']), async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const userId = c.get('jwtPayload').sub;
    const now = new Date().toISOString();
    const amount = Number(body.amount || 0);

    await c.env.DB.prepare(`
      INSERT INTO livestock_expenses (id, livestock_id, title, amount, category, expense_date, payment_method, notes, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.livestock_id || null, body.title, amount, body.category || 'FEED', body.expense_date, body.payment_method || 'CASH', body.notes, userId, now).run();

    await postLivestockExpenseJournalEntry(c, amount, body.title, id, userId);

    const exp = await c.env.DB.prepare('SELECT * FROM livestock_expenses WHERE id = ?').bind(id).first();
    return c.json(exp, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

assets.get('/livestock-expenses', requirePermissions(['view_reports']), async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT e.*, l.name as livestock_name, u.full_name as recorded_by_name
    FROM livestock_expenses e
    LEFT JOIN livestock l ON l.id = e.livestock_id
    LEFT JOIN users u ON u.id = e.recorded_by
    ORDER BY e.expense_date DESC, e.created_at DESC
  `).all();
  return c.json(results || []);
});

// ==========================================
// DASHBOARD
// ==========================================

assets.get('/dashboard', requirePermissions(['view_reports']), async (c) => {
  try {
    const propertyValue = await c.env.DB.prepare("SELECT COALESCE(SUM(current_value), 0) as val FROM properties WHERE status != 'SOLD'").first() as any;
    const livestockValue = await c.env.DB.prepare("SELECT COALESCE(SUM(total_value), 0) as val FROM livestock WHERE status = 'ACTIVE'").first() as any;
    
    const rentExpected = await c.env.DB.prepare("SELECT COALESCE(SUM(monthly_rent), 0) as val FROM lease_agreements WHERE status = 'ACTIVE'").first() as any;
    
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    const rentCollected = await c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as val FROM rental_payments WHERE period_month = ? AND period_year = ?").bind(month, year).first() as any;

    const lsRevenue = await c.env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) as val FROM livestock_transactions WHERE transaction_type = 'SALE' AND transaction_date LIKE ?").bind(`${year}-%`).first() as any;
    const lsExpenses = await c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as val FROM livestock_expenses WHERE expense_date LIKE ?").bind(`${year}-%`).first() as any;

    return c.json({
      total_property_value: propertyValue?.val || 0,
      monthly_rental_expected: rentExpected?.val || 0,
      monthly_rental_collected: rentCollected?.val || 0,
      overdue_rents: 0,
      total_livestock_value: livestockValue?.val || 0,
      livestock_revenue_ytd: lsRevenue?.val || 0,
      livestock_expenses_ytd: lsExpenses?.val || 0,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default assets;
