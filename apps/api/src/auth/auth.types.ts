import type { OwnerUserRole, Role } from '@venue/shared';

/**
 * What every guard attaches to the request, and what every RBAC-scoped
 * service method takes as its mandatory first argument (ARCHITECTURE.md
 * §12 — ownership is never implied by role alone). For SUPER_ADMIN/
 * VENUE_OWNER, derived straight from the verified access JWT's claims
 * (see identity/staff-token.service.ts) — no DB lookup.
 */
export interface AuthContext {
  role: Role;
  id: string;
  organizationId?: string;
  ownerRole?: OwnerUserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}
