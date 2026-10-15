import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { VenueCategoriesService } from './venue-categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/venue-category.dto';

/** Public: customers and owners see active venue types only. */
@Controller('categories')
export class PublicCategoriesController {
  constructor(private readonly categories: VenueCategoriesService) {}

  @Get()
  list() {
    return this.categories.listPublic();
  }
}

/** Super Admin only — owners can pick a type but never define one. */
@Controller('admin/categories')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminCategoriesController {
  constructor(private readonly categories: VenueCategoriesService) {}

  @Get()
  list() {
    return this.categories.listAdmin();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.getAdmin(id);
  }

  @Post()
  create(@Body() dto: CreateCategoryDto, @CurrentUser() actor: AuthContext) {
    return this.categories.create(dto, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.categories.update(id, dto, actor);
  }

  @Post(':id/activate')
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.categories.setActive(id, true, actor);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.categories.setActive(id, false, actor);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.categories.remove(id, actor);
  }
}
