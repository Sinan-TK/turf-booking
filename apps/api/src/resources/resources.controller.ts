import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ResourcesService } from './resources.service';
import { MAX_PHOTO_BYTES, ResourcePhotosService } from './resource-photos.service';
import {
  CreateCompositionDto,
  CreateResourceDto,
  CreateResourceGroupDto,
  SetFacilityBookableDto,
  ReorderPhotosDto,
  SetResourceBookableDto,
  SetResourceDurationsDto,
} from './dto/resource.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller('resources')
@UseGuards(AuthGuard, RolesGuard)
// Units are the owner admin's to manage; staff may only read the units of their assigned venues.
@OwnerRoles('OWNER_ADMIN')
export class ResourcesController {
  constructor(
    private readonly resources: ResourcesService,
    private readonly photos: ResourcePhotosService,
  ) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  create(@Body() dto: CreateResourceDto, @CurrentUser() actor: AuthContext) {
    return this.resources.create(dto, actor);
  }

  // Declared before ':id' so "facility-bookable" is never read as an id.
  @Patch('facility-bookable')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  setFacilityBookable(@Body() dto: SetFacilityBookableDto, @CurrentUser() actor: AuthContext) {
    return this.resources.setFacilityBookable(dto, actor);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  setBookable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetResourceBookableDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.resources.setBookable(id, dto.isBookable, actor);
  }

  @Patch(':id/durations')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  setDurations(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetResourceDurationsDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.resources.setDurations(id, dto, actor);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  @OwnerRoles('OWNER_ADMIN', 'OWNER_STAFF')
  list(@Query('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    return this.resources.listForVenue(venueId, actor);
  }

  @Post('compositions')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  addComposition(@Body() dto: CreateCompositionDto, @CurrentUser() actor: AuthContext) {
    return this.resources.addComposition(dto, actor);
  }

  // P2 pooled inventory pools (kayak fleets) — same owner/admin-only
  // guard as resources; customers only ever see resolved availability
  // via the booking-hold price snapshot and group-availability read.
  @Post('groups')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  createGroup(@Body() dto: CreateResourceGroupDto, @CurrentUser() actor: AuthContext) {
    return this.resources.createGroup(dto, actor);
  }

  @Get('groups')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  @OwnerRoles('OWNER_ADMIN', 'OWNER_STAFF')
  listGroups(@Query('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    return this.resources.listGroupsForVenue(venueId, actor);
  }

  // Photos of one unit (at most three; the first is the main one on the customer's card).
  @Get(':id/photos')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  @OwnerRoles('OWNER_ADMIN', 'OWNER_STAFF')
  listPhotos(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.photos.list(id, actor);
  }

  // multipart/form-data with the image in a "file" field. Answers with the unit's photos as they now are.
  @Post(':id/photos')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  addPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.photos.add(id, file, actor);
  }

  @Put(':id/photos/order')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  reorderPhotos(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderPhotosDto, @CurrentUser() actor: AuthContext) {
    return this.photos.reorder(id, dto.photoIds, actor);
  }

  @Delete(':id/photos/:photoId')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  removePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.photos.remove(id, photoId, actor);
  }
}
