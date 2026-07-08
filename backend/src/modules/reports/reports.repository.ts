import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ReportsRepository {
  constructor(private readonly db: DatabaseService) {}

  inventoryValueOverview() {
    return this.db.query(
      `SELECT
         COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0)::float AS total_value,
         COUNT(DISTINCT p.sku)::int AS total_skus
       FROM inventory_stock s
       JOIN products p ON p.id = s.product_id`
    );
  }

  inventoryValueByWarehouse() {
    return this.db.query(
      `SELECT
         COALESCE(w.name, 'Unknown') AS warehouse,
         COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0)::float AS value,
         COUNT(DISTINCT p.sku)::int AS sku_count
       FROM inventory_stock s
       JOIN products p ON p.id = s.product_id
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       WHERE s.owner_type = 'WAREHOUSE'
       GROUP BY w.id, w.name
       ORDER BY value DESC`
    );
  }

  inventoryValueByCategory() {
    return this.db.query(
      `SELECT
         COALESCE(c.name, 'Uncategorized') AS category,
         COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0)::float AS value,
         COUNT(DISTINCT p.sku)::int AS sku_count
       FROM inventory_stock s
       JOIN products p ON p.id = s.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       GROUP BY c.id, c.name
       ORDER BY value DESC`
    );
  }

  lowStock() {
    return this.db.query(
      `SELECT
         p.name AS product_name,
         p.sku AS variant_sku,
         p.barcode AS barcode,
         COALESCE(s.quantity_on_hand, 0)::int AS current_stock,
         p.reorder_level::int AS reorder_level,
         (p.reorder_level - COALESCE(s.quantity_on_hand, 0))::int AS deficit,
         w.name AS warehouse,
         b.name AS branch
       FROM products p
       LEFT JOIN inventory_stock s ON s.product_id = p.id
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE COALESCE(s.quantity_on_hand, 0) < p.reorder_level
       ORDER BY deficit DESC`
    );
  }

  salesOverview() {
    return this.db.query(
      `SELECT
         COALESCE(SUM(i.total_amount), 0)::float AS total_revenue,
         COUNT(DISTINCT so.id)::int AS total_orders,
         COALESCE(AVG(i.total_amount), 0)::float AS avg_order_value
       FROM sales_orders so
       LEFT JOIN invoices i ON i.sales_order_id = so.id
       WHERE so.status != 'CANCELLED'`
    );
  }

  salesByBranch() {
    return this.db.query(
      `SELECT
         b.name AS branch,
         COALESCE(SUM(i.total_amount), 0)::float AS revenue,
         COUNT(DISTINCT so.id)::int AS orders
       FROM branches b
       LEFT JOIN sales_orders so ON so.branch_id = b.id AND so.status != 'CANCELLED'
       LEFT JOIN invoices i ON i.sales_order_id = so.id AND i.status != 'CANCELLED'
       GROUP BY b.id, b.name
       ORDER BY revenue DESC`
    );
  }

  salesByPeriod() {
    return this.db.query(
      `SELECT
         TO_CHAR(i.issued_at, 'YYYY-MM-DD') AS period,
         COALESCE(SUM(i.total_amount), 0)::float AS revenue,
         COUNT(DISTINCT so.id)::int AS orders
       FROM sales_orders so
       JOIN invoices i ON i.sales_order_id = so.id
       WHERE so.status != 'CANCELLED' AND i.status != 'CANCELLED'
       GROUP BY TO_CHAR(i.issued_at, 'YYYY-MM-DD')
       ORDER BY period DESC
       LIMIT 30`
    );
  }

  profitOverview() {
    return this.db.query(
      `SELECT
         COALESCE(SUM(sol.quantity * sol.unit_price), 0)::float AS total_revenue,
         COALESCE(SUM(sol.quantity * p.cost_price), 0)::float AS total_cost
       FROM sales_order_lines sol
       JOIN sales_orders so ON so.id = sol.sales_order_id
       JOIN products p ON p.id = sol.product_id
       WHERE so.status != 'CANCELLED'`
    );
  }

  profitByCategory() {
    return this.db.query(
      `SELECT
         COALESCE(c.name, 'Uncategorized') AS category,
         COALESCE(SUM(sol.quantity * sol.unit_price), 0)::float AS revenue,
         COALESCE(SUM(sol.quantity * p.cost_price), 0)::float AS cost,
         COALESCE(SUM(sol.quantity * (sol.unit_price - p.cost_price)), 0)::float AS profit
       FROM sales_order_lines sol
       JOIN sales_orders so ON so.id = sol.sales_order_id
       JOIN products p ON p.id = sol.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE so.status != 'CANCELLED'
       GROUP BY c.id, c.name
       ORDER BY profit DESC`
    );
  }

  branches() {
    return this.db.query(
      `SELECT
         b.id,
         b.code,
         b.name,
         b.city,
         b.address,
         b.phone,
         b.is_active,
         COALESCE((
           SELECT SUM(s.quantity_on_hand * p.cost_price)
           FROM inventory_stock s
           JOIN products p ON p.id = s.product_id
           WHERE s.branch_id = b.id
         ), 0)::float AS inventory_value,
         COALESCE((
           SELECT COUNT(DISTINCT so.id)
           FROM sales_orders so
           WHERE so.branch_id = b.id AND so.status != 'CANCELLED'
         ), 0)::int AS total_orders,
         COALESCE((
           SELECT COUNT(DISTINCT s.product_id)
           FROM inventory_stock s
           WHERE s.branch_id = b.id AND s.quantity_on_hand > 0
         ), 0)::int AS sku_count
       FROM branches b
       ORDER BY inventory_value DESC`
    );
  }
}


