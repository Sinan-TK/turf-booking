import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loadEnv } from '@venue/config';
import { Role } from '@venue/shared';
import { CustomerOtpService } from './customer-otp.service';
import { CustomerPasswordService } from './customer-password.service';
import { CustomerSessionService } from './customer-session.service';
import { CustomersService, customerView } from '../customers/customers.service';
import { SiteService } from '../site/site.service';
import { GOOGLE_TOKEN_VERIFIER, type GoogleTokenVerifier } from './google-token-verifier';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthContext } from './auth.types';
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE_OPTIONS } from './auth.constants';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  PasswordLoginDto,
  RequestCodeDto,
  ResetPasswordDto,
  SignUpDto,
  EmailCheckDto,
  UpdateProfileDto,
  VerifyCodeDto,
  VerifyEmailDto,
  VerifySignUpDto,
} from './dto/customer-auth.dto';

const BLOCKED = 'This account has been blocked. Please contact support.';

/**
 * Customer website sign-in. Four ways in (Google, email + password, the phone one-time code, and the
 * sign-up form), all ending in the same httpOnly `customer_session` cookie; bodies carry no token. The route
 * prefix is `customer-auth` (not `auth/customer`) so it can never collide with the staff `auth/:portal/*`.
 */
@Controller('customer-auth')
export class CustomerAuthController {
  constructor(
    private readonly otp: CustomerOtpService,
    private readonly passwords: CustomerPasswordService,
    private readonly sessions: CustomerSessionService,
    private readonly customers: CustomersService,
    @Inject(GOOGLE_TOKEN_VERIFIER) private readonly google: GoogleTokenVerifier,
    private readonly site: SiteService,
  ) {}

  /** Opens a session and sets the cookie; every sign-in method ends here. */
  private async signIn(res: Response, customerId: string) {
    const { rawToken } = await this.sessions.createSession(customerId, 'LOGIN');
    res.cookie(CUSTOMER_SESSION_COOKIE, rawToken, {
      ...CUSTOMER_SESSION_COOKIE_OPTIONS(),
      maxAge: loadEnv().CUSTOMER_SESSION_TTL_HOURS * 3_600_000,
    });
    return customerView((await this.customers.getOwnProfile(customerId))!);
  }

  // --- Google ---------------------------------------------------------------

  @Post('google')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async googleLogin(@Body() dto: GoogleLoginDto, @Res({ passthrough: true }) res: Response) {
    // Off until the Super Admin turns it on (Google must approve the app first): then it does not work at all.
    await this.site.assertGoogleSignInEnabled();
    const identity = await this.google.verify(dto.credential);
    const customer = await this.customers.findOrCreateByGoogle(identity);
    if (customer.status === 'BLOCKED') throw new ForbiddenException(BLOCKED);
    const view = await this.signIn(res, customer.id);
    return { customer: view, needsProfile: view.needsProfile };
  }

  // --- Email + password -----------------------------------------------------

  /** Whether a customer account already uses this email, so the sign-up form can say so while it is being typed. */
  @Post('email-check')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async emailCheck(@Body() dto: EmailCheckDto) {
    return { available: !(await this.customers.emailTaken(dto.email)) };
  }

  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  startSignUp(@Body() dto: SignUpDto) {
    return this.passwords.startSignUp(dto);
  }

  /** The code emailed by `signup` creates the account and signs the customer in. */
  @Post('signup/verify')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifySignUp(@Body() dto: VerifySignUpDto, @Res({ passthrough: true }) res: Response) {
    const customer = await this.passwords.verifySignUp(dto.email, dto.code, dto.ticket);
    const view = await this.signIn(res, customer.id);
    return { customer: view, needsProfile: view.needsProfile };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async passwordLogin(@Body() dto: PasswordLoginDto, @Res({ passthrough: true }) res: Response) {
    const customer = await this.passwords.login(dto.email, dto.password);
    const view = await this.signIn(res, customer.id);
    return { customer: view, needsProfile: view.needsProfile };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwords.forgotPassword(dto.email);
    return { ok: true };
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwords.resetPassword(dto.email, dto.code, dto.password);
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async changePassword(@CurrentUser() actor: AuthContext, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    await this.passwords.changePassword(actor.id, dto.currentPassword, dto.newPassword);
    return { customer: await this.signIn(res, actor.id) };
  }

  // --- Verifying the email on the account -------------------------------------

  /** Emails a code to the account's (unverified) email. */
  @Post('email/send-code')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  sendEmailCode(@CurrentUser() actor: AuthContext) {
    return this.passwords.sendEmailVerification(actor.id);
  }

  /** The emailed code marks the email verified. */
  @Post('email/verify')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(@CurrentUser() actor: AuthContext, @Body() dto: VerifyEmailDto) {
    await this.passwords.confirmEmailVerification(actor.id, dto.code);
    return this.customers.getOwnView(actor.id);
  }

  // --- Phone one-time code (built, not shown in the web app by default) ------

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
    return { customer: result.customer, needsName: result.needsName, needsProfile: result.customer.needsProfile };
  }

  // --- Session --------------------------------------------------------------

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
  me(@CurrentUser() actor: AuthContext) {
    return this.customers.getOwnView(actor.id);
  }

  // Throttled because saving a phone number reveals whether another account has it verified.
  @Patch('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async updateMe(@CurrentUser() actor: AuthContext, @Body() dto: UpdateProfileDto) {
    await this.customers.updateProfile(actor.id, dto);
    return this.customers.getOwnView(actor.id);
  }
}
