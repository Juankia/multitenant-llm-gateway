import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { InMemorySemanticCache } from './in-memory-semantic-cache';
import { LocalHashingEmbedder } from './local-hashing-embedder';
import { SEMANTIC_CACHE } from './semantic-cache';

@Module({
  providers: [
    {
      provide: SEMANTIC_CACHE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new InMemorySemanticCache(new LocalHashingEmbedder(), config.cache),
    },
  ],
  exports: [SEMANTIC_CACHE],
})
export class CacheModule {}
