import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { parsePage, setTotalCount } from '../common/pagination';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CustomersService } from './customers.service';

// Read-only directory for the Super Admin Portal (§12) — customers are
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
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const page = parsePage(limit, offset);
    const [rows, total] = await Promise.all([
      this.customers.searchForAdmin(search, page),
      this.customers.countForAdmin(search),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.customers.getForAdmin(id);
  }
}
