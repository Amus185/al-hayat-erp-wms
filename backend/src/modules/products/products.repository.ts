import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsRepository {
  constructor(private readonly db: DatabaseService) {}

  search(q?: string) {
    const search = `%${q ?? ''}%`;
    return this.db.query(
      `SELECT p.id, p.sku, p.barcode, p.name, p.cost_price, p.selling_price, p.reorder_level, p.is_active,
              c.name AS category, b.name AS brand
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.barcode ILIKE $1) AND p.is_active = true
       ORDER BY p.updated_at DESC
       LIMIT 100`,
      [search],
    );
  }

  findById(id: string) {
    return this.db.query(
      `SELECT p.id, p.sku, p.barcode, p.name, p.description, p.cost_price, p.selling_price,
              p.reorder_level, p.is_active, p.created_at, p.updated_at,
              p.category_id, p.brand_id,
              c.name AS category, b.name AS brand
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.id = $1`,
      [id],
    );
  }



  findImagesByProductId(productId: string) {
    return this.db.query(
      `SELECT pi.id, pi.product_id, pi.file_id, pi.sort_order, f.object_key as url
       FROM product_images pi
       LEFT JOIN files f ON f.id = pi.file_id
       WHERE pi.product_id = $1
       ORDER BY pi.sort_order`,
      [productId],
    );
  }

  stockSummaryByProductId(productId: string) {
    return this.db.query(
      `SELECT COALESCE(SUM(s.quantity_on_hand), 0)::int AS total_on_hand,
              COALESCE(SUM(s.quantity_reserved), 0)::int AS total_reserved,
              COALESCE(SUM(s.quantity_on_hand - s.quantity_reserved), 0)::int AS total_available,
              COUNT(DISTINCT s.warehouse_id) FILTER (WHERE s.warehouse_id IS NOT NULL)::int AS warehouse_count,
              COUNT(DISTINCT s.branch_id) FILTER (WHERE s.branch_id IS NOT NULL)::int AS branch_count
       FROM inventory_stock s
       WHERE s.product_id = $1`,
      [productId],
    );
  }

  barcodeLookup(barcode: string) {
    return this.db.query(
      `SELECT p.id, p.name, p.sku, p.barcode, p.cost_price, p.selling_price,
              COALESCE(SUM(s.quantity_on_hand - s.quantity_reserved), 0) AS available_quantity
       FROM products p
       LEFT JOIN inventory_stock s ON s.product_id = p.id
       WHERE p.barcode = $1
       GROUP BY p.id`,
      [barcode],
    );
  }

  async create(dto: CreateProductDto) {
    return this.db.transaction(async (client) => {
      const product = await client.query(
        `INSERT INTO products (sku, barcode, name, description, category_id, brand_id, cost_price, selling_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [dto.sku, dto.barcode, dto.name, dto.description ?? null, dto.categoryId ?? null, dto.brandId ?? null, dto.costPrice, dto.sellingPrice],
      );
      return product.rows[0];
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) { fields.push(`name = $${idx++}`); values.push(dto.name); }
    if (dto.description !== undefined) { fields.push(`description = $${idx++}`); values.push(dto.description); }
    if (dto.categoryId !== undefined) { fields.push(`category_id = $${idx++}`); values.push(dto.categoryId); }
    if (dto.brandId !== undefined) { fields.push(`brand_id = $${idx++}`); values.push(dto.brandId); }
    if (dto.costPrice !== undefined) { fields.push(`cost_price = $${idx++}`); values.push(dto.costPrice); }
    if (dto.sellingPrice !== undefined) { fields.push(`selling_price = $${idx++}`); values.push(dto.sellingPrice); }
    if (dto.reorderLevel !== undefined) { fields.push(`reorder_level = $${idx++}`); values.push(dto.reorderLevel); }
    if (dto.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(dto.isActive); }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    return this.db.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
  }

  softDelete(id: string) {
    return this.db.query(
      'UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id],
    );
  }

  listCategories() {
    return this.db.query(
      `SELECT id, name, parent_id FROM categories ORDER BY name`,
    );
  }

  createCategory(dto: any) {
    return this.db.query(
      `INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id, name, parent_id`,
      [dto.name, dto.parentId ?? null]
    );
  }

  updateCategory(id: string, dto: any) {
    return this.db.query(
      `UPDATE categories SET name = COALESCE($2, name), parent_id = COALESCE($3, parent_id) WHERE id = $1 RETURNING id, name, parent_id`,
      [id, dto.name, dto.parentId]
    );
  }

  deleteCategory(id: string) {
    return this.db.query(`DELETE FROM categories WHERE id = $1`, [id]);
  }

  listBrands() {
    return this.db.query(
      `SELECT id, name FROM brands ORDER BY name`,
    );
  }
}
