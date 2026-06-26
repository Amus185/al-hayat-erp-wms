import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { BranchesModule } from './modules/branches/branches.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { SalesModule } from './modules/sales/sales.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { FilesModule } from './modules/files/files.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    InventoryModule,
    TransfersModule,
    WarehousesModule,
    BranchesModule,
    PurchasingModule,
    SalesModule,
    ReportsModule,
    NotificationsModule,
    AuditModule,
    FilesModule
  ]
})
export class AppModule {}
