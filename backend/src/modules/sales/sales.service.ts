import { Injectable } from '@nestjs/common';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateCustomerDto, CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SalesRepository } from './sales.repository';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SalesService {
  constructor(
    private readonly sales: SalesRepository,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async customers() {
    return (await this.sales.customers()).rows;
  }

  async createCustomer(dto: CreateCustomerDto) {
    return (await this.sales.createCustomer(dto)).rows[0];
  }

  async orders() {
    return (await this.sales.orders()).rows;
  }

  async createOrder(dto: CreateSalesOrderDto, userId: string) {
    const order = await this.sales.createOrder(dto, userId);
    await this.audit.logAction(userId, 'CREATE_SALES_ORDER', 'sales_orders', order.id, undefined, order);
    return order;
  }

  async confirmOrder(id: string) {
    return (await this.sales.confirmOrder(id)).rows[0];
  }

  async createInvoice(orderId: string, userId: string) {
    try {
      const invoice = await this.sales.createInvoice(orderId, userId);
      this.realtime.emit('sales.invoice_created', invoice);
      this.realtime.emit('inventory.stock.updated', { source: 'invoice', invoiceId: invoice.id });
      return invoice;
    } catch (error) {
      console.error('createInvoice FAILED:', error);
      throw error;
    }
  }

  async payInvoice(id: string) {
    return (await this.sales.payInvoice(id)).rows[0];
  }

  async quotations() {
    return (await this.sales.quotations()).rows;
  }

  async createQuotation(dto: { customerId?: string; branchId?: string; validUntil?: string }, userId: string) {
    return (await this.sales.createQuotation(dto, userId)).rows[0];
  }
}

