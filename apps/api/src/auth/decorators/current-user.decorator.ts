import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // AuthGuard always runs first and throws if authContext would be
    // missing, so this cast is safe for any handler that also has
    // @UseGuards(AuthGuard) — enforced by convention, not the type system.
    return request.authContext as AuthContext;
  },
);
