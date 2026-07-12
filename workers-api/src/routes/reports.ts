import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const reports = new Hono<{ Bindings: Env }>();

reports.use('/*', authMiddleware, requirePermissions(['view_reports']));

reports.get('/inventory-value', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT SUM(s.quantity_on_hand * p.cost_price) as inventory_value
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
      DATE(created_at) as date,
      COUNT(id) as total_orders,
      (SELECT SUM(total_amount) FROM invoices WHERE sales_order_id = sales_orders.id) as revenue
    FROM sales_orders
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 30
  `).all();
  return c.json(results);
});

reports.get('/branches', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT b.name as branch_name,
           COUNT(so.id) as total_orders,
           SUM(i.total_amount) as revenue
    FROM branches b
    LEFT JOIN sales_orders so ON so.branch_id = b.id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    GROUP BY b.id, b.name
    ORDER BY revenue DESC
  `).all();
  return c.json(results);
});

reports.get('/profit', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      SUM(i.total_amount) as total_revenue,
      SUM(il.quantity * p.cost_price) as total_cost
    FROM invoices i
    JOIN invoice_lines il ON il.invoice_id = i.id
    JOIN products p ON p.id = il.product_id
  `).all();
  return c.json(results[0]);
});

reports.get('/sales', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      DATE(created_at) as date,
      COUNT(id) as total_orders,
      SUM(total_amount) as revenue
    FROM sales_orders
    WHERE created_at >= DATE('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();
  return c.json(results);
});

export default reports;
