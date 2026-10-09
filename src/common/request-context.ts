import { AsyncLocalStorage } from 'node:async_hooks';
import { type Logger, rootLogger } from './logging/logger';

export interface RequestContextStore {
  requestId: string;
  logger: Logger;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Request-scoped context backed by AsyncLocalStorage. It avoids Nest's REQUEST scope
 * (which re-instantiates the provider graph per request) while still giving every log
 * line the request id and tenant id.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
  logger(): Logger {
    return storage.getStore()?.logger ?? rootLogger;
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
  /** Binds the tenant to the current request so every subsequent log line carries it. */
  bindTenant(tenantId: string): void {
    const store = storage.getStore();
    if (!store) return;
    store.tenantId = tenantId;
    store.logger = store.logger.child({ tenantId });
  },
};
