import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(private readonly products: ProductsRepository) {}

  async search(q?: string) {
    return (await this.products.search(q)).rows;
  }

  async findById(id: string) {
    const productResult = await this.products.findById(id);
    if (productResult.rowCount === 0) {
      throw new NotFoundException('Product not found');
    }
    const product = productResult.rows[0];

    const [images, stockSummary] = await Promise.all([
      this.products.findImagesByProductId(id),
      this.products.stockSummaryByProductId(id),
    ]);

    return {
      ...product,
      images: images.rows,
      stock_summary: stockSummary.rows[0] ?? null,
    };
  }

  async barcodeLookup(barcode: string) {
    return (await this.products.barcodeLookup(barcode)).rows[0] ?? null;
  }

  create(dto: CreateProductDto) {
    return this.products.create(dto);
  }

  async update(id: string, dto: UpdateProductDto) {
    const result = await this.products.update(id, dto);
    if (result.rowCount === 0) {
      throw new NotFoundException('Product not found');
    }
    return result.rows[0];
  }

  async softDelete(id: string) {
    const result = await this.products.softDelete(id);
    if (result.rowCount === 0) {
      throw new NotFoundException('Product not found');
    }
    return result.rows[0];
  }

  async listCategories() {
    const result = await this.products.listCategories();
    // Build hierarchy
    const categories = result.rows as Array<{ id: string; name: string; parent_id: string | null; children?: unknown[] }>;
    const map = new Map(categories.map((c) => [c.id, { ...c, children: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const cat of map.values()) {
      if (cat.parent_id && map.has(cat.parent_id)) {
        map.get(cat.parent_id)!.children.push(cat);
      } else {
        roots.push(cat);
      }
    }
    return roots;
  }

  async createCategory(dto: any) {
    return (await this.products.createCategory(dto)).rows[0];
  }

  async updateCategory(id: string, dto: any) {
    return (await this.products.updateCategory(id, dto)).rows[0];
  }

  async deleteCategory(id: string) {
    await this.products.deleteCategory(id);
    return { success: true };
  }

  async listBrands() {
    return (await this.products.listBrands()).rows;
  }
}
