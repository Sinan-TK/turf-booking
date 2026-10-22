import { SetMetadata } from '@nestjs/common';
import type { OwnerUserRole } from '@venue/shared';

export const OWNER_ROLES_KEY = 'ownerRoles';

/** Narrows a Venue Owner endpoint to some owner-portal roles (e.g. OWNER_ADMIN only). The Super Admin is unaffected. */
export const OwnerRoles = (...roles: OwnerUserRole[]) => SetMetadata(OWNER_ROLES_KEY, roles);
