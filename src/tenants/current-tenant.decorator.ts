import { createParamDecorator, type ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { type TenantRequest } from './guards/tenant-api-key.guard';
import { type Tenant } from './tenant.model';

export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext): Tenant => {
  const tenant = context.switchToHttp().getRequest<TenantRequest>().tenant;
  if (!tenant) throw new InternalServerErrorException('CurrentTenant used without TenantApiKeyGuard');
  return tenant;
});
