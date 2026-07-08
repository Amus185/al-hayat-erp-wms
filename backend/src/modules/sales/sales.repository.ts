import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateCustomerDto, CreateSalesOrderDto } from './dto/create-sales-order.dto';

@Injectable()
export class SalesRepository {
  constructor(private readonly db: DatabaseService) {}

  customers() {
    return this.db.query('SELECT id, name, phone, email, address, created_at FROM customers ORDER BY created_at DESC LIMIT 100');
  }

  createCustomer(dto: CreateCustomerDto) {
    return this.db.query(
      'INSERT INTO customers (name, phone, email, address) VALUES ($1,$2,$3,$4) RETURNING *',
      [dto.name, dto.phone ?? null, dto.email ?? null, dto.address ?? null]
    );
  }

  orders() {
    return this.db.query(
      `SELECT so.*, c.name AS customer_name, b.name AS branch_name
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id
       JOIN branches b ON b.id = so.branch_id
       ORDER BY so.created_at DESC
       LIMIT 100`
    );
  }

  async createOrder(dto: CreateSalesOrderDto, userId: string) {
    return this.db.transaction(async (client) => {
      const orderNumber = `SO-${Date.now()}`;
      const order = await client.query(
        `INSERT INTO sales_orders (order_number, customer_id, branch_id, status, created_by)
         VALUES ($1,$2,$3,'DRAFT',$4) RETURNING *`,
        [orderNumber, dto.customerId ?? null, dto.branchId, userId]
      );
      for (const line of dto.lines) {
        await client.query(
          'INSERT INTO sales_order_lines (sales_order_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4)',
          [order.rows[0].id, line.productId, line.quantity, line.unitPrice]
        );
      }
      return order.rows[0];
    });
  }

  confirmOrder(id: string) {
    return this.db.query("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = $1 RETURNING *", [id]);
  }

  async createInvoice(orderId: string, userId: string) {
    return this.db.transaction(async (client) => {
      // 1. Calculate total from order lines
      const totalResult = await client.query(
        'SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM sales_order_lines WHERE sales_order_id = $1',
        [orderId]
      );

      // 2. Get branch from the sales order
      const orderResult = await client.query('SELECT branch_id FROM sales_orders WHERE id = $1', [orderId]);
      const branchId = orderResult.rows[0]?.branch_id ?? null;

      // 3. Create the invoice header
      const invoice = await client.query(
        `INSERT INTO invoices (invoice_number, sales_order_id, total_amount)
         VALUES ($1, $2, $3) RETURNING *`,
        [`INV-${Date.now()}`, orderId, totalResult.rows[0].total]
      );
      const invoiceId = invoice.rows[0].id;

      // 4. Copy order lines into invoice lines
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, variant_id, quantity, unit_price)
         SELECT $1::uuid, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = $2`,
        [invoiceId, orderId]
      );

      // 5. Deduct inventory and log transactions (only if branch exists)
      if (branchId) {
        const lines = await client.query<{ product_id: string; quantity: number }>(
          'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = $1',
          [orderId]
        );
        for (const line of lines.rows) {
          // Deduct stock – silently skips if no matching row exists
          await client.query(
            `UPDATE inventory_stock
             SET quantity_on_hand = quantity_on_hand - $1, updated_at = now()
             WHERE product_id = $2 AND branch_id = $3`,
            [line.quantity, line.product_id, branchId]
          );
          // Record the transaction
          await client.query(
            `INSERT INTO inventory_transactions
             (product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
             VALUES ($1, 'SALE_ISSUE', $2, 'BRANCH', $3, 'INVOICE', $4, $5)`,
            [line.product_id, -line.quantity, branchId, invoiceId, userId]
          );
        }
      }

      // 6. Update order status
      await client.query("UPDATE sales_orders SET status = 'INVOICED' WHERE id = $1", [orderId]);

      return invoice.rows[0];
    });
  }

  payInvoice(id: string) {
    return this.db.query("UPDATE invoices SET status = 'PAID', paid_at = now() WHERE id = $1 RETURNING *", [id]);
  }

  quotations() {
    return this.db.query(
      `SELECT q.*, c.name AS customer_name, b.name AS branch_name
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN branches b ON b.id = q.branch_id
       ORDER BY q.created_at DESC
       LIMIT 100`
    );
  }

  createQuotation(dto: { customerId?: string; branchId?: string; validUntil?: string }, userId: string) {
    const quotationNumber = `QT-${Date.now()}`;
    return this.db.query(
      `INSERT INTO quotations (quotation_number, customer_id, branch_id, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [quotationNumber, dto.customerId ?? null, dto.branchId ?? null, dto.validUntil ?? null, userId]
    );
  }
}
