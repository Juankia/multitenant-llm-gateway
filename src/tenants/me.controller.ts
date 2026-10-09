import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from './current-tenant.decorator';
import { TenantApiKeyGuard } from './guards/tenant-api-key.guard';
import { effectiveLimits, type PlanLimits, type Tenant, type TenantBranding } from './tenant.model';

@ApiTags('tenant')
@ApiBearerAuth('tenant-key')
@Controller('v1/me')
@UseGuards(TenantApiKeyGuard)
export class MeController {
  @Get()
  @ApiOperation({ summary: 'Public config of the calling tenant (branding for chat widgets, limits)' })
  me(@CurrentTenant() tenant: Tenant): { id: string; name: string; plan: string; branding: TenantBranding; limits: PlanLimits } {
    return { id: tenant.id, name: tenant.name, plan: tenant.plan, branding: tenant.branding, limits: effectiveLimits(tenant) };
  }
}
