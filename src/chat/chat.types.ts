import { type ProviderName } from '../llm/llm.types';
import { type Attempt } from '../llm/provider-error';

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  /** True when counts were estimated with tiktoken (provider reported no usage). */
  estimated: boolean;
}

export interface ChatResponse {
  id: string;
  object: 'chat.completion';
  createdAt: string;
  assistant: string;
  provider: ProviderName;
  model: string;
  content: string;
  usage: ChatUsage;
  costUsd: number;
  cached: boolean;
  fallbackUsed: boolean;
  attempts: Attempt[];
}

export type ChatStreamEvent =
  | { type: 'meta'; id: string; assistant: string; provider: ProviderName; model: string; cached: boolean; fallbackUsed: boolean }
  | { type: 'delta'; content: string }
  | { type: 'done'; usage: ChatUsage; costUsd: number; finishReason: 'stop' | 'aborted' };
