import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const reports = new Hono<{ Bindings: Env }>();

reports.use('/*', authMiddleware, requirePermissions(['view_reports']));

// Helper to sanitize days param (default 30, max 3650)
function getDaysParam(c: any): number {
  const daysStr = c.req.query('days');
  const parsed = parseInt(daysStr || '30', 10);
  return isNaN(parsed) || parsed <= 0 ? 30 : Math.min(parsed, 3650);
}

// 1. Low Stock Risk
reports.get('/low-stock', async (c) => {
  const warehouseId = c.req.query('warehouseId') || null;
  const branchId = c.req.query('branchId') || null;
  const categoryId = c.req.query('categoryId') || null;

  let query = `
    SELECT 
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.barcode,
      c.name AS category_name,
      s.owner_type,
      s.warehouse_id,
      s.branch_id,
      COALESCE(s.quantity_on_hand, 0) AS quantity_on_hand,
      p.reorder_level,
      w.name AS warehouse_name,
      b.name AS branch_name,
      CASE 
        WHEN COALESCE(s.quantity_on_hand, 0) <= 0 THEN 'CRITICAL'
        WHEN COALESCE(s.quantity_on_hand, 0) <= p.reorder_level THEN 'LOW'
        ELSE 'OK'
      END AS status_risk
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (warehouseId) {
    query += ` AND s.warehouse_id = ?`;
    params.push(warehouseId);
  }
  if (branchId) {
    query += ` AND s.branch_id = ?`;
    params.push(branchId);
  }
  if (categoryId) {
    query += ` AND p.category_id = ?`;
    params.push(categoryId);
  }

  // By default, show items at or below reorder level if no explicit location filter is set
  if (!warehouseId && !branchId && !categoryId) {
    query += ` AND s.quantity_on_hand <= p.reorder_level`;
  }

  query += ` ORDER BY (COALESCE(s.quantity_on_hand, 0) - p.reorder_level) ASC, p.name ASC`;

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results || []);
});

// 2. Branch Performance
reports.get('/branch-performance', async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;

  const { results } = await c.env.DB.prepare(`
    SELECT 
      b.id,
      b.code,
      b.name,
      b.city,
      COUNT(DISTINCT so.id) AS order_count,
      COALESCE(SUM(i.total_amount), 0) AS total_revenue,
      COALESCE(SUM(
        (SELECT COALESCE(SUM(il.quantity * (il.unit_price - p.cost_price)), 0)
         FROM invoice_lines il 
         JOIN products p ON p.id = il.product_id 
         WHERE il.invoice_id = i.id)
      ), 0) AS gross_profit
    FROM branches b
    LEFT JOIN sales_orders so ON so.branch_id = b.id AND so.created_at >= DATE('now', ?)
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    GROUP BY b.id, b.code, b.name, b.city
    ORDER BY total_revenue DESC
  `).bind(daysModifier).all();

  const formatted = (results || []).map((r: any) => {
    const revenue = Number(r.total_revenue || 0);
    const profit = Number(r.gross_profit || 0);
    const orders = Number(r.order_count || 0);
    return {
      ...r,
      total_revenue: revenue,
      gross_profit: profit,
      order_count: orders,
      avg_order_value: orders > 0 ? revenue / orders : 0,
      margin_pct: revenue > 0 ? (profit / revenue) * 100 : 0
    };
  });

  return c.json(formatted);
});

// 3. Inventory Asset Valuation
reports.get('/inventory-valuation', async (c) => {
  const categoryId = c.req.query('categoryId') || null;

  // 1. Overall Summary
  const summaryRes = await c.env.DB.prepare(`
    SELECT 
      COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0) AS total_cost_value,
      COALESCE(SUM(s.quantity_on_hand * p.selling_price), 0) AS total_retail_value,
      COALESCE(SUM(s.quantity_on_hand), 0) AS total_units
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
  `).first();

  // 2. Asset Breakdown by Category
  let catQuery = `
    SELECT 
      COALESCE(c.name, 'Uncategorized') AS category_name,
      COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0) AS cost_value,
      COALESCE(SUM(s.quantity_on_hand), 0) AS units
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN categories c ON c.id = p.category_id
  `;
  if (categoryId) {
    catQuery += ` WHERE p.category_id = ?`;
  }
  catQuery += ` GROUP BY c.id, c.name ORDER BY cost_value DESC`;
  
  const catStmt = c.env.DB.prepare(catQuery);
  const { results: categoryBreakdown } = categoryId ? await catStmt.bind(categoryId).all() : await catStmt.all();

  // 3. Dead Stock (No sales in last 90 days, but inventory > 0)
  const { results: deadStock } = await c.env.DB.prepare(`
    SELECT 
      p.id,
      p.sku,
      p.name AS product_name,
      COALESCE(c.name, 'Uncategorized') AS category_name,
      SUM(s.quantity_on_hand) AS units_on_hand,
      p.cost_price,
      (SUM(s.quantity_on_hand) * p.cost_price) AS tied_up_capital
    FROM products p
    JOIN inventory_stock s ON s.product_id = p.id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id NOT IN (
      SELECT DISTINCT sol.product_id
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE so.created_at >= DATE('now', '-90 days')
    )
    GROUP BY p.id, p.sku, p.name, c.name, p.cost_price
    HAVING units_on_hand > 0
    ORDER BY tied_up_capital DESC
    LIMIT 25
  `).all();

  return c.json({
    summary: {
      total_cost_value: Number(summaryRes?.total_cost_value || 0),
      total_retail_value: Number(summaryRes?.total_retail_value || 0),
      total_units: Number(summaryRes?.total_units || 0),
    },
    category_breakdown: categoryBreakdown || [],
    dead_stock: deadStock || []
  });
});

// 4. Sales & Profit Analysis
reports.get('/sales-profit', async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;

  // Summary & Daily Trend
  const { results: dailyTrend } = await c.env.DB.prepare(`
    SELECT 
      DATE(so.created_at) AS day,
      COUNT(DISTINCT so.id) AS order_count,
      COALESCE(SUM(sol.quantity * sol.unit_price), 0) AS revenue,
      COALESCE(SUM(sol.quantity * (sol.unit_price - p.cost_price)), 0) AS profit
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.sales_order_id = so.id
    JOIN products p ON p.id = sol.product_id
    WHERE so.created_at >= DATE('now', ?)
    GROUP BY DATE(so.created_at)
    ORDER BY day ASC
  `).bind(daysModifier).all();

  // Aggregate totals
  let totalRevenue = 0;
  let totalProfit = 0;
  let totalOrders = 0;

  (dailyTrend || []).forEach((d: any) => {
    totalRevenue += Number(d.revenue || 0);
    totalProfit += Number(d.profit || 0);
    totalOrders += Number(d.order_count || 0);
  });

  // Top Products by Margin
  const { results: topProducts } = await c.env.DB.prepare(`
    SELECT 
      p.id,
      p.name AS product_name,
      p.sku,
      COALESCE(b.name, 'N/A') AS brand_name,
      COALESCE(c.name, 'N/A') AS category_name,
      SUM(sol.quantity) AS units_sold,
      SUM(sol.quantity * sol.unit_price) AS revenue,
      SUM(sol.quantity * (sol.unit_price - p.cost_price)) AS profit
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    JOIN products p ON p.id = sol.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE so.created_at >= DATE('now', ?)
    GROUP BY p.id, p.name, p.sku, b.name, c.name
    ORDER BY profit DESC
    LIMIT 15
  `).bind(daysModifier).all();

  const formattedProducts = (topProducts || []).map((p: any) => {
    const rev = Number(p.revenue || 0);
    const prof = Number(p.profit || 0);
    return {
      ...p,
      revenue: rev,
      profit: prof,
      margin_pct: rev > 0 ? (prof / rev) * 100 : 0
    };
  });

  // Top Customers by Revenue
  const { results: topCustomers } = await c.env.DB.prepare(`
    SELECT 
      cust.id,
      cust.name AS customer_name,
      COUNT(DISTINCT so.id) AS order_count,
      COALESCE(SUM(sol.quantity * sol.unit_price), 0) AS total_spent,
      MAX(so.created_at) AS last_order_date
    FROM customers cust
    JOIN sales_orders so ON so.customer_id = cust.id
    JOIN sales_order_lines sol ON sol.sales_order_id = so.id
    WHERE so.created_at >= DATE('now', ?)
    GROUP BY cust.id, cust.name
    ORDER BY total_spent DESC
    LIMIT 15
  `).bind(daysModifier).all();

  return c.json({
    summary: {
      total_revenue: totalRevenue,
      gross_profit: totalProfit,
      total_orders: totalOrders,
      avg_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      margin_pct: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    },
    daily_trend: dailyTrend || [],
    top_products: formattedProducts,
    top_customers: topCustomers || []
  });
});

// 5. Quote Conversion
reports.get('/quote-conversion', async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;

  // Summary Metrics
  const summaryRes = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) AS total_quotes,
      SUM(CASE WHEN status IN ('ACCEPTED', 'CONVERTED') OR id IN (SELECT DISTINCT quotation_id FROM sales_orders WHERE quotation_id IS NOT NULL) THEN 1 ELSE 0 END) AS converted_quotes,
      AVG(CASE WHEN id IN (SELECT DISTINCT quotation_id FROM sales_orders WHERE quotation_id IS NOT NULL) THEN 
        (JULIANDAY((SELECT created_at FROM sales_orders WHERE quotation_id = q.id LIMIT 1)) - JULIANDAY(q.created_at))
      ELSE NULL END) AS avg_days_to_convert
    FROM quotations q
    WHERE q.created_at >= DATE('now', ?)
  `).bind(daysModifier).first();

  const totalQuotes = Number(summaryRes?.total_quotes || 0);
  const convertedQuotes = Number(summaryRes?.converted_quotes || 0);

  // Daily/Monthly Trend
  const { results: trend } = await c.env.DB.prepare(`
    SELECT 
      DATE(q.created_at) AS day,
      COUNT(*) AS total_created,
      SUM(CASE WHEN q.status IN ('ACCEPTED', 'CONVERTED') OR q.id IN (SELECT DISTINCT quotation_id FROM sales_orders WHERE quotation_id IS NOT NULL) THEN 1 ELSE 0 END) AS total_converted
    FROM quotations q
    WHERE q.created_at >= DATE('now', ?)
    GROUP BY DATE(q.created_at)
    ORDER BY day ASC
  `).bind(daysModifier).all();

  // Quotation log table
  const { results: quotesList } = await c.env.DB.prepare(`
    SELECT 
      q.id,
      q.quotation_number,
      c.name AS customer_name,
      b.name AS branch_name,
      q.status,
      q.created_at,
      so.id AS sales_order_id,
      so.order_number AS sales_order_number,
      so.created_at AS order_created_at,
      ROUND(JULIANDAY(so.created_at) - JULIANDAY(q.created_at), 1) AS days_to_convert
    FROM quotations q
    LEFT JOIN customers c ON c.id = q.customer_id
    LEFT JOIN branches b ON b.id = q.branch_id
    LEFT JOIN sales_orders so ON so.quotation_id = q.id
    WHERE q.created_at >= DATE('now', ?)
    ORDER BY q.created_at DESC
    LIMIT 30
  `).bind(daysModifier).all();

  return c.json({
    summary: {
      total_quotes: totalQuotes,
      converted_quotes: convertedQuotes,
      conversion_rate_pct: totalQuotes > 0 ? (convertedQuotes / totalQuotes) * 100 : 0,
      avg_days_to_convert: Number((summaryRes?.avg_days_to_convert as number || 0).toFixed(1))
    },
    trend: trend || [],
    quotes_list: quotesList || []
  });
});

// 6. Purchasing & Supplier Performance
reports.get('/supplier-performance', async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;

  // Summary Metrics
  const summaryRes = await c.env.DB.prepare(`
    SELECT 
      COUNT(DISTINCT po.id) AS po_count,
      COUNT(DISTINCT po.supplier_id) AS active_suppliers,
      COALESCE(SUM(pol.quantity * pol.unit_cost), 0) AS total_spend,
      SUM(CASE WHEN gr.id IS NOT NULL AND DATE(gr.received_at) <= DATE(po.expected_date) THEN 1 ELSE 0 END) AS on_time_count,
      COUNT(DISTINCT gr.id) AS total_received_gr
    FROM purchase_orders po
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id
    WHERE po.created_at >= DATE('now', ?)
  `).bind(daysModifier).first();

  // Spend by Supplier Chart
  const { results: supplierSpend } = await c.env.DB.prepare(`
    SELECT 
      s.name AS supplier_name,
      COUNT(DISTINCT po.id) AS po_count,
      COALESCE(SUM(pol.quantity * pol.unit_cost), 0) AS total_spend
    FROM suppliers s
    JOIN purchase_orders po ON po.supplier_id = s.id
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    WHERE po.created_at >= DATE('now', ?)
    GROUP BY s.id, s.name
    ORDER BY total_spend DESC
  `).bind(daysModifier).all();

  // Supplier Scorecard Table
  const { results: scorecard } = await c.env.DB.prepare(`
    SELECT 
      s.id,
      s.name AS supplier_name,
      s.contact_name,
      s.phone,
      s.email,
      COUNT(DISTINCT po.id) AS total_pos,
      COALESCE(SUM(pol.quantity * pol.unit_cost), 0) AS total_spend,
      SUM(CASE WHEN gr.id IS NOT NULL THEN 1 ELSE 0 END) AS received_pos,
      SUM(CASE WHEN gr.id IS NOT NULL AND po.expected_date IS NOT NULL AND DATE(gr.received_at) <= DATE(po.expected_date) THEN 1 ELSE 0 END) AS on_time_pos
    FROM suppliers s
    LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND po.created_at >= DATE('now', ?)
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id
    GROUP BY s.id, s.name, s.contact_name, s.phone, s.email
    ORDER BY total_spend DESC
  `).bind(daysModifier).all();

  const formattedScorecard = (scorecard || []).map((sc: any) => {
    const received = Number(sc.received_pos || 0);
    const onTime = Number(sc.on_time_pos || 0);
    return {
      ...sc,
      total_spend: Number(sc.total_spend || 0),
      on_time_delivery_pct: received > 0 ? (onTime / received) * 100 : 100
    };
  });

  const totalReceived = Number(summaryRes?.total_received_gr || 0);
  const onTimeCount = Number(summaryRes?.on_time_count || 0);

  return c.json({
    summary: {
      po_count: Number(summaryRes?.po_count || 0),
      active_suppliers: Number(summaryRes?.active_suppliers || 0),
      total_spend: Number(summaryRes?.total_spend || 0),
      on_time_delivery_rate_pct: totalReceived > 0 ? (onTimeCount / totalReceived) * 100 : 100
    },
    supplier_spend: supplierSpend || [],
    scorecard: formattedScorecard
  });
});

// 7. Receivables / Cash Flow Aging
reports.get('/receivables', async (c) => {
  const days = getDaysParam(c);

  const { results: invoices } = await c.env.DB.prepare(`
    SELECT 
      i.id,
      i.invoice_number,
      i.status,
      i.total_amount,
      i.issued_at,
      i.paid_at,
      cust.name AS customer_name,
      so.order_number,
      CAST(
        CASE 
          WHEN i.status = 'PAID' THEN 0
          ELSE (JULIANDAY('now') - JULIANDAY(i.issued_at))
        END AS INTEGER
      ) AS days_outstanding
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    LEFT JOIN customers cust ON cust.id = so.customer_id
    ORDER BY i.issued_at DESC
  `).all();

  let totalInvoiced = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;

  let current0to30 = 0;
  let overdue31to60 = 0;
  let overdue61to90 = 0;
  let overdue90plus = 0;

  const formattedInvoices = (invoices || []).map((inv: any) => {
    const amt = Number(inv.total_amount || 0);
    const status = inv.status;
    const daysOut = Number(inv.days_outstanding || 0);

    totalInvoiced += amt;
    if (status === 'PAID') {
      totalPaid += amt;
    } else {
      totalOutstanding += amt;
      if (daysOut <= 30) {
        current0to30 += amt;
      } else if (daysOut <= 60) {
        overdue31to60 += amt;
      } else if (daysOut <= 90) {
        overdue61to90 += amt;
      } else {
        overdue90plus += amt;
      }
    }

    return {
      ...inv,
      total_amount: amt,
      days_outstanding: daysOut,
      aging_bracket: status === 'PAID' ? 'Paid' : daysOut <= 30 ? '0-30 Days' : daysOut <= 60 ? '31-60 Days' : daysOut <= 90 ? '61-90 Days' : '90+ Days'
    };
  });

  const agingBreakdown = [
    { bracket: '0-30 Days (Current)', amount: current0to30 },
    { bracket: '31-60 Days Overdue', amount: overdue31to60 },
    { bracket: '61-90 Days Overdue', amount: overdue61to90 },
    { bracket: '90+ Days Overdue', amount: overdue90plus }
  ];

  return c.json({
    summary: {
      total_invoiced: totalInvoiced,
      total_paid: totalPaid,
      total_outstanding: totalOutstanding,
      total_overdue: overdue31to60 + overdue61to90 + overdue90plus
    },
    aging_breakdown: agingBreakdown,
    invoices: formattedInvoices
  });
});

export default reports;
