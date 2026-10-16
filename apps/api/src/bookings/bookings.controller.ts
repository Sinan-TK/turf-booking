import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { parsePage, setTotalCount } from '../common/pagination';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import { CancelBookingDto, CreateHoldDto, CreateOfflineBookingDto } from './dto/booking.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('bookings/hold')
  createHold(@Body() dto: CreateHoldDto, @CurrentUser() actor: AuthContext) {
    return this.bookings.createHold(dto, actor);
  }

  // P2 pooled-inventory read mirroring the WhatsApp previewSlot flow:
  // remaining units + price for an explicit start time, no rows written.
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
  getMine(@Param('id') id: string, @CurrentUser() actor: AuthContext) {
    return this.bookings.getForCustomer(id, actor);
  }

  @Post('me/bookings/:id/cancel')
  cancel(
    @Param('id') id: string,
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
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const page = parsePage(limit, offset);
    const filters = { status, venueId, organizationId };
    const [rows, total] = await Promise.all([
      this.bookings.listForAdmin({ ...filters, ...page }),
      this.bookings.countForAdmin(filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.bookings.getForAdmin(id);
  }
}

@Controller('owner/bookings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
export class OwnerBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthContext,
    @Query('status') status?: string,
    @Query('venueId') venueId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bookings.listForOwner(actor.organizationId!, {
      status,
      venueId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Records a walk-in/offline booking directly as CONFIRMED — see
  // BookingsService.createOfflineBooking's doc comment.
  @Post()
  createOffline(@Body() dto: CreateOfflineBookingDto, @CurrentUser() actor: AuthContext) {
    return this.bookings.createOfflineBooking(dto, actor);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() actor: AuthContext) {
    return this.bookings.getForOwner(id, actor.organizationId!);
  }
}
