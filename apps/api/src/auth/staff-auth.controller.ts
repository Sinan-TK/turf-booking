import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loadEnv } from '@venue/config';
import { StaffPortal } from '@venue/database';
import { Role } from '@venue/shared';
import { StaffAuthService, type StaffSession } from './staff-auth.service';
import { AuthGuard } from './guards/auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthContext } from './auth.types';
import { STAFF_COOKIES, STAFF_REFRESH_COOKIE_PATH, staffCookieOptions } from './auth.constants';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  StaffLoginDto,
} from './dto/staff-auth.dto';

function parsePortal(raw: string): StaffPortal {
  if (raw === 'admin') return StaffPortal.ADMIN;
  if (raw === 'owner') return StaffPortal.OWNER;
  throw new NotFoundException();
}

/**
 * Login / refresh / logout / forgot- & reset-password / change-password
 * for both staff portals: POST /auth/admin/* and POST /auth/owner/*.
 * Sessions are httpOnly cookies (see STAFF_COOKIES); the JSON bodies carry
 * only the non-secret AuthContext, never a token.
 */
@Controller('auth')
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  @Post(':portal/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Param('portal') rawPortal: string,
    @Body() dto: StaffLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const portal = parsePortal(rawPortal);
    const session = await this.auth.login(portal, dto.email, dto.password);
    this.setSessionCookies(res, portal, session);
    return session.ctx;
  }

  @Post(':portal/refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Param('portal') rawPortal: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const portal = parsePortal(rawPortal);
    const raw = req.cookies?.[STAFF_COOKIES[portal].refresh];
    if (!raw) throw new UnauthorizedException('Session expired');
    try {
      const session = await this.auth.refresh(portal, raw);
      this.setSessionCookies(res, portal, session);
      return session.ctx;
    } catch (error) {
      this.clearSessionCookies(res, portal);
      throw error;
    }
  }

  @Post(':portal/logout')
  @HttpCode(204)
  async logout(
    @Param('portal') rawPortal: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const portal = parsePortal(rawPortal);
    await this.auth.logout(portal, req.cookies?.[STAFF_COOKIES[portal].refresh]);
    this.clearSessionCookies(res, portal);
  }

  @Post(':portal/forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Param('portal') rawPortal: string, @Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(parsePortal(rawPortal), dto.email);
    return { ok: true };
  }

  @Post(':portal/reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@Param('portal') rawPortal: string, @Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(parsePortal(rawPortal), dto.token, dto.password);
    return { ok: true };
  }

  @Post(':portal/change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  async changePassword(
    @Param('portal') rawPortal: string,
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const portal = parsePortal(rawPortal);
    const expectedRole = portal === StaffPortal.ADMIN ? Role.SUPER_ADMIN : Role.VENUE_OWNER;
    if (user.role !== expectedRole) throw new ForbiddenException('Insufficient permissions');

    const session = await this.auth.changePassword(portal, user, dto.currentPassword, dto.newPassword);
    this.setSessionCookies(res, portal, session);
    return { ok: true };
  }

  private setSessionCookies(res: Response, portal: StaffPortal, session: StaffSession) {
    const env = loadEnv();
    const names = STAFF_COOKIES[portal];
    res.cookie(
      names.access,
      session.accessToken,
      staffCookieOptions(env.ACCESS_TOKEN_TTL_MINUTES * 60_000),
    );
    res.cookie(
      names.refresh,
      session.refreshToken,
      staffCookieOptions(env.REFRESH_TOKEN_TTL_DAYS * 86_400_000, STAFF_REFRESH_COOKIE_PATH),
    );
  }

  private clearSessionCookies(res: Response, portal: StaffPortal) {
    const names = STAFF_COOKIES[portal];
    res.clearCookie(names.access, { path: '/' });
    res.clearCookie(names.refresh, { path: STAFF_REFRESH_COOKIE_PATH });
  }
}
