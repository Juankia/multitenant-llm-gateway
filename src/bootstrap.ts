import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

/** Shared by main.ts and the e2e suite so tests exercise the exact production pipeline. */
export function configureApp(app: INestApplication): INestApplication {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableShutdownHooks();
  return app;
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Multi-tenant LLM Gateway')
    .setDescription(
      'B2B chatbot backend: per-tenant provider routing with fallback + circuit breaker, FinOps budgets, ' +
        'semantic cache, idempotency and Postgres Row-Level Security.',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Tenant API key (tgw_...)' }, 'tenant-key')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-admin-key', description: 'Operator key' }, 'admin-key')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), { jsonDocumentUrl: 'docs/openapi.json' });
}
