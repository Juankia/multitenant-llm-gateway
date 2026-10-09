import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { FinOpsModule } from '../finops/finops.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LlmModule } from '../llm/llm.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [TenantsModule, FinOpsModule, LlmModule, CacheModule, IdempotencyModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
