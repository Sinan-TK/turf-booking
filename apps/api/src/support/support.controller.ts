import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupportService } from './support.service';
import { CreateTicketDto, ReplyTicketDto, UpdateTicketDto } from './dto/support.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller('me/support-tickets')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentUser() actor: AuthContext) {
    return this.support.createTicket(dto, actor);
  }

  @Get()
  list(@CurrentUser() actor: AuthContext) {
    return this.support.listForCustomer(actor);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthContext) {
    return this.support.getForCustomer(id, actor);
  }
}

@Controller('admin/support-tickets')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.support.listForAdmin({ status, limit: limit ? Number(limit) : undefined });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.support.getForAdmin(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.support.updateForAdmin(id, dto);
  }

  @Post(':id/messages')
  reply(@Param('id') id: string, @Body() dto: ReplyTicketDto, @CurrentUser() actor: AuthContext) {
    return this.support.replyForAdmin(id, dto.body, actor);
  }
}
