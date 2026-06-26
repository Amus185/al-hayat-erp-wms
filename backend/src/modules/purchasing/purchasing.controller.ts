import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { CreatePurchaseOrderDto, CreateSupplierDto } from './dto/create-purchase-order.dto';
import { PurchasingService } from './purchasing.service';

@ApiTags('Purchasing')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get('suppliers')
  @Permissions('purchasing.write')
  suppliers() {
    return this.purchasing.suppliers();
  }

  @Post('suppliers')
  @Permissions('purchasing.write')
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.purchasing.createSupplier(dto);
  }

  @Get('purchase-orders')
  @Permissions('purchasing.write')
  purchaseOrders() {
    return this.purchasing.purchaseOrders();
  }

  @Post('purchase-orders')
  @Permissions('purchasing.write')
  createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto, @Req() request: { user: { sub: string } }) {
    return this.purchasing.createPurchaseOrder(dto, request.user.sub);
  }

  @Patch('purchase-orders/:id/approve')
  @Permissions('purchasing.approve')
  approvePurchaseOrder(@Param('id') id: string, @Req() request: { user: { sub: string } }) {
    return this.purchasing.approvePurchaseOrder(id, request.user.sub);
  }

  @Post('goods-receipts')
  @Permissions('purchasing.write')
  createGoodsReceipt(@Body() dto: CreateGoodsReceiptDto, @Req() request: { user: { sub: string } }) {
    return this.purchasing.createGoodsReceipt(dto, request.user.sub);
  }

  @Post('supplier-payments')
  @Permissions('purchasing.write')
  createSupplierPayment(
    @Body() dto: { supplierId: string; purchaseOrderId?: string; amount: number; reference?: string },
    @Req() request: { user: { sub: string } },
  ) {
    return this.purchasing.createSupplierPayment(dto, request.user.sub);
  }
}

