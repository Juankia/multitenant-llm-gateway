import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PROVIDER_NAMES, type ProviderName } from '../../llm/llm.types';
import { PLANS, type Plan, TENANT_STATUSES, type TenantStatus } from '../tenant.model';

export class ModelRefDto {
  @ApiProperty({ enum: PROVIDER_NAMES, example: 'openai' })
  @IsIn(PROVIDER_NAMES)
  provider!: ProviderName;

  @ApiProperty({ example: 'gpt-4o-mini' })
  @IsString()
  @Length(1, 100)
  model!: string;
}

export class BrandingDto {
  @ApiProperty({ example: 'Aria' })
  @IsString()
  @Length(1, 60)
  assistantName!: string;

  @ApiPropertyOptional({ example: '#0F766E' })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primaryColor?: string;

  @ApiPropertyOptional({ example: 'Hi! How can I help you today?' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  welcomeMessage?: string;
}

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Insurance' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ example: 'acme-insurance', description: 'Unique, immutable identifier' })
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, { message: 'slug must be 3-40 chars of a-z, 0-9 and dashes' })
  slug!: string;

  @ApiProperty({ enum: PLANS, example: 'pro' })
  @IsIn(PLANS)
  plan!: Plan;

  @ApiProperty({ type: ModelRefDto })
  @ValidateNested()
  @Type(() => ModelRefDto)
  primary!: ModelRefDto;

  @ApiPropertyOptional({ type: [ModelRefDto], description: 'Ordered fallback chain (max 3)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ModelRefDto)
  fallbacks?: ModelRefDto[];

  @ApiPropertyOptional({ example: 'You are Aria, the support assistant of Acme Insurance. Be concise.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  systemPrompt?: string;

  @ApiPropertyOptional({ type: BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;

  @ApiPropertyOptional({ example: 50, description: 'Overrides the plan budget (USD / UTC month)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1_000_000)
  monthlyBudgetUsd?: number;

  @ApiPropertyOptional({ example: 1024, description: 'Overrides the plan max output tokens' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32_768)
  maxOutputTokens?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  cacheEnabled?: boolean;
}

export class UpdateTenantDto extends PartialType(OmitType(CreateTenantDto, ['slug'] as const)) {
  @ApiPropertyOptional({ enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;
}
