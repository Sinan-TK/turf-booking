import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
  search(@Query('search') search?: string, @Query('limit') limit?: string) {
    return this.customers.searchForAdmin(search, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.customers.getForAdmin(id);
  }
}
