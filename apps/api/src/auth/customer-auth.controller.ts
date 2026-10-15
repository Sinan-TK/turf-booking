import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loadEnv } from '@venue/config';
import { Role } from '@venue/shared';
import { CustomerOtpService } from './customer-otp.service';
import { CustomerSessionService } from './customer-session.service';
import { CustomersService } from '../customers/customers.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthContext } from './auth.types';
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE_OPTIONS } from './auth.constants';
import { RequestCodeDto, UpdateProfileDto, VerifyCodeDto } from './dto/customer-auth.dto';

/**
 * Customer website login. The route prefix is `customer-auth` (not
 * `auth/customer`) so it can never collide with the staff `auth/:portal/*`
 * routes. The session lives in an httpOnly cookie; bodies carry no token.
 */
@Controller('customer-auth')
export class CustomerAuthController {
  constructor(
    private readonly otp: CustomerOtpService,
    private readonly sessions: CustomerSessionService,
    private readonly customers: CustomersService,
  ) {}

  @Post('request-code')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestCode(@Body() dto: RequestCodeDto) {
    return this.otp.requestCode(dto.phone);
  }

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() dto: VerifyCodeDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.otp.verifyCode(dto.phone, dto.code);
    res.cookie(CUSTOMER_SESSION_COOKIE, result.rawToken, {
      ...CUSTOMER_SESSION_COOKIE_OPTIONS(),
      maxAge: loadEnv().CUSTOMER_SESSION_TTL_HOURS * 3_600_000,
    });
    return { customer: result.customer, needsName: result.needsName };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[CUSTOMER_SESSION_COOKIE];
    if (raw) await this.sessions.revokeSession(raw);
    res.clearCookie(CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE_OPTIONS());
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async me(@CurrentUser() actor: AuthContext) {
    const c = await this.customers.getForAdmin(actor.id);
    return { id: c.id, name: c.name, phone: c.whatsappNumber };
  }

  @Patch('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async updateMe(@CurrentUser() actor: AuthContext, @Body() dto: UpdateProfileDto) {
    const c = await this.customers.updateName(actor.id, dto.name);
    return { id: c.id, name: c.name, phone: c.whatsappNumber };
  }
}
