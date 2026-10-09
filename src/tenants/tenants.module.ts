import { Module } from '@nestjs/common';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminKeyGuard } from './guards/admin-key.guard';
import { TenantApiKeyGuard } from './guards/tenant-api-key.guard';
import { MeController } from './me.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [AdminTenantsController, MeController],
  providers: [TenantsService, TenantApiKeyGuard, AdminKeyGuard],
  exports: [TenantsService, TenantApiKeyGuard],
})
export class TenantsModule {}
