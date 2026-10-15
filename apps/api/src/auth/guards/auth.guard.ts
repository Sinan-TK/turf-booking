import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { loadEnv } from '@venue/config';
import { Role } from '@venue/shared';
import { StaffTokenService } from '../../identity/staff-token.service';
import { CustomerSessionService } from '../customer-session.service';
import { CUSTOMER_SESSION_COOKIE, STAFF_COOKIES } from '../auth.constants';

/**
 * Single guard for all three identity types (ARCHITECTURE.md §12):
 * a self-issued HS256 access JWT for admin/owner — verified locally and
 * stateless, no DB lookup — and a server-side session lookup for customer
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
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly staffTokens: StaffTokenService,
    private readonly customerSessions: CustomerSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    for (const token of this.staffTokenCandidates(request)) {
      const authContext = await this.staffTokens.verifyAccessToken(token);
      if (authContext) {
        request.authContext = authContext;
        return true;
      }
    }

    const customerToken = request.cookies?.[CUSTOMER_SESSION_COOKIE];
    if (customerToken) {
      const session = await this.customerSessions.validateSession(customerToken);
      if (session) {
        request.authContext = { role: Role.CUSTOMER, id: session.customerId };
        return true;
      }
    }

    throw new UnauthorizedException('Authentication required');
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
