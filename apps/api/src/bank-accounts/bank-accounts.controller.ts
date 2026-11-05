import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { BankAccountsService } from './bank-accounts.service';
import { FailBankAccountDto, SaveBankAccountDto } from './dto/bank-account.dto';

/** The owner admin's own business: read it (number masked) and change it with their password. */
@Controller('owner/bank-account')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
@OwnerRoles('OWNER_ADMIN')
export class OwnerBankAccountController {
  constructor(private readonly accounts: BankAccountsService) {}

  @Get()
  get(@CurrentUser() actor: AuthContext) {
    return this.accounts.getForOwner(actor);
  }

  @Put()
  save(@Body() dto: SaveBankAccountDto, @CurrentUser() actor: AuthContext) {
    return this.accounts.save(dto, actor);
  }
}

/** The Super Admin sees the full details and decides whether they are good. */
@Controller('admin/organizations/:id/bank-account')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminBankAccountController {
  constructor(private readonly accounts: BankAccountsService) {}

  @Get()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.getForAdmin(id);
  }

  @Post('verify')
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.accounts.verify(id, actor);
  }

  @Post('fail')
  fail(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FailBankAccountDto, @CurrentUser() actor: AuthContext) {
    return this.accounts.fail(id, dto.reason, actor);
  }
}
