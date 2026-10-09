import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { type Response } from 'express';
import { AllProvidersFailedError, ProviderError } from '../../llm/provider-error';
import { HeaderedHttpException } from '../errors';
import { RequestContext } from '../request-context';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
  [extra: string]: unknown;
}

/**
 * Single place that turns exceptions into a stable JSON error contract:
 * `{ statusCode, error, message, requestId, ...details }`.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const logger = RequestContext.logger();
    const requestId = RequestContext.requestId();

    const { body, headers } = this.toResponse(exception);
    body.requestId = requestId;

    if (body.statusCode >= 500) {
      logger.error({ err: exception, statusCode: body.statusCode }, 'request failed');
    } else {
      logger.warn({ statusCode: body.statusCode, error: body.error }, 'request rejected');
    }

    if (res.headersSent) {
      // A streaming response already started; the stream handler reports errors in-band.
      res.end();
      return;
    }
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.status(body.statusCode).json(body);
  }

  private toResponse(exception: unknown): { body: ErrorBody; headers: Record<string, string> } {
    if (exception instanceof AllProvidersFailedError) {
      return {
        body: {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: 'all_providers_failed',
          message: exception.message,
          attempts: exception.attempts,
        },
        headers: { 'Retry-After': '30' },
      };
    }
    if (exception instanceof ProviderError) {
      return {
        body: {
          statusCode: HttpStatus.BAD_GATEWAY,
          error: 'upstream_rejected',
          message: `Provider "${exception.provider}" rejected the request`,
          upstreamStatus: exception.status,
        },
        headers: {},
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const base: ErrorBody =
        typeof response === 'string'
          ? { statusCode: status, error: snake(exception.name), message: response }
          : {
              statusCode: status,
              error: snake(exception.name),
              message: exception.message,
              ...(response as Record<string, unknown>),
            };
      base.statusCode = status;
      base.error = snake(String(base.error)); // stable machine-readable code, e.g. bad_request
      return { body: base, headers: exception instanceof HeaderedHttpException ? exception.headers : {} };
    }
    return {
      body: { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: 'internal_error', message: 'Internal server error' },
      headers: {},
    };
  }
}

function snake(value: string): string {
  return value
    .replace(/Exception$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}
