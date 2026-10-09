import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { AdminKeyGuard } from './guards/admin-key.guard';
import { type PublicTenant } from './tenant.model';
import { TenantsService, type TenantWithKey } from './tenants.service';

@ApiTags('admin')
@ApiSecurity('admin-key')
@Controller('admin/tenants')
@UseGuards(AdminKeyGuard)
export class AdminTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a tenant. The API key is returned once and never again.' })
  @ApiCreatedResponse({ description: '{ tenant, apiKey }' })
  create(@Body() dto: CreateTenantDto): Promise<TenantWithKey> {
    return this.tenants.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tenants' })
  list(): Promise<PublicTenant[]> {
    return this.tenants.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tenant' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PublicTenant> {
    return this.tenants.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update tenant config (provider chain, prompt, branding, limits, status)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto): Promise<PublicTenant> {
    return this.tenants.update(id, dto);
  }

  @Post(':id/rotate-key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the tenant API key (old key is revoked immediately)' })
  @ApiOkResponse({ description: '{ tenant, apiKey }' })
  rotateKey(@Param('id', ParseUUIDPipe) id: string): Promise<TenantWithKey> {
    return this.tenants.rotateKey(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a tenant and (via ON DELETE CASCADE) all its data' })
  @ApiNoContentResponse()
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tenants.delete(id);
  }
}
