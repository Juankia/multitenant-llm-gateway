import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BudgetGuard } from './budget.guard';
import { PriceTable } from './price-table';
import { TokenEstimator } from './token-estimator';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [TenantsModule],
  controllers: [UsageController],
  providers: [
    UsageService,
    BudgetGuard,
    { provide: PriceTable, useValue: new PriceTable() },
    { provide: TokenEstimator, useValue: new TokenEstimator() },
  ],
  exports: [UsageService, BudgetGuard, PriceTable, TokenEstimator],
})
export class FinOpsModule {}
