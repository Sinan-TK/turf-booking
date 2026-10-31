import { SetMetadata } from '@nestjs/common';
import type { Role } from '@venue/shared';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const ALLOW_PENDING_OWNER_KEY = 'allowPendingOwner';

/**
 * Marks a route an owner whose account is still waiting for approval may use (who am I, change password). Every other route refuses
 * them with 403, so a sign-up sees nothing real until the Super Admin approves it.
 */
export const AllowPendingOwner = () => SetMetadata(ALLOW_PENDING_OWNER_KEY, true);
