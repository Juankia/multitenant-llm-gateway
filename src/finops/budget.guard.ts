import { type CanActivate, type ExecutionContext, Injectable, InternalServerErrorException } from '@nestjs/common';
import { type Response } from 'express';
import { BudgetExceededException } from '../common/errors';
import { type TenantRequest } from '../tenants/guards/tenant-api-key.guard';
import { UsageService } from './usage.service';

/**
 * Hard monthly budget. Runs after TenantApiKeyGuard. When the tenant's month-to-date spend
 * reaches its limit the request is rejected with:
 *   HTTP 429  +  X-Budget-Reset-At: <ISO first instant of next UTC month>  +  Retry-After
 * so clients (and the embeddable widget) can show a precise "available again on ..." message.
 * Successful checks expose the remaining budget in X-Budget-Remaining-Usd.
 */
@Injectable()
export class BudgetGuard implements CanActivate {
  constructor(private readonly usage: UsageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const tenant = request.tenant;
    if (!tenant) throw new InternalServerErrorException('BudgetGuard requires TenantApiKeyGuard to run first');

    const now = new Date();
    const status = await this.usage.budgetStatus(tenant, now);
    if (status.exceeded) {
      throw new BudgetExceededException(status.resetAt, status.spentUsd, status.limitUsd, now);
    }
    response.setHeader('X-Budget-Remaining-Usd', status.remainingUsd.toFixed(6));
    return true;
  }
}
