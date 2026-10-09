import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { type Request } from 'express';
import { safeEqual } from '../../common/crypto';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/** Protects the control-plane API with a static operator key compared in constant time. */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const provided = context.switchToHttp().getRequest<Request>().header('x-admin-key');
    if (!provided || !safeEqual(provided, this.config.adminApiKey)) {
      throw new UnauthorizedException('Invalid admin key');
    }
    return true;
  }
}
