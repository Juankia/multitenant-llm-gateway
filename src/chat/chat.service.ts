import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SEMANTIC_CACHE, type SemanticCache, type SemanticCacheKey } from '../cache/semantic-cache';
import { sha256, stableStringify } from '../common/crypto';
import { RequestContext } from '../common/request-context';
import { PriceTable } from '../finops/price-table';
import { TokenEstimator } from '../finops/token-estimator';
import { UsageService } from '../finops/usage.service';
import { LlmRouter } from '../llm/llm-router';
import { type ChatMessage, type ModelRef, type TokenUsage } from '../llm/llm.types';
import { effectiveLimits, fallbackChain, type Tenant } from '../tenants/tenant.model';
import { type ChatResponse, type ChatStreamEvent, type ChatUsage } from './chat.types';
import { type ChatRequestDto } from './dto/chat-request.dto';

interface Prepared {
  id: string;
  messages: ChatMessage[];
  chain: ModelRef[];
  maxTokens: number;
  cacheKey: SemanticCacheKey | null;
}

/**
 * Request lifecycle (after auth + budget guards):
 *   prepare -> semantic cache lookup -> router (fallback chain + circuit breakers)
 *   -> usage resolution (provider-reported or tiktoken estimate) -> cost -> usage ledger -> cache store
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly router: LlmRouter,
    private readonly usage: UsageService,
    private readonly prices: PriceTable,
    private readonly estimator: TokenEstimator,
    @Inject(SEMANTIC_CACHE) private readonly cache: SemanticCache,
  ) {}

  async complete(tenant: Tenant, input: ChatRequestDto): Promise<ChatResponse> {
    const prepared = this.prepare(tenant, input);
    const startedAt = Date.now();

    const hit = prepared.cacheKey ? await this.cache.lookup(prepared.cacheKey) : null;
    if (hit) {
      const target: ModelRef = { provider: hit.value.provider, model: hit.value.model };
      await this.recordUsage(tenant, target, zeroUsage(), 0, { cacheHit: true, fallbackUsed: false, startedAt });
      RequestContext.logger().info({ similarity: hit.similarity }, 'semantic cache hit');
      return this.response(prepared, tenant, target, hit.value.content, zeroUsage(), 0, true, false, []);
    }

    const routed = await this.router.complete(prepared.chain, {
      messages: prepared.messages,
      maxTokens: prepared.maxTokens,
      temperature: input.temperature,
    });
    const usage = this.resolveUsage(routed.target, prepared.messages, routed.result.content, routed.result.usage);
    const costUsd = this.prices.cost(routed.target, usage);
    const fallbackUsed = !sameTarget(routed.target, prepared.chain[0]!);
    await this.recordUsage(tenant, routed.target, usage, costUsd, { cacheHit: false, fallbackUsed, startedAt });
    if (prepared.cacheKey && routed.result.content) {
      await this.cache.store(prepared.cacheKey, { content: routed.result.content, ...routed.target });
    }
    return this.response(prepared, tenant, routed.target, routed.result.content, usage, costUsd, false, fallbackUsed, routed.attempts);
  }

  /**
   * Streams the answer. Usage is recorded in `finally`, so it is also billed when the client
   * disconnects mid-stream (the upstream call is aborted via `signal` and partial output is
   * estimated with tiktoken).
   */
  async *stream(tenant: Tenant, input: ChatRequestDto, signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const prepared = this.prepare(tenant, input);
    const startedAt = Date.now();
    const assistant = tenant.branding.assistantName;

    const hit = prepared.cacheKey ? await this.cache.lookup(prepared.cacheKey) : null;
    if (hit) {
      const target: ModelRef = { provider: hit.value.provider, model: hit.value.model };
      await this.recordUsage(tenant, target, zeroUsage(), 0, { cacheHit: true, fallbackUsed: false, startedAt });
      yield { type: 'meta', id: prepared.id, assistant, ...target, cached: true, fallbackUsed: false };
      yield { type: 'delta', content: hit.value.content };
      yield { type: 'done', usage: toChatUsage(zeroUsage(), false), costUsd: 0, finishReason: 'stop' };
      return;
    }

    let target: ModelRef | undefined;
    let content = '';
    let reported: TokenUsage | undefined;
    let completed = false;
    try {
      for await (const event of this.router.stream(prepared.chain, {
        messages: prepared.messages,
        maxTokens: prepared.maxTokens,
        temperature: input.temperature,
        signal,
      })) {
        if (event.type === 'start') {
          target = event.target;
          yield { type: 'meta', id: prepared.id, assistant, ...target, cached: false, fallbackUsed: !sameTarget(target, prepared.chain[0]!) };
        } else if (event.type === 'delta') {
          content += event.content;
          yield { type: 'delta', content: event.content };
        } else {
          reported = event.usage;
        }
      }
      completed = true;
      const usage = this.resolveUsage(target!, prepared.messages, content, reported);
      const costUsd = this.prices.cost(target!, usage);
      yield { type: 'done', usage: toChatUsage(usage, !reported), costUsd, finishReason: 'stop' };
    } finally {
      if (target) {
        const usage = this.resolveUsage(target, prepared.messages, content, reported);
        const fallbackUsed = !sameTarget(target, prepared.chain[0]!);
        await this.recordUsage(tenant, target, usage, this.prices.cost(target, usage), { cacheHit: false, fallbackUsed, startedAt });
        if (completed && prepared.cacheKey && content) await this.cache.store(prepared.cacheKey, { content, ...target });
        if (!completed) RequestContext.logger().info({ partialChars: content.length }, 'stream aborted; partial usage billed');
      }
    }
  }

  private prepare(tenant: Tenant, input: ChatRequestDto): Prepared {
    const last = input.messages[input.messages.length - 1];
    if (!last || last.role !== 'user') throw new BadRequestException('The last message must have role "user"');

    const limits = effectiveLimits(tenant);
    const conversation: ChatMessage[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
    const messages: ChatMessage[] = tenant.systemPrompt
      ? [{ role: 'system', content: tenant.systemPrompt }, ...conversation]
      : conversation;
    const chain = fallbackChain(tenant);

    const useCache = tenant.cacheEnabled && input.cache !== false;
    const cacheKey: SemanticCacheKey | null = useCache
      ? {
          tenantId: tenant.id,
          scope: sha256(stableStringify({ primary: chain[0], system: tenant.systemPrompt, history: conversation.slice(0, -1) })),
          query: last.content,
        }
      : null;

    return {
      id: `chat_${randomUUID()}`,
      messages,
      chain,
      maxTokens: Math.min(input.maxTokens ?? limits.maxOutputTokens, limits.maxOutputTokens),
      cacheKey,
    };
  }

  private resolveUsage(target: ModelRef, prompt: ChatMessage[], completion: string, reported?: TokenUsage): TokenUsage & { estimated: boolean } {
    if (reported) return { ...reported, cachedPromptTokens: reported.cachedPromptTokens ?? 0, estimated: false };
    return {
      promptTokens: this.estimator.countMessages(prompt, target.model),
      completionTokens: this.estimator.countText(completion, target.model),
      cachedPromptTokens: 0,
      estimated: true,
    };
  }

  private async recordUsage(
    tenant: Tenant,
    target: ModelRef,
    usage: TokenUsage & { estimated?: boolean },
    costUsd: number,
    meta: { cacheHit: boolean; fallbackUsed: boolean; startedAt: number },
  ): Promise<void> {
    await this.usage.record({
      tenantId: tenant.id,
      requestId: RequestContext.requestId() ?? 'n/a',
      provider: target.provider,
      model: target.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedPromptTokens: usage.cachedPromptTokens ?? 0,
      costUsd,
      estimated: usage.estimated ?? false,
      cacheHit: meta.cacheHit,
      fallbackUsed: meta.fallbackUsed,
      latencyMs: Date.now() - meta.startedAt,
      createdAt: new Date(),
    });
    RequestContext.logger().info(
      { provider: target.provider, model: target.model, ...usage, costUsd, ...meta, startedAt: undefined },
      'usage recorded',
    );
  }

  private response(
    prepared: Prepared,
    tenant: Tenant,
    target: ModelRef,
    content: string,
    usage: TokenUsage & { estimated?: boolean },
    costUsd: number,
    cached: boolean,
    fallbackUsed: boolean,
    attempts: ChatResponse['attempts'],
  ): ChatResponse {
    return {
      id: prepared.id,
      object: 'chat.completion',
      createdAt: new Date().toISOString(),
      assistant: tenant.branding.assistantName,
      provider: target.provider,
      model: target.model,
      content,
      usage: toChatUsage(usage, usage.estimated ?? false),
      costUsd,
      cached,
      fallbackUsed,
      attempts,
    };
  }
}

function zeroUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 };
}

function toChatUsage(usage: TokenUsage, estimated: boolean): ChatUsage {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.promptTokens + usage.completionTokens,
    cachedPromptTokens: usage.cachedPromptTokens ?? 0,
    estimated,
  };
}

function sameTarget(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model === b.model;
}
