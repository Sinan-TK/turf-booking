import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CoinsService } from './coins.service';
import { AdminAdjustCoinsDto } from './dto/coins.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class CoinsController {
  constructor(private readonly coins: CoinsService) {}

  @Get('me/coins')
  @Roles(Role.CUSTOMER)
  getMyWallet(@CurrentUser() actor: AuthContext) {
    return this.coins.getWallet(actor.id);
  }

  @Get('me/coins/transactions')
  @Roles(Role.CUSTOMER)
  getMyTransactions(@CurrentUser() actor: AuthContext) {
    return this.coins.getTransactions(actor.id);
  }

  // The COINS half of the mutually-exclusive payment-method rule (§9) —
  // a wholly separate endpoint from /payments/create-order, never a
  // shared one that could accept a split amount.
  @Post('bookings/:id/pay-with-coins')
  @Roles(Role.CUSTOMER)
  payWithCoins(@Param('id') bookingId: string, @CurrentUser() actor: AuthContext) {
    return this.coins.redeemForBooking(bookingId, actor);
  }

  // Super Admin only — no Venue Owner endpoint exists anywhere that can
  // reach this (§12).
  @Post('admin/coins/adjust')
  @Roles(Role.SUPER_ADMIN)
  adminAdjust(@Body() dto: AdminAdjustCoinsDto, @CurrentUser() actor: AuthContext) {
    return this.coins.adminAdjust(dto.customerId, dto.signedAmount, dto.reason, actor);
  }
}
