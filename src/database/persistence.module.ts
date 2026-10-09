import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { InMemoryUsageRepository, USAGE_REPOSITORY } from '../finops/usage.repository';
import { PostgresUsageRepository } from '../finops/postgres-usage.repository';
import { IDEMPOTENCY_REPOSITORY, InMemoryIdempotencyRepository } from '../idempotency/idempotency.repository';
import { PostgresIdempotencyRepository } from '../idempotency/postgres-idempotency.repository';
import { InMemoryTenantRepository } from '../tenants/in-memory-tenant.repository';
import { PostgresTenantRepository } from '../tenants/postgres-tenant.repository';
import { TENANT_REPOSITORY } from '../tenants/tenant.repository';
import { DATA_SOURCE, TenantDb } from './tenant-db';

@Injectable()
export class DataSourceShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource?.isInitialized) await this.dataSource.destroy();
  }
}

/**
 * Chooses the persistence adapter at boot. Both adapters implement the same repository
 * interfaces, which is what lets the e2e suite run the full HTTP stack with no database.
 * TypeORM is used as the connection pool / transaction manager; queries are explicit SQL so
 * the RLS behaviour stays obvious. Schema is owned by the SQL migrations in db/migrations.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig): Promise<DataSource | null> => {
        if (config.persistence !== 'postgres') return null;
        const dataSource = new DataSource({
          type: 'postgres',
          url: config.databaseUrl,
          synchronize: false,
          migrationsRun: false,
          extra: { max: 10, application_name: 'llm-gateway' },
        });
        return dataSource.initialize();
      },
    },
    {
      provide: TenantDb,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) => (ds ? new TenantDb(ds) : null),
    },
    {
      provide: TENANT_REPOSITORY,
      inject: [TenantDb],
      useFactory: (db: TenantDb | null) => (db ? new PostgresTenantRepository(db) : new InMemoryTenantRepository()),
    },
    {
      provide: USAGE_REPOSITORY,
      inject: [TenantDb],
      useFactory: (db: TenantDb | null) => (db ? new PostgresUsageRepository(db) : new InMemoryUsageRepository()),
    },
    {
      provide: IDEMPOTENCY_REPOSITORY,
      inject: [TenantDb],
      useFactory: (db: TenantDb | null) =>
        db ? new PostgresIdempotencyRepository(db) : new InMemoryIdempotencyRepository(),
    },
    DataSourceShutdown,
  ],
  exports: [TENANT_REPOSITORY, USAGE_REPOSITORY, IDEMPOTENCY_REPOSITORY],
})
export class PersistenceModule {}
