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
      `SELECT p.id, p.sku, p.name, p.cost_price, p.selling_price, p.reorder_level, p.is_active,
              c.name AS category, b.name AS brand
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE (p.name ILIKE $1 OR p.sku ILIKE $1) AND p.is_active = true
       ORDER BY p.updated_at DESC
       LIMIT 100`,
      [search],
    );
  }

  findById(id: string) {
    return this.db.query(
      `SELECT p.id, p.sku, p.name, p.description, p.cost_price, p.selling_price,
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

  findVariantsByProductId(productId: string) {
    return this.db.query(
      `SELECT v.id, v.product_id, v.sku, v.barcode, v.color, v.material, v.dimensions, v.is_active,
              COALESCE(SUM(s.quantity_on_hand - s.quantity_reserved), 0)::int AS available_quantity
       FROM product_variants v
       LEFT JOIN inventory_stock s ON s.variant_id = v.id
       WHERE v.product_id = $1
       GROUP BY v.id
       ORDER BY v.sku`,
      [productId],
    );
  }

  findImagesByProductId(productId: string) {
    return this.db.query(
      `SELECT pi.id, pi.product_id, pi.file_id, pi.sort_order, f.url
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
       JOIN product_variants v ON v.id = s.variant_id
       WHERE v.product_id = $1`,
      [productId],
    );
  }

  barcodeLookup(barcode: string) {
    return this.db.query(
      `SELECT p.id AS product_id, p.name, p.sku AS product_sku, v.id AS variant_id, v.sku AS variant_sku, v.barcode,
              COALESCE(SUM(s.quantity_on_hand - s.quantity_reserved), 0) AS available_quantity
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN inventory_stock s ON s.variant_id = v.id
       WHERE v.barcode = $1
       GROUP BY p.id, v.id`,
      [barcode],
    );
  }

  async create(dto: CreateProductDto) {
    return this.db.transaction(async (client) => {
      const product = await client.query(
        `INSERT INTO products (sku, name, description, category_id, brand_id, cost_price, selling_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [dto.sku, dto.name, dto.description ?? null, dto.categoryId ?? null, dto.brandId ?? null, dto.costPrice, dto.sellingPrice],
      );
      for (const variant of dto.variants) {
        await client.query(
          `INSERT INTO product_variants (product_id, sku, barcode, color, material, dimensions)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [product.rows[0].id, variant.sku, variant.barcode, variant.color ?? null, variant.material ?? null, variant.dimensions ?? null],
        );
      }
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
