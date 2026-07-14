import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const reports = new Hono<{ Bindings: Env }>();

reports.use('/*', authMiddleware, requirePermissions(['view_reports']));

reports.get('/inventory-value', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0) as inventory_value,
      COALESCE(SUM(s.quantity_on_hand), 0) as units_on_hand
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
  `).all();
  return c.json(results[0]);
});

reports.get('/low-stock', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.name AS product_name, p.sku, p.barcode,
           s.owner_type, s.warehouse_id, s.branch_id,
           s.quantity_on_hand, p.reorder_level,
           w.name AS warehouse_name, b.name AS branch_name
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE s.quantity_on_hand <= p.reorder_level
    ORDER BY (s.quantity_on_hand - p.reorder_level) ASC
  `).all();
  return c.json(results);
});

reports.get('/sales-summary', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      DATE(so.created_at) as date,
      COUNT(DISTINCT so.id) as total_orders,
      COALESCE(SUM(i.total_amount), 0) as revenue
    FROM sales_orders so
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    GROUP BY DATE(so.created_at)
    ORDER BY date DESC
    LIMIT 30
  `).all();
  return c.json(results);
});

reports.get('/branches', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT b.code as code, 
           b.name as name,
           COUNT(DISTINCT so.id) as orders,
           COALESCE(SUM(i.total_amount), 0) as revenue
    FROM branches b
    LEFT JOIN sales_orders so ON so.branch_id = b.id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    GROUP BY b.id, b.code, b.name
    ORDER BY revenue DESC
  `).all();
  return c.json(results);
});

reports.get('/profit', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT 
      (SELECT COALESCE(SUM(total_amount), 0) FROM invoices) as total_revenue,
      (SELECT COALESCE(SUM(il.quantity * p.cost_price), 0) FROM invoice_lines il JOIN products p ON p.id = il.product_id) as total_cost
  `).first();
  
  const revenue = (result?.total_revenue as number) || 0;
  const cost = (result?.total_cost as number) || 0;
  
  return c.json({
    total_revenue: revenue,
    total_cost: cost,
    gross_profit: revenue - cost
  });
});

reports.get('/sales', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      DATE(so.created_at) as day,
      COUNT(DISTINCT so.id) as invoices,
      COALESCE(SUM(i.total_amount), 0) as revenue
    FROM sales_orders so
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.created_at >= DATE('now', '-30 days')
    GROUP BY DATE(so.created_at)
    ORDER BY day ASC
  `).all();
  return c.json(results);
});

export default reports;
