import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { fakeHttpContext } from '../../../test/fakes/execution-context';
import { FIXTURE_API_KEY, makeTenant } from '../../../test/fakes/tenant.fixture';
import { InMemoryTenantRepository } from '../in-memory-tenant.repository';
import { TenantsService } from '../tenants.service';
import { TenantApiKeyGuard } from './tenant-api-key.guard';

describe('TenantApiKeyGuard', () => {
  let repo: InMemoryTenantRepository;
  let guard: TenantApiKeyGuard;

  beforeEach(async () => {
    repo = new InMemoryTenantRepository();
    await repo.create(makeTenant());
    guard = new TenantApiKeyGuard(new TenantsService(repo));
  });

  it('rejects requests without an API key', async () => {
    await expect(guard.canActivate(fakeHttpContext().context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unknown keys', async () => {
    const http = fakeHttpContext({ authorization: 'Bearer tgw_not_a_real_key' });
    await expect(guard.canActivate(http.context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolves the tenant from a Bearer token and attaches it to the request', async () => {
    const http = fakeHttpContext({ authorization: `Bearer ${FIXTURE_API_KEY}` });
    await expect(guard.canActivate(http.context)).resolves.toBe(true);
    expect(http.request.tenant).toMatchObject({ slug: 'acme-insurance' });
  });

  it('accepts the x-api-key header as well', async () => {
    const http = fakeHttpContext({ 'x-api-key': FIXTURE_API_KEY });
    await expect(guard.canActivate(http.context)).resolves.toBe(true);
  });

  it('rejects suspended tenants with 403', async () => {
    await repo.update(makeTenant().id, { status: 'suspended' });
    const http = fakeHttpContext({ authorization: `Bearer ${FIXTURE_API_KEY}` });
    await expect(guard.canActivate(http.context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores only the SHA-256 hash of the key', async () => {
    const [tenant] = await repo.list();
    expect(tenant?.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(tenant)).not.toContain(FIXTURE_API_KEY);
  });
});
