import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import type { Response } from 'express';
import { parsePage, setTotalCount } from '../common/pagination';
import { parseDateRange, parseEnumFilter, parseSearch } from '../common/list-filters';
import { BookingStatus, PaymentMethod } from '@venue/database';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import { CancelBookingDto, CollectBalanceDto, CreateHoldDto, CreateOfflineBookingDto } from './dto/booking.dto';
import type { AuthContext } from '../auth/auth.types';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';

@Controller()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('bookings/hold')
  createHold(@Body() dto: CreateHoldDto, @CurrentUser() actor: AuthContext) {
    return this.bookings.createHold(dto, actor);
  }

  // P2 pooled-inventory read: remaining units + price for an explicit start time, no rows written.
  @Get('bookings/group-availability')
  previewGroupAvailability(
    @Query('resourceGroupId') resourceGroupId: string,
    @Query('startTime') startTime: string,
    @Query('durationMinutes') durationMinutes: string,
    @Query('quantity') quantity?: string,
  ) {
    if (!resourceGroupId || !startTime || !durationMinutes) {
      throw new BadRequestException('resourceGroupId, startTime, and durationMinutes are required');
    }
    const start = new Date(startTime);
    const duration = Number(durationMinutes);
    const qty = quantity === undefined ? 1 : Number(quantity);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('startTime must be valid');
    if (!Number.isInteger(duration) || duration <= 0) {
      throw new BadRequestException('durationMinutes must be a positive integer');
    }
    if (!Number.isInteger(qty) || qty < 1) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    return this.bookings.previewGroupSlot(resourceGroupId, start, duration, qty);
  }

  @Get('me/bookings')
  listMine(@CurrentUser() actor: AuthContext) {
    return this.bookings.listForCustomer(actor);
  }

  @Get('me/bookings/:id')
  getMine(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.bookings.getCheckoutViewForCustomer(id, actor);
  }

  // What cancelling would return now, and the cancellation deadlines as times.
  @Get('me/bookings/:id/cancellation')
  cancellationPreview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.bookings.cancellationPreview(id, actor);
  }

  @Post('me/bookings/:id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.bookings.cancel(id, dto.reason, actor);
  }
}

// Platform-wide visibility for the Super Admin Portal (§12) — a
// separate controller/class rather than another route on
// BookingsController above so the @Roles(Role.CUSTOMER) class-level
// guard there can stay simple instead of being overridden per-method.
@Controller('admin/bookings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('venueId') venueId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('search') search?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const page = parsePage(limit, offset);
    const filters = {
      status: parseEnumFilter(status, Object.values(BookingStatus), 'status'),
      venueId,
      organizationId,
      search: parseSearch(search),
      paymentMethod: parseEnumFilter(paymentMethod, Object.values(PaymentMethod), 'paymentMethod'),
      startRange: parseDateRange(from, to),
    };
    const [rows, total] = await Promise.all([
      this.bookings.listForAdmin({ ...filters, ...page }),
      this.bookings.countForAdmin(filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.getForAdmin(id);
  }

  // Cancels on the venue's behalf: everything paid online back as coins.
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBookingDto, @CurrentUser() actor: AuthContext) {
    return this.bookings.cancelByStaff(id, dto.reason, actor);
  }
}

@Controller('owner/bookings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
export class OwnerBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly scope: OwnerScopeService,
  ) {}

  @Get()
  async list(
    @CurrentUser() actor: AuthContext,
    @Query('status') status?: string,
    @Query('venueId') venueId?: string,
    @Query('search') search?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const page = parsePage(limit, offset);
    const filters = {
      // Always the caller's own organization, never a client-supplied one.
      organizationId: actor.organizationId!,
      // A staff member only ever sees the venues they are assigned to.
      ...(await this.scope.venueFilter(actor, venueId)),
      status: parseEnumFilter(status, Object.values(BookingStatus), 'status'),
      search: parseSearch(search),
      paymentMethod: parseEnumFilter(paymentMethod, Object.values(PaymentMethod), 'paymentMethod'),
      startRange: parseDateRange(from, to),
    };
    const [rows, total] = await Promise.all([
      this.bookings.listForAdmin({ ...filters, ...page }),
      this.bookings.countForAdmin(filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  // One venue's bookings (every status) for a day window [from, to), in start order: the staff day view.
  @Get('day')
  async day(
    @CurrentUser() actor: AuthContext,
    @Query('venueId') venueId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!venueId) throw new BadRequestException('venueId is required');
    if (!from || !to) throw new BadRequestException('from and to are required');
    await this.scope.assertVenue(actor, venueId);
    const rows = await this.bookings.listForAdmin({
      organizationId: actor.organizationId!,
      venueId,
      startRange: parseDateRange(from, to),
      limit: 200,
      offset: 0,
    });
    return [...rows].sort((x, y) => x.startTime.getTime() - y.startTime.getTime());
  }

  // Records a walk-in/offline booking directly as CONFIRMED — see
  // BookingsService.createOfflineBooking's doc comment.
  @Post()
  createOffline(@Body() dto: CreateOfflineBookingDto, @CurrentUser() actor: AuthContext) {
    return this.bookings.createOfflineBooking(dto, actor);
  }

  // The customer paid the rest at the venue: record it, so the booking shows nothing remaining.
  @Post(':id/collect')
  collect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CollectBalanceDto, @CurrentUser() actor: AuthContext) {
    return this.bookings.collectBalance(id, dto.amount, actor);
  }

  // Rain, closure, a double sale: the venue cancels (any time before it is played), everything paid online
  // back to the customer as coins. Owner admins and the staff assigned to the venue.
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBookingDto, @CurrentUser() actor: AuthContext) {
    return this.bookings.cancelByStaff(id, dto.reason, actor);
  }

  // The customer did not come (from the slot's start, for a week after it ends); nothing is refunded. Owner admins and assigned staff.
  @Post(':id/no-show')
  noShow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.bookings.markNoShow(id, actor);
  }

  // Takes a no-show back: the customer did come.
  @Post(':id/played')
  played(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.bookings.markPlayed(id, actor);
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    const booking = await this.bookings.getForOwner(id, actor.organizationId!);
    await this.scope.assertVenue(actor, booking.venue.id);
    return booking;
  }
}
