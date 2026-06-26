import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateLocationDto } from './dto/create-location.dto';

@Injectable()
export class WarehousesRepository {
  constructor(private readonly db: DatabaseService) {}

  list() {
    return this.db.query('SELECT id, code, name, city, address, is_active FROM warehouses ORDER BY name');
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

