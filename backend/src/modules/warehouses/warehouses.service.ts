import { Injectable } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { WarehousesRepository } from './warehouses.repository';

@Injectable()
export class WarehousesService {
  constructor(private readonly warehouses: WarehousesRepository) {}

  async list() {
    return (await this.warehouses.list()).rows;
  }

  async locations(warehouseId: string) {
    return (await this.warehouses.locations(warehouseId)).rows;
  }

  async createLocation(dto: CreateLocationDto) {
    return (await this.warehouses.createLocation(dto)).rows[0];
  }
}

