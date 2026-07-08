import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { CreatePurchaseOrderDto, CreateSupplierDto } from './dto/create-purchase-order.dto';

@Injectable()
export class PurchasingRepository {
  constructor(private readonly db: DatabaseService) {}

  suppliers() {
    return this.db.query('SELECT id, name, phone, email, address, is_active FROM suppliers ORDER BY name');
  }

  createSupplier(dto: CreateSupplierDto) {
    return this.db.query(
      'INSERT INTO suppliers (name, phone, email, address) VALUES ($1,$2,$3,$4) RETURNING *',
      [dto.name, dto.phone ?? null, dto.email ?? null, dto.address ?? null]
    );
  }

  purchaseOrders() {
    return this.db.query(
      `SELECT po.*, s.name AS supplier_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       ORDER BY po.created_at DESC
       LIMIT 100`
    );
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, userId: string) {
    return this.db.transaction(async (client) => {
      const poNumber = `PO-${Date.now()}`;
      const po = await client.query(
        `INSERT INTO purchase_orders (po_number, supplier_id, status, expected_date, created_by)
         VALUES ($1,$2,'SUBMITTED',$3,$4) RETURNING *`,
        [poNumber, dto.supplierId, dto.expectedDate ?? null, userId]
      );
      for (const line of dto.lines) {
        await client.query(
          'INSERT INTO purchase_order_lines (purchase_order_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)',
          [po.rows[0].id, line.productId, line.quantity, line.unitCost]
        );
      }
      return po.rows[0];
    });
  }

  approvePurchaseOrder(id: string, userId: string) {
    return this.db.query(
      "UPDATE purchase_orders SET status = 'APPROVED', approved_by = $1 WHERE id = $2 RETURNING *",
      [userId, id]
    );
  }

  async createGoodsReceipt(dto: CreateGoodsReceiptDto, userId: string) {
    return this.db.transaction(async (client) => {
      const receiptNumber = `GR-${Date.now()}`;
      const receipt = await client.query(
        `INSERT INTO goods_receipts (receipt_number, purchase_order_id, warehouse_id, received_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [receiptNumber, dto.purchaseOrderId, dto.warehouseId, userId]
      );
      for (const line of dto.lines) {
        await client.query(
          'INSERT INTO goods_receipt_lines (goods_receipt_id, product_id, warehouse_location_id, quantity_received) VALUES ($1,$2,$3,$4)',
          [receipt.rows[0].id, line.productId, line.warehouseLocationId ?? null, line.quantityReceived]
        );
        await client.query(
          `INSERT INTO inventory_transactions
           (product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_location_id, reference_type, reference_id, created_by)
           VALUES ($1,'PURCHASE_RECEIPT',$2,'WAREHOUSE',$3,$4,'GOODS_RECEIPT',$5,$6)`,
          [line.productId, line.quantityReceived, dto.warehouseId, line.warehouseLocationId ?? null, receipt.rows[0].id, userId]
        );
          `UPDATE inventory_stock
           SET quantity_on_hand = quantity_on_hand + $4, updated_at = now()
           WHERE product_id = $1
             AND owner_type = 'WAREHOUSE'
             AND warehouse_id IS NOT DISTINCT FROM $2
             AND branch_id IS NULL
             AND warehouse_location_id IS NOT DISTINCT FROM $3`,
          [line.productId, dto.warehouseId, line.warehouseLocationId ?? null, line.quantityReceived]
        );
        if (updated.rowCount === 0) {
          await client.query(
            `INSERT INTO inventory_stock (product_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand)
             VALUES ($1,'WAREHOUSE',$2,$3,$4)`,
            [line.productId, dto.warehouseId, line.warehouseLocationId ?? null, line.quantityReceived]
          );
        }
      }
      await client.query(
        "UPDATE purchase_orders SET status = 'PARTIALLY_RECEIVED' WHERE id = $1 AND status <> 'RECEIVED'",
        [dto.purchaseOrderId]
      );
      return receipt.rows[0];
    });
  }

  createSupplierPayment(dto: { supplierId: string; purchaseOrderId?: string; amount: number; reference?: string }) {
    return this.db.query(
      `INSERT INTO supplier_payments (supplier_id, purchase_order_id, amount, reference)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [dto.supplierId, dto.purchaseOrderId ?? null, dto.amount, dto.reference ?? null]
    );
  }
}
