import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { MAX_IMAGE_BYTES } from '../storage/image-type';
import { CreateBannerDto, UpdateBannerDto } from './banner.dto';
import { BannersService } from './banners.service';

/** Public: the banners on show right now. */
@Controller('banners')
export class PublicBannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  list() {
    return this.banners.listLive();
  }
}

/** Super Admin only. */
@Controller('admin/banners')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  list() {
    return this.banners.listAdmin();
  }

  @Post()
  create(@Body() dto: CreateBannerDto, @CurrentUser() actor: AuthContext) {
    return this.banners.create(dto, actor);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBannerDto, @CurrentUser() actor: AuthContext) {
    return this.banners.update(id, dto, actor);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.banners.remove(id, actor);
  }

  // multipart/form-data with the picture in a "file" field.
  @Post(':id/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  setImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.banners.setImage(id, file, actor);
  }

  @Delete(':id/image')
  removeImage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.banners.removeImage(id, actor);
  }
}
