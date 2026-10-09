import { AnthropicProvider } from './anthropic.provider';
import { OpenAiProvider } from './openai.provider';
import { parseSse } from './http';
import { ProviderError } from '../provider-error';

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  const text = events.map((e) => `${e}\n\n`).join('');
  return new ReadableStream({
    start(controller) {
      // split mid-event to exercise buffering
      const bytes = new TextEncoder().encode(text);
      controller.enqueue(bytes.slice(0, 7));
      controller.enqueue(bytes.slice(7));
      controller.close();
    },
  });
}

describe('provider adapters (fetch stubbed, no network)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  const request = {
    model: 'm',
    maxTokens: 100,
    messages: [
      { role: 'system' as const, content: 'You are Aria.' },
      { role: 'user' as const, content: 'Hi' },
    ],
  };

  it('Anthropic: sends the system prompt as a cacheable block and maps cache usage', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://api.test', timeoutMs: 1000 });

    const result = await provider.complete(request);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toBe('https://api.test/messages');
    expect(body.system).toEqual([{ type: 'text', text: 'You are Aria.', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(result).toEqual({
      content: 'Hello!',
      finishReason: 'end_turn',
      usage: { promptTokens: 1220, completionTokens: 5, cachedPromptTokens: 1200 },
    });
  });

  it('Anthropic: parses the streaming event protocol', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sseBody([
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
          'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
        ]),
      ),
    );
    const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://api.test', timeoutMs: 1000 });
    const chunks = [];
    for await (const chunk of provider.stream(request)) chunks.push(chunk);
    expect(chunks).toEqual([
      { type: 'delta', content: 'Hel' },
      { type: 'delta', content: 'lo' },
      { type: 'usage', usage: { promptTokens: 12, completionTokens: 7, cachedPromptTokens: 0 } },
    ]);
  });

  it('OpenAI: requests usage in streams and maps cached tokens', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sseBody([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":10}}}',
          'data: [DONE]',
        ]),
      ),
    );
    const provider = new OpenAiProvider({ apiKey: 'k', baseUrl: 'https://api.test/v1', timeoutMs: 1000 });
    const chunks = [];
    for await (const chunk of provider.stream(request)) chunks.push(chunk);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(chunks).toEqual([
      { type: 'delta', content: 'Hi' },
      { type: 'usage', usage: { promptTokens: 30, completionTokens: 2, cachedPromptTokens: 10 } },
    ]);
  });

  it('classifies HTTP errors: 429/5xx retryable, 400 not retryable', async () => {
    const provider = new OpenAiProvider({ apiKey: 'k', baseUrl: 'https://api.test/v1', timeoutMs: 1000 });
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(provider.complete(request)).rejects.toMatchObject({ retryable: true, status: 429 });
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(provider.complete(request)).rejects.toMatchObject({ retryable: false, status: 400 });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(provider.complete(request)).rejects.toBeInstanceOf(ProviderError);
  });

  it('parseSse handles comments, multi-line data and CRLF', async () => {
    const events = [];
    for await (const event of parseSse(sseBody([': keep-alive', 'event: x\r\ndata: a\r\ndata: b']))) events.push(event);
    expect(events).toEqual([{ event: 'x', data: 'a\nb' }]);
  });
});
