import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateLocationDto } from './dto/create-location.dto';

@Injectable()
export class WarehousesRepository {
  constructor(private readonly db: DatabaseService) {}

  list() {
    return this.db.query('SELECT id, code, name, city, address, is_active FROM warehouses ORDER BY name');
  }

  create(dto: any) {
    return this.db.query(
      'INSERT INTO warehouses (code, name, city, address) VALUES ($1,$2,$3,$4) RETURNING *',
      [dto.code, dto.name, dto.city, dto.address ?? null]
    );
  }

  update(id: string, dto: any) {
    return this.db.query(
      `UPDATE warehouses 
       SET code = COALESCE($2, code), name = COALESCE($3, name), city = COALESCE($4, city), address = COALESCE($5, address), is_active = COALESCE($6, is_active) 
       WHERE id = $1 RETURNING *`,
      [id, dto.code, dto.name, dto.city, dto.address, dto.isActive]
    );
  }

  delete(id: string) {
    return this.db.query('DELETE FROM warehouses WHERE id = $1', [id]);
  }

  locations(warehouseId: string) {
    return this.db.query(
      'SELECT id, aisle, rack, shelf, bin, barcode, is_active FROM warehouse_locations WHERE warehouse_id = $1 ORDER BY aisle, rack, shelf, bin',
      [warehouseId]
    );
  }

  createLocation(dto: CreateLocationDto) {
    return this.db.query(
      `INSERT INTO warehouse_locations (warehouse_id, aisle, rack, shelf, bin, barcode)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [dto.warehouseId, dto.aisle, dto.rack, dto.shelf, dto.bin, dto.barcode]
    );
  }
}

