import { Injectable } from '@nestjs/common';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { CreatePurchaseOrderDto, CreateSupplierDto } from './dto/create-purchase-order.dto';
import { PurchasingRepository } from './purchasing.repository';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly purchasing: PurchasingRepository,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async suppliers() {
    return (await this.purchasing.suppliers()).rows;
  }

  async createSupplier(dto: CreateSupplierDto) {
    return (await this.purchasing.createSupplier(dto)).rows[0];
  }

  async purchaseOrders() {
    return (await this.purchasing.purchaseOrders()).rows;
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, userId: string) {
    const po = await this.purchasing.createPurchaseOrder(dto, userId);
    await this.audit.logAction(userId, 'CREATE_PURCHASE_ORDER', 'purchase_orders', po.id, undefined, po);
    return po;
  }

  async approvePurchaseOrder(id: string, userId: string) {
    const po = (await this.purchasing.approvePurchaseOrder(id, userId)).rows[0];
    await this.audit.logAction(userId, 'APPROVE_PURCHASE_ORDER', 'purchase_orders', po.id, undefined, po);
    return po;
  }

  async createGoodsReceipt(dto: CreateGoodsReceiptDto, userId: string) {
    const receipt = await this.purchasing.createGoodsReceipt(dto, userId);
    await this.audit.logAction(userId, 'CREATE_GOODS_RECEIPT', 'goods_receipts', receipt.id, undefined, receipt);

    this.realtime.emitPurchaseReceived({
      goodsReceiptId: receipt.id,
      receiptNumber: receipt.receipt_number as string,
      purchaseOrderId: receipt.purchase_order_id as string,
      warehouseId: receipt.warehouse_id as string,
      receivedBy: userId,
    });

    return receipt;
  }

  async createSupplierPayment(dto: { supplierId: string; purchaseOrderId?: string; amount: number; reference?: string }, userId: string) {
    const payment = (await this.purchasing.createSupplierPayment(dto)).rows[0];
    await this.audit.logAction(userId, 'SUPPLIER_PAYMENT', 'supplier_payments', payment.id, undefined, payment);
    return payment;
  }
}


