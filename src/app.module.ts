import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ChatController } from './chat/chat.controller';
import { ChatModule } from './chat/chat.module';
import { RequestContextMiddleware } from './common/logging/request-context.middleware';
import { ConfigModule } from './config/config.module';
import { PersistenceModule } from './database/persistence.module';
import { FinOpsModule } from './finops/finops.module';
import { UsageController } from './finops/usage.controller';
import { HealthController } from './health/health.controller';
import { HealthModule } from './health/health.module';
import { AdminTenantsController } from './tenants/admin-tenants.controller';
import { MeController } from './tenants/me.controller';
import { TenantsModule } from './tenants/tenants.module';

@Module({
  imports: [ConfigModule, PersistenceModule, TenantsModule, FinOpsModule, ChatModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Nest middleware runs after body parsing, so the AsyncLocalStorage scope covers
    // guards, pipes, handlers and exception filters for the whole request.
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes(ChatController, UsageController, AdminTenantsController, MeController, HealthController);
  }
}
