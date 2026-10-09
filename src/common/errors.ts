import { HttpException, HttpStatus } from '@nestjs/common';

/** HttpException that also carries response headers (applied by the global exception filter). */
export class HeaderedHttpException extends HttpException {
  constructor(
    body: Record<string, unknown>,
    status: number,
    readonly headers: Record<string, string>,
  ) {
    super(body, status);
  }
}

export class BudgetExceededException extends HeaderedHttpException {
  constructor(
    readonly resetAt: Date,
    readonly spentUsd: number,
    readonly limitUsd: number,
    now: Date = new Date(),
  ) {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'budget_exceeded',
        message: 'Monthly LLM budget exhausted for this tenant.',
        spentUsd: spentUsd,
        limitUsd: limitUsd,
        resetAt: resetAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
      {
        'X-Budget-Reset-At': resetAt.toISOString(),
        'Retry-After': String(retryAfterSeconds),
      },
    );
  }
}
