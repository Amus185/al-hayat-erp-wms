import { Injectable } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { WarehousesRepository } from './warehouses.repository';

@Injectable()
export class WarehousesService {
  constructor(private readonly warehouses: WarehousesRepository) {}

  async list() {
    return (await this.warehouses.list()).rows;
  }

  async create(dto: any) {
    return (await this.warehouses.create(dto)).rows[0];
  }

  async update(id: string, dto: any) {
    return (await this.warehouses.update(id, dto)).rows[0];
  }

  async delete(id: string) {
    await this.warehouses.delete(id);
    return { success: true };
  }

  async locations(warehouseId: string) {
    return (await this.warehouses.locations(warehouseId)).rows;
  }

  async createLocation(dto: CreateLocationDto) {
    return (await this.warehouses.createLocation(dto)).rows[0];
  }
}

