import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

// ── Typed Event Payloads ─────────────────────────────────────────────────────

export interface StockUpdatedPayload {
  variantId: string;
  sku: string;
  productName: string;
  ownerType: 'WAREHOUSE' | 'BRANCH';
  warehouseId?: string;
  branchId?: string;
  quantityOnHand: number;
  quantityReserved: number;
  delta: number; // positive = stock in, negative = stock out
  transactionType: string;
  reference?: string;
}

export interface LowStockPayload {
  variantId: string;
  sku: string;
  productName: string;
  ownerType: 'WAREHOUSE' | 'BRANCH';
  warehouseId?: string;
  branchId?: string;
  quantityOnHand: number;
  reorderLevel: number;
}

export interface TransferPayload {
  transferId: string;
  transferNumber: string;
  status: string;
  sourceWarehouseId?: string;
  sourceBranchId?: string;
  destinationWarehouseId?: string;
  destinationBranchId?: string;
  requestedBy?: string;
}

export interface PurchaseReceivedPayload {
  goodsReceiptId: string;
  receiptNumber: string;
  purchaseOrderId: string;
  warehouseId: string;
  receivedBy: string;
}

export interface NotificationPayload {
  id: string;
  userId: string;
  title: string;
  body: string;
  eventType: string;
  createdAt: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  /**
   * Emitted every time inventory_stock is written.
   * - Managers in ops:managers get all events
   * - Warehouse staff in warehouse:<id> get warehouse-scoped events
   * - Branch staff in branch:<id> get branch-scoped events
   */
  emitStockUpdated(payload: StockUpdatedPayload) {
    this.gateway.server?.to('ops:managers').emit('inventory.stock.updated', payload);

    if (payload.warehouseId) {
      this.gateway.server
        ?.to(`warehouse:${payload.warehouseId}`)
        .emit('inventory.stock.updated', payload);
    }
    if (payload.branchId) {
      this.gateway.server
        ?.to(`branch:${payload.branchId}`)
        .emit('inventory.stock.updated', payload);
    }

    this.logger.debug(`inventory.stock.updated → SKU ${payload.sku} delta=${payload.delta}`);
  }

  /**
   * Emitted when stock drops below reorder_level.
   * Pushed to managers and purchasing staff.
   */
  emitLowStock(payload: LowStockPayload) {
    this.gateway.server?.to('ops:managers').emit('inventory.low_stock', payload);
    this.gateway.server?.to('perm:purchasing.write').emit('inventory.low_stock', payload);
    this.logger.warn(
      `inventory.low_stock → SKU ${payload.sku} qty=${payload.quantityOnHand} reorder=${payload.reorderLevel}`,
    );
  }

  /**
   * Emitted when a new transfer is created.
   * Notifies approvers so they can act immediately.
   */
  emitTransferCreated(payload: TransferPayload) {
    this.gateway.server?.to('perm:transfers.approve').emit('transfer.created', payload);
    this.gateway.server?.to('ops:managers').emit('transfer.created', payload);

    if (payload.sourceWarehouseId) {
      this.gateway.server
        ?.to(`warehouse:${payload.sourceWarehouseId}`)
        .emit('transfer.created', payload);
    }

    this.logger.log(`transfer.created → ${payload.transferNumber}`);
  }

  /**
   * Emitted on every transfer state change (approve, reject, dispatch, receive, cancel).
   * Notifies source warehouse, destination branch/warehouse, and managers.
   */
  emitTransferStatusChanged(payload: TransferPayload) {
    this.gateway.server?.to('ops:managers').emit('transfer.status_changed', payload);

    if (payload.sourceWarehouseId) {
      this.gateway.server
        ?.to(`warehouse:${payload.sourceWarehouseId}`)
        .emit('transfer.status_changed', payload);
    }
    if (payload.sourceBranchId) {
      this.gateway.server
        ?.to(`branch:${payload.sourceBranchId}`)
        .emit('transfer.status_changed', payload);
    }
    if (payload.destinationWarehouseId) {
      this.gateway.server
        ?.to(`warehouse:${payload.destinationWarehouseId}`)
        .emit('transfer.status_changed', payload);
    }
    if (payload.destinationBranchId) {
      this.gateway.server
        ?.to(`branch:${payload.destinationBranchId}`)
        .emit('transfer.status_changed', payload);
    }

    this.logger.log(
      `transfer.status_changed → ${payload.transferNumber} status=${payload.status}`,
    );
  }

  /**
   * Emitted when a goods receipt is posted against a PO.
   * Notifies purchasing team and receiving warehouse.
   */
  emitPurchaseReceived(payload: PurchaseReceivedPayload) {
    this.gateway.server?.to('perm:purchasing.write').emit('purchase.received', payload);
    this.gateway.server?.to('ops:managers').emit('purchase.received', payload);
    this.gateway.server
      ?.to(`warehouse:${payload.warehouseId}`)
      .emit('purchase.received', payload);

    this.logger.log(`purchase.received → ${payload.receiptNumber}`);
  }

  /**
   * Push a notification directly to a specific user.
   */
  emitNotification(payload: NotificationPayload) {
    this.gateway.server?.to(`user:${payload.userId}`).emit('notification.created', payload);
    this.logger.debug(`notification.created → user ${payload.userId}: ${payload.title}`);
  }

  /**
   * Generic broadcast for any event not covered above.
   * Use sparingly — prefer typed emitters.
   */
  emit<TPayload>(event: string, payload: TPayload) {
    this.gateway.server?.emit(event, payload);
  }
}
