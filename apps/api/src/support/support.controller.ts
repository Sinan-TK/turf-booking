import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import type { Response } from 'express';
import { parsePage, setTotalCount } from '../common/pagination';
import { parseEnumFilter, parseSearch } from '../common/list-filters';
import { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@venue/database';
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
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.support.getForCustomer(id, actor);
  }
}

@Controller('admin/support-tickets')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const page = parsePage(limit, offset);
    const filters = {
      status: parseEnumFilter(status, Object.values(SupportTicketStatus), 'status'),
      priority: parseEnumFilter(priority, Object.values(SupportTicketPriority), 'priority'),
      category: parseEnumFilter(category, Object.values(SupportTicketCategory), 'category'),
      search: parseSearch(search),
    };
    const [rows, total] = await Promise.all([
      this.support.listForAdmin({ ...filters, ...page }),
      this.support.countForAdmin(filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.getForAdmin(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.support.updateForAdmin(id, dto);
  }

  @Post(':id/messages')
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyTicketDto, @CurrentUser() actor: AuthContext) {
    return this.support.replyForAdmin(id, dto.body, actor);
  }
}
