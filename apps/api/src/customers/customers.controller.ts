import { Body, Controller, Get, Param, Patch, Query, Res, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import type { Response } from 'express';
import { parsePage, setTotalCount } from '../common/pagination';
import { parseEnumFilter, parseSearch } from '../common/list-filters';
import { CustomerStatus } from '@venue/database';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CustomersService } from './customers.service';

class SetCustomerStatusDto extends createZodDto(
  z.object({ status: z.enum(['ACTIVE', 'BLOCKED']), reason: z.string().max(500).optional() }),
) {}

// Directory for the Super Admin Portal (§12) — customers are
// created implicitly on first WhatsApp contact (CustomersService above);
// there's no admin "create customer" flow to guard against.
@Controller('admin/customers')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  async search(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const page = parsePage(limit, offset);
    const filters = {
      search: parseSearch(search),
      status: parseEnumFilter(status, Object.values(CustomerStatus), 'status'),
    };
    const [rows, total] = await Promise.all([
      this.customers.searchForAdmin(filters, page),
      this.customers.countForAdmin(filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.customers.getForAdmin(id);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetCustomerStatusDto, @CurrentUser() admin: AuthContext) {
    return this.customers.setStatusForAdmin(id, dto.status, dto.reason, admin);
  }
}
