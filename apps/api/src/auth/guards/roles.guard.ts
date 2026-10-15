import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '@venue/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Runs after AuthGuard. Checks request.authContext.role against
 * @Roles(...) metadata — role-level access control only. Ownership
 * scoping (a Venue Owner only seeing their own org's data) is NOT this
 * guard's job; it's enforced by every scoped service method taking the
 * caller's id/organizationId as a mandatory argument (ARCHITECTURE.md
 * §12), which this guard cannot see or substitute for.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const role = request.authContext?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
