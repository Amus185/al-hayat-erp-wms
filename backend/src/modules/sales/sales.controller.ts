import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateCustomerDto, CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SalesService } from './sales.service';

@ApiTags('Sales')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('customers')
  @Permissions('sales.write')
  customers() {
    return this.sales.customers();
  }

  @Post('customers')
  @Permissions('sales.write')
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.sales.createCustomer(dto);
  }

  @Get('sales-orders')
  @Permissions('sales.write')
  orders() {
    return this.sales.orders();
  }

  @Post('sales-orders')
  @Permissions('sales.write')
  createOrder(@Body() dto: CreateSalesOrderDto, @Req() request: { user: { sub: string } }) {
    return this.sales.createOrder(dto, request.user.sub);
  }

  @Patch('sales-orders/:id/confirm')
  @Permissions('sales.write')
  confirmOrder(@Param('id') id: string) {
    return this.sales.confirmOrder(id);
  }

  @Post('sales-orders/:id/invoice')
  @Permissions('sales.write')
  createInvoice(@Param('id') id: string, @Req() request: { user: { sub: string } }) {
    return this.sales.createInvoice(id, request.user.sub);
  }

  @Patch('invoices/:id/pay')
  @Permissions('sales.write')
  payInvoice(@Param('id') id: string) {
    return this.sales.payInvoice(id);
  }

  @Get('quotations')
  @Permissions('sales.write')
  quotations() {
    return this.sales.quotations();
  }

  @Post('quotations')
  @Permissions('sales.write')
  createQuotation(
    @Body() dto: { customerId?: string; branchId?: string; validUntil?: string },
    @Req() request: { user: { sub: string } },
  ) {
    return this.sales.createQuotation(dto, request.user.sub);
  }
}
