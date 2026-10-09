import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';
import { RequestContext } from '../../common/request-context';
import { type Tenant } from '../tenant.model';
import { TenantsService } from '../tenants.service';

export type TenantRequest = Request & { tenant?: Tenant };

/** Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`. */
export function extractApiKey(request: Request): string | undefined {
  const auth = request.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || undefined;
  return request.header('x-api-key')?.trim() || undefined;
}

/**
 * Resolves the tenant from its API key (SHA-256 lookup, plaintext never stored), rejects
 * suspended tenants and binds the tenant id to the request-scoped logger.
 */
@Injectable()
export class TenantApiKeyGuard implements CanActivate {
  constructor(private readonly tenants: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const apiKey = extractApiKey(request);
    if (!apiKey) throw new UnauthorizedException('Missing API key (Authorization: Bearer <key> or x-api-key)');

    const tenant = await this.tenants.resolveByApiKey(apiKey);
    if (!tenant) throw new UnauthorizedException('Invalid API key');
    if (tenant.status !== 'active') throw new ForbiddenException('Tenant is suspended');

    request.tenant = tenant;
    RequestContext.bindTenant(tenant.id);
    return true;
  }
}
