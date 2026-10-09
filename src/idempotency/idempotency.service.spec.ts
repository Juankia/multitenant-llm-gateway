import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { InMemoryIdempotencyRepository } from './idempotency.repository';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  let repo: InMemoryIdempotencyRepository;
  let service: IdempotencyService;

  beforeEach(() => {
    repo = new InMemoryIdempotencyRepository();
    service = new IdempotencyService(repo);
  });

  it('executes once and replays the stored response for the same key + payload', async () => {
    const work = jest.fn().mockResolvedValue({ answer: 42 });
    const first = await service.execute('t1', 'key-1', { q: 'a' }, work);
    const second = await service.execute('t1', 'key-1', { q: 'a' }, work);
    expect(first).toEqual({ body: { answer: 42 }, replayed: false });
    expect(second).toEqual({ body: { answer: 42 }, replayed: true });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('treats payloads with different key order as identical', async () => {
    const work = jest.fn().mockResolvedValue('ok');
    await service.execute('t1', 'key-1', { a: 1, b: 2 }, work);
    await expect(service.execute('t1', 'key-1', { b: 2, a: 1 }, work)).resolves.toMatchObject({ replayed: true });
  });

  it('rejects key reuse with a different payload (422)', async () => {
    await service.execute('t1', 'key-1', { q: 'a' }, async () => 'ok');
    await expect(service.execute('t1', 'key-1', { q: 'b' }, async () => 'ok')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects a concurrent duplicate while the first is in flight (409)', async () => {
    let release!: () => void;
    const slow = service.execute('t1', 'key-1', { q: 'a' }, () => new Promise<string>((r) => (release = () => r('ok'))));
    await Promise.resolve();
    await expect(service.execute('t1', 'key-1', { q: 'a' }, async () => 'dup')).rejects.toBeInstanceOf(ConflictException);
    release();
    await expect(slow).resolves.toMatchObject({ body: 'ok' });
  });

  it('releases the key on failure so the client can retry', async () => {
    await expect(service.execute('t1', 'key-1', {}, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(service.execute('t1', 'key-1', {}, async () => 'ok')).resolves.toEqual({ body: 'ok', replayed: false });
  });

  it('scopes keys per tenant', async () => {
    await service.execute('t1', 'shared-key', { q: 'a' }, async () => 'tenant-1');
    await expect(service.execute('t2', 'shared-key', { q: 'zzz' }, async () => 'tenant-2')).resolves.toEqual({
      body: 'tenant-2',
      replayed: false,
    });
  });

  it('validates the key format', async () => {
    await expect(service.execute('t1', 'bad key with spaces', {}, async () => 'ok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
