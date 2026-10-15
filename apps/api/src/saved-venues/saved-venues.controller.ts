import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SavedVenuesService } from './saved-venues.service';
import { SaveVenueDto } from './dto/saved-venue.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller('me/saved-venues')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class SavedVenuesController {
  constructor(private readonly savedVenues: SavedVenuesService) {}

  @Get()
  list(@CurrentUser() actor: AuthContext) {
    return this.savedVenues.list(actor.id);
  }

  @Post()
  save(@Body() dto: SaveVenueDto, @CurrentUser() actor: AuthContext) {
    return this.savedVenues.save(actor.id, dto.venueId);
  }

  @Delete(':venueId')
  async unsave(@Param('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    await this.savedVenues.unsave(actor.id, venueId);
    return { status: 'ok' };
  }
}
