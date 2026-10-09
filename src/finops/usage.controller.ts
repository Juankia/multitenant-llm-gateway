import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { monthWindow, parseMonth } from '../common/time';
import { CurrentTenant } from '../tenants/current-tenant.decorator';
import { TenantApiKeyGuard } from '../tenants/guards/tenant-api-key.guard';
import { type Tenant } from '../tenants/tenant.model';
import { type UsageReport, UsageService } from './usage.service';

@ApiTags('usage')
@ApiBearerAuth('tenant-key')
@Controller('v1/usage')
@UseGuards(TenantApiKeyGuard) // no BudgetGuard: over-budget tenants must still see their usage
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @ApiOperation({ summary: 'Token and cost usage for the calling tenant, grouped by provider/model' })
  @ApiQuery({ name: 'month', required: false, example: '2026-10', description: 'UTC month (YYYY-MM); defaults to current' })
  @ApiOkResponse({ description: 'Usage report with budget status' })
  report(@CurrentTenant() tenant: Tenant, @Query('month') month?: string): Promise<UsageReport> {
    const window = month ? parseMonth(month) : monthWindow();
    if (!window) throw new BadRequestException('month must have the format YYYY-MM');
    return this.usage.report(tenant, window);
  }
}
