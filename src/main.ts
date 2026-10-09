import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { PinoNestLogger, rootLogger } from './common/logging/logger';
import { loadConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger() });
  configureApp(app);
  setupSwagger(app);
  await app.listen(config.port);
  rootLogger.info({ port: config.port, persistence: config.persistence, docs: `/docs` }, 'llm gateway listening');
}

bootstrap().catch((error: unknown) => {
  rootLogger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
