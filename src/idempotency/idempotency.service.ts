import { BadRequestException, ConflictException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sha256, stableStringify } from '../common/crypto';
import { IDEMPOTENCY_REPOSITORY, type IdempotencyRepository } from './idempotency.repository';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/;

export interface IdempotentOutcome<T> {
  body: T;
  replayed: boolean;
}

/**
 * Idempotency-Key semantics (in the spirit of the IETF draft / Stripe):
 * - first request with a key executes and its response is stored for 24h;
 * - a retry with the same key + same payload replays the stored response (no second LLM bill);
 * - same key + different payload -> 422; same key while the first is still running -> 409;
 * - if execution fails, the key is released so the client may retry.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(IDEMPOTENCY_REPOSITORY) private readonly repo: IdempotencyRepository) {}

  async execute<T>(
    tenantId: string,
    key: string | undefined,
    payload: unknown,
    work: () => Promise<T>,
  ): Promise<IdempotentOutcome<T>> {
    if (key === undefined) return { body: await work(), replayed: false };
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException('Idempotency-Key must be 1-255 characters of [A-Za-z0-9_.:-]');
    }

    const requestHash = sha256(stableStringify(payload));
    const claim = await this.repo.begin(tenantId, key, requestHash, IDEMPOTENCY_TTL_MS);
    if (!claim.acquired) {
      const { existing } = claim;
      if (existing.requestHash !== requestHash) {
        throw new UnprocessableEntityException('Idempotency-Key was already used with a different request payload');
      }
      if (existing.status === 'in_progress') {
        throw new ConflictException('A request with this Idempotency-Key is still being processed');
      }
      return { body: existing.responseBody as T, replayed: true };
    }

    try {
      const body = await work();
      await this.repo.complete(tenantId, key, 200, body);
      return { body, replayed: false };
    } catch (error) {
      await this.repo.release(tenantId, key);
      throw error;
    }
  }
}
