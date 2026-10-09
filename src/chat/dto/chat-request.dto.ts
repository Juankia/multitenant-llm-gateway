import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'], description: 'System prompt is owned by the tenant config' })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty({ example: 'What are your opening hours?' })
  @IsString()
  @Length(1, 32_000)
  content!: string;
}

export class ChatRequestDto {
  @ApiProperty({ type: [ChatMessageDto], description: 'Conversation so far; the last message must be from the user' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @ApiPropertyOptional({ default: false, description: 'Stream the answer as Server-Sent Events' })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 2, example: 0.2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ description: 'Capped by the tenant plan limit', example: 400 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32_768)
  maxTokens?: number;

  @ApiPropertyOptional({ default: true, description: 'Set false to bypass the semantic cache' })
  @IsOptional()
  @IsBoolean()
  cache?: boolean;
}
