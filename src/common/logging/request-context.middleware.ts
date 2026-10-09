import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { RequestContext } from '../request-context';
import { rootLogger } from './logger';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Assigns a request id, opens the AsyncLocalStorage scope and emits one access log line per request. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);

    const store = { requestId, logger: rootLogger.child({ requestId }) };
    const startedAt = process.hrtime.bigint();

    res.on('close', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      store.logger.info(
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
          aborted: !res.writableFinished,
        },
        'request completed',
      );
    });

    RequestContext.run(store, () => next());
  }
}
