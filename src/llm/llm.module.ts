import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { LlmRouter } from './llm-router';
import { LLM_PROVIDERS, type LlmProvider } from './llm.types';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { MockProvider } from './providers/mock.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAiProvider } from './providers/openai.provider';

@Module({
  providers: [
    {
      provide: LLM_PROVIDERS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): LlmProvider[] => {
        const { providers: p, providerTimeoutMs: timeoutMs } = config;
        return [
          new OpenAiProvider({ apiKey: p.openaiApiKey, baseUrl: p.openaiBaseUrl, timeoutMs }),
          new AnthropicProvider({ apiKey: p.anthropicApiKey, baseUrl: p.anthropicBaseUrl, timeoutMs }),
          new GeminiProvider({ apiKey: p.geminiApiKey, baseUrl: p.geminiBaseUrl, timeoutMs }),
          new OllamaProvider({ baseUrl: p.ollamaBaseUrl, timeoutMs }),
          new MockProvider(p.enableMock),
        ];
      },
    },
    {
      provide: CircuitBreakerRegistry,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new CircuitBreakerRegistry(config.circuitBreaker),
    },
    LlmRouter,
  ],
  exports: [LlmRouter],
})
export class LlmModule {}
