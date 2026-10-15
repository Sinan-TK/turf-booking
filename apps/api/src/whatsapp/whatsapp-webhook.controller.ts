import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WhatsAppWebhookService, type WhatsAppWebhookPayload } from './whatsapp-webhook.service';

@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  /** Meta's one-time webhook verification handshake (§15). */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    return this.webhook.verifyHandshake(mode, token, challenge);
  }

  // Rate-limited generously — Meta, not a browser, is the caller.
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ status: string }> {
    // Throws 401 on bad signature; never throws for downstream
    // failures — the service always acks 200 so Meta doesn't retry
    // the whole webhook indefinitely.
    const body = req.body as WhatsAppWebhookPayload;
    const result = await this.webhook.processWebhook(req.rawBody, signature, body);
    if (result.status !== 'ok') {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return result;
  }
}
