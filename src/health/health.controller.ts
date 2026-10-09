import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { LlmRouter } from '../llm/llm-router';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly router: LlmRouter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + provider configuration and circuit-breaker state' })
  health(): { status: 'ok'; persistence: string; providers: ReturnType<LlmRouter['health']> } {
    return { status: 'ok', persistence: this.config.persistence, providers: this.router.health() };
  }
}
