import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AdjustmentDirection, CreateAdjustmentDto } from './dto/create-adjustment.dto';

@Injectable()
export class InventoryRepository {
  constructor(private readonly db: DatabaseService) {}

  stock() {
    return this.db.query(
      `SELECT p.name, p.sku, p.barcode, s.owner_type, s.quantity_on_hand, s.quantity_reserved,
              w.name AS warehouse, b.name AS branch, l.aisle, l.rack, l.shelf, l.bin
       FROM inventory_stock s
       JOIN products p ON p.id = s.product_id
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
       ORDER BY p.name`
    );
  }

  async stockPaginated(filters: {
    search?: string;
    warehouseId?: string;
    branchId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Number(filters.page ?? 1);
    const pageSize = Number(filters.pageSize ?? 10);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.search) {
      conditions.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
      values.push(`%${filters.search}%`);
      idx++;
    }
    if (filters.warehouseId) {
      conditions.push(`s.warehouse_id = $${idx++}`);
      values.push(filters.warehouseId);
    }
    if (filters.branchId) {
      conditions.push(`s.branch_id = $${idx++}`);
      values.push(filters.branchId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      ${whereClause}
    `;
    const countResult = await this.db.query<{ total: number }>(countSql, values);
    const total = countResult.rows[0]?.total ?? 0;

    const dataSql = `
      SELECT s.id, s.product_id, s.owner_type, s.warehouse_id, s.branch_id, s.warehouse_location_id,
             s.quantity_on_hand, s.quantity_reserved, s.updated_at,
             p.name, p.sku, p.barcode,
             w.name AS warehouse, b.name AS branch,
             l.aisle, l.rack, l.shelf, l.bin
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
      ${whereClause}
      ORDER BY p.name
      LIMIT $${idx++} OFFSET $${idx}
    `;
    const dataValues = [...values, pageSize, offset];
    const dataResult = await this.db.query(dataSql, dataValues);

    const totalPages = Math.ceil(total / pageSize);

    return {
      data: dataResult.rows,
      total,
      page,
      pageSize,
      totalPages,
    };
  }


  transactions() {
    return this.db.query(
      `SELECT t.*, p.name, p.sku, p.barcode
       FROM inventory_transactions t
       JOIN products p ON p.id = t.product_id
       ORDER BY t.created_at DESC
       LIMIT 200`
    );
  }

  adjust(dto: CreateAdjustmentDto, userId: string) {
    const delta = dto.direction === AdjustmentDirection.Increase ? dto.quantity : -dto.quantity;
    const transactionType = delta > 0 ? 'ADJUSTMENT_POSITIVE' : 'ADJUSTMENT_NEGATIVE';
    const ownerType = dto.warehouseId ? 'WAREHOUSE' : 'BRANCH';

    return this.db.transaction(async (client) => {
      const updated = await client.query(
        `UPDATE inventory_stock
         SET quantity_on_hand = quantity_on_hand + $6, updated_at = now()
         WHERE product_id = $1
           AND owner_type = $2
           AND warehouse_id IS NOT DISTINCT FROM $3
           AND branch_id IS NOT DISTINCT FROM $4
           AND warehouse_location_id IS NOT DISTINCT FROM $5`,
        [dto.productId, ownerType, dto.warehouseId ?? null, dto.branchId ?? null, dto.warehouseLocationId ?? null, delta]
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO inventory_stock (product_id, owner_type, warehouse_id, branch_id, warehouse_location_id, quantity_on_hand)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [dto.productId, ownerType, dto.warehouseId ?? null, dto.branchId ?? null, dto.warehouseLocationId ?? null, delta]
        );
      }

      const transaction = await client.query(
        `INSERT INTO inventory_transactions
         (product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_branch_id, destination_location_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [dto.productId, transactionType, delta, ownerType, dto.warehouseId ?? null, dto.branchId ?? null, dto.warehouseLocationId ?? null, dto.notes ?? null, userId]
      );
      return transaction.rows[0];
    });
  }

  lowStock() {
    return this.db.query(
      `SELECT p.name AS product_name, p.sku, p.barcode,
              s.owner_type, s.warehouse_id, s.branch_id,
              s.quantity_on_hand, p.reorder_level,
              w.name AS warehouse_name, b.name AS branch_name
       FROM inventory_stock s
       JOIN products p ON p.id = s.product_id
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE s.quantity_on_hand <= p.reorder_level
       ORDER BY (s.quantity_on_hand - p.reorder_level) ASC`
    );
  }
}
