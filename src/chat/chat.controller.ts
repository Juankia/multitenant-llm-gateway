import { BadRequestException, Body, Controller, Headers, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { type Request, type Response } from 'express';
import { RequestContext } from '../common/request-context';
import { BudgetGuard } from '../finops/budget.guard';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ProviderError } from '../llm/provider-error';
import { CurrentTenant } from '../tenants/current-tenant.decorator';
import { TenantApiKeyGuard } from '../tenants/guards/tenant-api-key.guard';
import { type Tenant } from '../tenants/tenant.model';
import { ChatService } from './chat.service';
import { type ChatStreamEvent } from './chat.types';
import { ChatRequestDto } from './dto/chat-request.dto';

@ApiTags('chat')
@ApiBearerAuth('tenant-key')
@Controller('v1/chat')
@UseGuards(TenantApiKeyGuard, BudgetGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Chat completion routed through the tenant provider chain',
    description:
      'Returns JSON, or Server-Sent Events when `stream: true` (events: meta, delta, done, error). ' +
      'Supports `Idempotency-Key` for non-streaming requests.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Safe retries: same key + same body replays the response' })
  @ApiProduces('application/json', 'text/event-stream')
  @ApiOkResponse({ description: 'Completion (JSON) or SSE stream' })
  @ApiTooManyRequestsResponse({ description: 'Monthly budget exhausted; see X-Budget-Reset-At header' })
  async create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: ChatRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (body.stream) {
      if (idempotencyKey) throw new BadRequestException('Idempotency-Key is not supported with stream=true');
      await this.streamSse(tenant, body, req, res);
      return;
    }
    const outcome = await this.idempotency.execute(tenant.id, idempotencyKey, body, () => this.chat.complete(tenant, body));
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(200).json(outcome.body);
  }

  /**
   * Headers are written lazily on the first event: if every provider fails before producing a
   * token, the client still receives a proper HTTP error (503 + JSON) instead of a broken stream.
   */
  private async streamSse(tenant: Tenant, body: ChatRequestDto, _req: Request, res: Response): Promise<void> {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    const write = (event: ChatStreamEvent | { type: 'error'; error: string; message: string }) => {
      if (!res.headersSent) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
      }
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.chat.stream(tenant, body, abort.signal)) {
        if (abort.signal.aborted) break;
        write(event);
      }
    } catch (error) {
      if (!res.headersSent) throw error; // handled by the global exception filter
      if (!(error instanceof ProviderError && error.aborted)) {
        RequestContext.logger().error({ err: error }, 'stream failed after first token');
        write({ type: 'error', error: 'stream_interrupted', message: 'The upstream provider failed mid-stream' });
      }
    }
    if (!res.writableEnded) res.end();
  }
}
