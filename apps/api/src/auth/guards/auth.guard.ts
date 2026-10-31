import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { loadEnv } from '@venue/config';
import { Role } from '@venue/shared';
import { StaffTokenService } from '../../identity/staff-token.service';
import { CustomerSessionService } from '../customer-session.service';
import { CUSTOMER_SESSION_COOKIE, STAFF_COOKIES } from '../auth.constants';
import { ALLOW_PENDING_OWNER_KEY } from '../decorators/roles.decorator';

/**
 * Single guard for all three identity types (ARCHITECTURE.md §12):
 * a self-issued HS256 access JWT for admin/owner —
 * verified locally, then checked against the account so a blocked login stops at once — and a server-side session lookup for customer
 * (cookie). Populates `request.authContext` uniformly so downstream code —
 * RolesGuard, @CurrentUser, every scoped service method — never has to
 * know which mechanism authenticated the caller.
 *
 * Admin/owner access tokens normally arrive as httpOnly cookies set by
 * /auth/{admin,owner}/login (an `Authorization: Bearer` header is also
 * accepted, for tests and tooling). Both portals' cookies can coexist in
 * one browser on a shared host (localhost in dev), so the cookie matching
 * the request's Origin is tried first; a token that fails verification
 * just falls through to the next candidate.
 *
 * The customer cookie lives on the same host too, so who a request is answered as depends on where it comes from:
 * the customer site only ever acts as the customer, and the admin and owner portals only ever as staff. Without that,
 * a staff sign-in still valid in the same browser would turn every customer request into a staff one (403, so the
 * customer looks logged out), and a customer cookie would answer a portal whose own sign-in had expired (403 instead
 * of the 401 that makes it sign in again). A request with no recognisable origin (tests, scripts) keeps the old
 * order: staff first, then customer.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly staffTokens: StaffTokenService,
    private readonly customerSessions: CustomerSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const caller = this.callerOf(request);

    if (caller !== 'CUSTOMER_SITE') {
      for (const token of this.staffTokenCandidates(request)) {
        const authContext = await this.staffTokens.verifyAccessToken(token);
        if (authContext) {
          // A valid token is not enough: a login that was blocked (or whose organisation was suspended, or whose role changed)
          // is refused straight away, not when the token happens to expire. The portals answer a 401 by signing the person out.
          const state = await this.staffTokens.accessState(authContext);
          if (state === 'BLOCKED') throw new UnauthorizedException('This login is no longer active');
          // An owner whose sign-up is waiting for approval may only ask who they are and change their password.
          if (state === 'PENDING' && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_OWNER_KEY, [context.getHandler(), context.getClass()])) {
            throw new ForbiddenException({ message: 'Your account is waiting for approval.', code: 'ORGANIZATION_PENDING' });
          }
          request.authContext = authContext;
          return true;
        }
      }
    }

    if (caller !== 'STAFF_PORTAL') {
      const customerToken = request.cookies?.[CUSTOMER_SESSION_COOKIE];
      if (customerToken) {
        const session = await this.customerSessions.validateSession(customerToken);
        if (session) {
          request.authContext = { role: Role.CUSTOMER, id: session.customerId };
          return true;
        }
      }
    }

    throw new UnauthorizedException('Authentication required');
  }

  /** Which of our apps the request comes from, judged by its Origin (or Referer); undefined for anything else. */
  private callerOf(request: Request): 'CUSTOMER_SITE' | 'STAFF_PORTAL' | undefined {
    const env = loadEnv();
    const origin = this.originOf(request.headers.origin ?? request.headers.referer);
    if (!origin) return undefined;
    if (origin === this.originOf(env.WEB_APP_URL)) return 'CUSTOMER_SITE';
    if (origin === this.originOf(env.ADMIN_APP_URL) || origin === this.originOf(env.OWNER_APP_URL)) return 'STAFF_PORTAL';
    return undefined;
  }

  private staffTokenCandidates(request: Request): string[] {
    const candidates: string[] = [];

    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) candidates.push(header.slice('Bearer '.length));

    const env = loadEnv();
    const callerOrigin = this.originOf(request.headers.origin ?? request.headers.referer);
    const ownerFirst = callerOrigin !== undefined && callerOrigin === this.originOf(env.OWNER_APP_URL);
    const order = ownerFirst ? (['OWNER', 'ADMIN'] as const) : (['ADMIN', 'OWNER'] as const);
    for (const portal of order) {
      const token = request.cookies?.[STAFF_COOKIES[portal].access];
      if (typeof token === 'string' && token) candidates.push(token);
    }
    return candidates;
  }

  private originOf(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  }
}
