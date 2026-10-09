import { type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

export type { Logger };

/** Root structured logger. Request-scoped children are created by the request-context middleware. */
export const rootLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'llm-gateway' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers["x-admin-key"]', '*.apiKey'],
    censor: '[redacted]',
  },
});

/** Routes Nest's framework logs (bootstrap, route mapping) through pino so all output is JSON. */
export class PinoNestLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    rootLogger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    rootLogger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string): void {
    rootLogger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    rootLogger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    rootLogger.trace({ context }, String(message));
  }
}
