import { Injectable } from '@nestjs/common';
import { ReportsRepository } from './reports.repository';

@Injectable()
export class ReportsService {
  constructor(private readonly reports: ReportsRepository) {}

  async inventoryValue() {
    const [overview, byWarehouse, byCategory] = await Promise.all([
      this.reports.inventoryValueOverview(),
      this.reports.inventoryValueByWarehouse(),
      this.reports.inventoryValueByCategory(),
    ]);

    return {
      total_value: overview.rows[0]?.total_value ?? 0,
      total_skus: overview.rows[0]?.total_skus ?? 0,
      by_warehouse: byWarehouse.rows,
      by_category: byCategory.rows,
    };
  }

  async lowStock() {
    return (await this.reports.lowStock()).rows;
  }

  async sales() {
    const [overview, byBranch, byPeriod] = await Promise.all([
      this.reports.salesOverview(),
      this.reports.salesByBranch(),
      this.reports.salesByPeriod(),
    ]);

    return {
      total_revenue: overview.rows[0]?.total_revenue ?? 0,
      total_orders: overview.rows[0]?.total_orders ?? 0,
      avg_order_value: overview.rows[0]?.avg_order_value ?? 0,
      by_branch: byBranch.rows,
      by_period: byPeriod.rows,
    };
  }

  async branches() {
    return (await this.reports.branches()).rows;
  }

  async profit() {
    const [overview, byCategory] = await Promise.all([
      this.reports.profitOverview(),
      this.reports.profitByCategory(),
    ]);

    const totalRevenue = overview.rows[0]?.total_revenue ?? 0;
    const totalCost = overview.rows[0]?.total_cost ?? 0;
    const grossProfit = totalRevenue - totalCost;
    const marginPercentage = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return {
      total_revenue: totalRevenue,
      total_cost: totalCost,
      gross_profit: grossProfit,
      margin_percentage: marginPercentage,
      by_category: byCategory.rows,
    };
  }
}


