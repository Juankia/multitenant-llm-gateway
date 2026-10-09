import { type ExecutionContext } from '@nestjs/common';

export interface FakeHttp {
  request: { headers: Record<string, string>; header(name: string): string | undefined; tenant?: unknown };
  response: { headers: Record<string, string>; setHeader(name: string, value: string): void };
  context: ExecutionContext;
}

/** Minimal ExecutionContext for guard unit tests. */
export function fakeHttpContext(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): FakeHttp {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const request = { headers: lower, header: (name: string) => lower[name.toLowerCase()], ...extra };
  const response = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { request, response, context };
}
