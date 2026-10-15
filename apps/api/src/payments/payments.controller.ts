import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreateOrderDto, VerifyPaymentDto } from './dto/payment.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments/create-order')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  createOrder(@Body() dto: CreateOrderDto, @CurrentUser() actor: AuthContext) {
    return this.payments.createOrder(dto.bookingId, actor);
  }

  @Post('payments/verify')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  verify(@Body() dto: VerifyPaymentDto) {
    return this.payments.verifyClientCallback({
      gatewayOrderId: dto.razorpayOrderId,
      gatewayPaymentId: dto.razorpayPaymentId,
      signature: dto.razorpaySignature,
    });
  }

  // No AuthGuard — Razorpay calls this directly. Authenticity comes
  // entirely from the HMAC signature over the raw body (§17), verified
  // inside PaymentsService before anything else happens. Rate-limited
  // generously rather than tightly: Razorpay, not a browser, is the
  // caller, and a too-tight limit could drop legitimate retries.
  @Post('webhooks/razorpay')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    // req.rawBody is populated by NestFactory.create(AppModule, { rawBody: true })
    // in main.ts — required because signature verification must hash the
    // exact bytes Razorpay sent, not a re-serialized JSON.parse() of them.
    return this.payments.handleWebhook(req.rawBody!, signature, eventId);
  }
}

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  listPayments(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.payments.listPaymentsForAdmin({
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('refunds')
  listRefunds(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.payments.listRefundsForAdmin({
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }
}

@Controller('owner')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
export class OwnerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  listPayments(
    @CurrentUser() actor: AuthContext,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payments.listPaymentsForOwner(actor.organizationId!, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('refunds')
  listRefunds(
    @CurrentUser() actor: AuthContext,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payments.listRefundsForOwner(actor.organizationId!, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
