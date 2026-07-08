import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesRepository {
  constructor(private readonly db: DatabaseService) {}

  list() {
    return this.db.query('SELECT id, code, name, city, address, phone, is_active FROM branches ORDER BY code');
  }

  create(dto: any) {
    return this.db.query(
      `INSERT INTO branches (code, name, city, address, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [dto.code, dto.name, dto.city, dto.address ?? null, dto.phone ?? null]
    );
  }

  delete(id: string) {
    return this.db.query(`DELETE FROM branches WHERE id = $1`, [id]);
  }

  findById(id: string) {
    return this.db.query(
      'SELECT id, code, name, city, address, phone, is_active FROM branches WHERE id = $1',
      [id]
    );
  }

  async update(id: string, dto: UpdateBranchDto) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) { fields.push(`name = $${idx++}`); values.push(dto.name); }
    if (dto.city !== undefined) { fields.push(`city = $${idx++}`); values.push(dto.city); }
    if (dto.address !== undefined) { fields.push(`address = $${idx++}`); values.push(dto.address); }
    if (dto.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(dto.phone); }
    if (dto.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(dto.isActive); }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    return this.db.query(
      `UPDATE branches SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
  }

  inventory(branchId: string) {
    return this.db.query(
      `SELECT p.name, p.sku, p.barcode, s.quantity_on_hand, s.quantity_reserved,
              (s.quantity_on_hand - s.quantity_reserved) AS available_quantity
       FROM inventory_stock s
       JOIN products p ON p.id = s.product_id
       WHERE s.branch_id = $1
       ORDER BY p.name`,
      [branchId]
    );
  }

  performance(branchId: string) {
    return this.db.query(
      `SELECT b.id, b.code, b.name,
              COUNT(DISTINCT so.id) AS order_count,
              COALESCE(SUM(i.total_amount), 0) AS invoiced_amount,
              COALESCE(SUM(sol.quantity), 0) AS units_sold
       FROM branches b
       LEFT JOIN sales_orders so ON so.branch_id = b.id
       LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
       LEFT JOIN invoices i ON i.sales_order_id = so.id
       WHERE b.id = $1
       GROUP BY b.id`,
      [branchId]
    );
  }
}


