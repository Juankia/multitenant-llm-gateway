import { type ProviderName } from '../llm.types';
import { ProviderError } from '../provider-error';

export interface HttpCallOptions {
  provider: ProviderName;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** POSTs JSON with a timeout + client-abort signal and normalizes failures into ProviderError. */
export async function postJson(options: HttpCallOptions): Promise<Response> {
  const signals = [AbortSignal.timeout(options.timeoutMs)];
  if (options.signal) signals.push(options.signal);
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    throw ProviderError.from(options.provider, error, options.signal);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw ProviderError.fromStatus(options.provider, response.status, detail);
  }
  return response;
}

async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) yield buffer;
}

export interface SseEvent {
  event?: string;
  data: string;
}

/** Minimal spec-compliant Server-Sent Events parser over a fetch() body. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  let event: string | undefined;
  let data: string[] = [];
  for await (const line of readLines(body)) {
    if (line === '') {
      if (data.length > 0) yield { event, data: data.join('\n') };
      event = undefined;
      data = [];
    } else if (line.startsWith(':')) {
      continue; // comment / keep-alive
    } else {
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
  }
  if (data.length > 0) yield { event, data: data.join('\n') };
}

/** Newline-delimited JSON (used by Ollama). */
export async function* parseNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  for await (const line of readLines(body)) {
    if (line.trim()) yield JSON.parse(line) as T;
  }
}

export function requireBody(provider: ProviderName, response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new ProviderError(provider, 'Empty streaming body', true);
  return response.body;
}

export function splitSystem(messages: { role: string; content: string }[]): {
  system: string;
  rest: { role: 'user' | 'assistant'; content: string }[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  return { system, rest };
}
