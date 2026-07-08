import { Injectable } from '@nestjs/common';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateAdjustmentDto, AdjustmentDirection } from './dto/create-adjustment.dto';
import { InventoryRepository } from './inventory.repository';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async stock() {
    return (await this.inventory.stock()).rows;
  }

  async stockPaginated(filters: {
    search?: string;
    warehouseId?: string;
    branchId?: string;
    page?: number;
    pageSize?: number;
  }) {
    return this.inventory.stockPaginated(filters);
  }

  async transactions() {
    return (await this.inventory.transactions()).rows;
  }

  async adjust(dto: CreateAdjustmentDto, userId: string) {
    const result = await this.inventory.adjust(dto, userId);
    await this.audit.logAction(
      userId,
      'INVENTORY_ADJUSTMENT',
      'inventory_stock',
      result.id,
      undefined,
      result,
    );

    const delta =
      dto.direction === AdjustmentDirection.Increase ? dto.quantity : -dto.quantity;

    // Emit typed stock updated event
    this.realtime.emitStockUpdated({
      productId: dto.productId,
      sku: result.sku ?? dto.productId,
      productName: result.product_name ?? 'Unknown',
      ownerType: dto.warehouseId ? 'WAREHOUSE' : 'BRANCH',
      warehouseId: dto.warehouseId,
      branchId: dto.branchId,
      quantityOnHand: result.quantity_on_hand ?? 0,
      quantityReserved: result.quantity_reserved ?? 0,
      delta,
      transactionType: delta > 0 ? 'ADJUSTMENT_POSITIVE' : 'ADJUSTMENT_NEGATIVE',
    });

    return result;
  }

  async lowStock() {
    return this.inventory.lowStock();
  }
}
