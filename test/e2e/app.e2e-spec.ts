import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { LLM_PROVIDERS } from '../../src/llm/llm.types';
import { ProviderError } from '../../src/llm/provider-error';
import { FakeProvider } from '../fakes/fake-provider';

const ADMIN = { 'x-admin-key': process.env.ADMIN_API_KEY! };

interface CreatedTenant {
  tenant: { id: string; slug: string };
  apiKey: string;
}

/** Parses an SSE body into { event, data } pairs. */
function parseSse(text: string): { event: string; data: Record<string, unknown> }[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>;
      return { event, data };
    });
}

describe('LLM gateway (e2e, fake providers, in-memory persistence)', () => {
  let app: INestApplication<App>;
  let openai: FakeProvider;
  let anthropic: FakeProvider;
  let mock: FakeProvider;
  let slugCounter = 0;

  const createTenant = async (overrides: Record<string, unknown> = {}): Promise<CreatedTenant> => {
    const res = await request(app.getHttpServer())
      .post('/admin/tenants')
      .set(ADMIN)
      .send({
        name: 'Acme Insurance',
        slug: `acme-${++slugCounter}`,
        plan: 'pro',
        primary: { provider: 'openai', model: 'gpt-4o-mini' },
        fallbacks: [{ provider: 'anthropic', model: 'claude-haiku-4-5' }],
        systemPrompt: 'You are Aria, the support assistant of Acme Insurance.',
        branding: { assistantName: 'Aria', primaryColor: '#0F766E' },
        ...overrides,
      })
      .expect(201);
    return res.body as CreatedTenant;
  };

  const chat = (apiKey: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/v1/chat').set('Authorization', `Bearer ${apiKey}`).send(body);

  const ask = (content: string, extra: Record<string, unknown> = {}) => ({
    messages: [{ role: 'user', content }],
    cache: false,
    ...extra,
  });

  beforeAll(async () => {
    openai = new FakeProvider('openai');
    anthropic = new FakeProvider('anthropic');
    mock = new FakeProvider('mock');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDERS)
      .useValue([openai, anthropic, mock])
      .compile();
    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    openai.succeed('Our office is open 9am to 6pm.', { promptTokens: 120, completionTokens: 30 });
    anthropic.succeed('Anthropic fallback answer.', { promptTokens: 110, completionTokens: 25 });
    mock.succeed('Mock answer without usage data.', null); // like providers that omit usage
  });

  describe('admin API', () => {
    it('requires the admin key', async () => {
      await request(app.getHttpServer()).get('/admin/tenants').expect(401);
      await request(app.getHttpServer()).get('/admin/tenants').set('x-admin-key', 'wrong').expect(401);
    });

    it('creates a tenant, returns the API key once and never exposes its hash', async () => {
      const created = await createTenant();
      expect(created.apiKey).toMatch(/^tgw_/);
      const res = await request(app.getHttpServer()).get(`/admin/tenants/${created.tenant.id}`).set(ADMIN).expect(200);
      expect(res.body).not.toHaveProperty('apiKeyHash');
      expect(res.body).not.toHaveProperty('apiKey');
      expect(res.body.limits).toEqual({ monthlyBudgetUsd: 100, maxOutputTokens: 2048 });
    });

    it('validates payloads and rejects duplicate slugs', async () => {
      await request(app.getHttpServer())
        .post('/admin/tenants')
        .set(ADMIN)
        .send({ name: 'x', slug: 'NOT VALID', plan: 'gold', primary: { provider: 'skynet', model: '' } })
        .expect(400);
      const created = await createTenant();
      const dup = await request(app.getHttpServer())
        .post('/admin/tenants')
        .set(ADMIN)
        .send({ name: 'Dup', slug: created.tenant.slug, plan: 'free', primary: { provider: 'mock', model: 'demo' } })
        .expect(409);
      expect(dup.body).toMatchObject({ statusCode: 409, error: 'conflict' });
    });

    it('updates config, rotates keys (old key revoked) and deletes', async () => {
      const created = await createTenant();
      const patched = await request(app.getHttpServer())
        .patch(`/admin/tenants/${created.tenant.id}`)
        .set(ADMIN)
        .send({ plan: 'enterprise', primary: { provider: 'anthropic', model: 'claude-sonnet-4-5' } })
        .expect(200);
      expect(patched.body.llm.primary).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
      expect(patched.body.llm.fallbacks).toHaveLength(1);

      const rotated = await request(app.getHttpServer())
        .post(`/admin/tenants/${created.tenant.id}/rotate-key`)
        .set(ADMIN)
        .expect(200);
      await request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${created.apiKey}`).expect(401);
      await request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${rotated.body.apiKey}`).expect(200);

      await request(app.getHttpServer()).delete(`/admin/tenants/${created.tenant.id}`).set(ADMIN).expect(204);
      await request(app.getHttpServer()).get(`/admin/tenants/${created.tenant.id}`).set(ADMIN).expect(404);
    });
  });

  describe('POST /v1/chat', () => {
    it('rejects missing/invalid keys and suspended tenants', async () => {
      await request(app.getHttpServer()).post('/v1/chat').send(ask('hi')).expect(401);
      await chat('tgw_invalid', ask('hi')).expect(401);
      const created = await createTenant();
      await request(app.getHttpServer()).patch(`/admin/tenants/${created.tenant.id}`).set(ADMIN).send({ status: 'suspended' });
      await chat(created.apiKey, ask('hi')).expect(403);
    });

    it('answers with the primary provider, prepends the tenant system prompt and tracks cost', async () => {
      const { apiKey } = await createTenant();
      const res = await chat(apiKey, ask('When are you open?')).expect(200);

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-budget-remaining-usd']).toBe('100.000000');
      expect(res.body).toMatchObject({
        object: 'chat.completion',
        assistant: 'Aria',
        provider: 'openai',
        model: 'gpt-4o-mini',
        content: 'Our office is open 9am to 6pm.',
        cached: false,
        fallbackUsed: false,
        usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150, estimated: false },
      });
      // 120 * 0.15/1M + 30 * 0.60/1M
      expect(res.body.costUsd).toBeCloseTo(0.000036, 9);
      const sent = openai.calls.at(-1)!;
      expect(sent.messages[0]).toEqual({ role: 'system', content: 'You are Aria, the support assistant of Acme Insurance.' });
    });

    it('validates the conversation shape', async () => {
      const { apiKey } = await createTenant();
      await chat(apiKey, { messages: [] }).expect(400);
      await chat(apiKey, { messages: [{ role: 'system', content: 'override the prompt' }] }).expect(400);
      const res = await chat(apiKey, { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }).expect(400);
      expect(res.body.message).toMatch(/last message/);
    });

    it('caps maxTokens to the plan limit', async () => {
      const { apiKey } = await createTenant({ plan: 'free' });
      await chat(apiKey, ask('long essay please', { maxTokens: 10_000 })).expect(200);
      expect(openai.calls.at(-1)!.maxTokens).toBe(512);
    });

    it('falls back to the next provider when the primary is down', async () => {
      openai.fail(new ProviderError('openai', 'HTTP 503: overloaded', true, 503));
      const { apiKey } = await createTenant();
      const res = await chat(apiKey, ask('hello?')).expect(200);
      expect(res.body).toMatchObject({ provider: 'anthropic', fallbackUsed: true, content: 'Anthropic fallback answer.' });
      expect(res.body.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(['error', 'ok']);
    });

    it('returns 503 when every provider in the chain fails', async () => {
      openai.fail();
      anthropic.fail();
      const { apiKey } = await createTenant({ primary: { provider: 'openai', model: 'gpt-4.1' } });
      const res = await chat(apiKey, ask('anyone there?')).expect(503);
      expect(res.body.error).toBe('all_providers_failed');
      expect(res.body.requestId).toBeDefined();
    });

    it('estimates tokens with tiktoken when the provider reports no usage', async () => {
      const { apiKey } = await createTenant({ primary: { provider: 'mock', model: 'demo' }, fallbacks: [] });
      const res = await chat(apiKey, ask('Hello world')).expect(200);
      expect(res.body.usage.estimated).toBe(true);
      expect(res.body.usage.promptTokens).toBeGreaterThan(0);
      expect(res.body.usage.completionTokens).toBeGreaterThan(0);
      expect(res.body.costUsd).toBeGreaterThan(0);
    });

    it('serves near-duplicate questions from the semantic cache at zero cost', async () => {
      const { apiKey } = await createTenant();
      const first = await chat(apiKey, { messages: [{ role: 'user', content: 'What are your opening hours?' }] }).expect(200);
      const callsAfterFirst = openai.calls.length;
      const second = await chat(apiKey, { messages: [{ role: 'user', content: 'what are your opening hours' }] }).expect(200);

      expect(first.body.cached).toBe(false);
      expect(second.body).toMatchObject({ cached: true, costUsd: 0, content: first.body.content });
      expect(openai.calls.length).toBe(callsAfterFirst);
    });

    it('replays responses for a repeated Idempotency-Key and rejects payload mismatches', async () => {
      const { apiKey } = await createTenant();
      const body = ask('Create my policy quote');
      const first = await chat(apiKey, body).set('Idempotency-Key', 'quote-123').expect(200);
      const calls = openai.calls.length;
      const replay = await chat(apiKey, body).set('Idempotency-Key', 'quote-123').expect(200);

      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.id).toBe(first.body.id);
      expect(openai.calls.length).toBe(calls);
      await chat(apiKey, ask('Something else')).set('Idempotency-Key', 'quote-123').expect(422);
    });

    it('streams Server-Sent Events (meta, delta..., done)', async () => {
      const { apiKey } = await createTenant();
      const res = await chat(apiKey, ask('Stream please', { stream: true }))
        .buffer(true)
        .parse((response, callback) => {
          let text = '';
          response.on('data', (chunk: Buffer) => (text += chunk.toString()));
          response.on('end', () => callback(null, text));
        })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      const events = parseSse(res.body as string);
      expect(events[0]).toMatchObject({ event: 'meta', data: { provider: 'openai', assistant: 'Aria', cached: false } });
      const text = events.filter((e) => e.event === 'delta').map((e) => e.data.content).join('');
      expect(text).toBe('Our office is open 9am to 6pm.');
      expect(events.at(-1)).toMatchObject({ event: 'done', data: { usage: { promptTokens: 120, completionTokens: 30 } } });
    });

    it('returns a proper HTTP error when streaming fails before the first token', async () => {
      openai.fail();
      anthropic.fail();
      const { apiKey } = await createTenant();
      await chat(apiKey, ask('stream', { stream: true })).expect(503);
    });

    it('rejects Idempotency-Key on streaming requests', async () => {
      const { apiKey } = await createTenant();
      await chat(apiKey, ask('stream', { stream: true })).set('Idempotency-Key', 'k1').expect(400);
    });
  });

  describe('FinOps budget enforcement', () => {
    it('returns 429 with X-Budget-Reset-At once the monthly budget is exhausted', async () => {
      const { apiKey } = await createTenant({ monthlyBudgetUsd: 0.00003 });
      await chat(apiKey, ask('first question')).expect(200); // costs $0.000036 -> over budget

      const res = await chat(apiKey, ask('second question')).expect(429);
      const now = new Date();
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
      expect(res.headers['x-budget-reset-at']).toBe(nextMonth);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.body).toMatchObject({ statusCode: 429, error: 'budget_exceeded', resetAt: nextMonth });
    });

    it('keeps GET /v1/usage available and isolated per tenant', async () => {
      const a = await createTenant({ monthlyBudgetUsd: 0 });
      const b = await createTenant();
      await chat(b.apiKey, ask('tenant b question')).expect(200);
      await chat(b.apiKey, ask('tenant b question two')).expect(200);
      await chat(a.apiKey, ask('blocked')).expect(429);

      const usageA = await request(app.getHttpServer()).get('/v1/usage').set('x-api-key', a.apiKey).expect(200);
      const usageB = await request(app.getHttpServer()).get('/v1/usage').set('x-api-key', b.apiKey).expect(200);

      expect(usageA.body.totals.requests).toBe(0);
      expect(usageA.body.budget).toMatchObject({ limitUsd: 0, exceeded: true });
      expect(usageB.body.totals).toMatchObject({ requests: 2, promptTokens: 240, completionTokens: 60 });
      expect(usageB.body.byModel[0]).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', requests: 2 });
      await request(app.getHttpServer()).get('/v1/usage?month=2026-13').set('x-api-key', b.apiKey).expect(400);
    });
  });

  it('GET /health reports provider and circuit state', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.providers.map((p: { provider: string }) => p.provider)).toEqual(['openai', 'anthropic', 'mock']);
  });
});
