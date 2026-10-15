import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PoliciesService } from './policies.service';
import { CreateCancellationPolicyDto, CreateCommissionDto } from './dto/policy.dto';

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Post('cancellation-policies')
  createCancellationPolicy(@Body() dto: CreateCancellationPolicyDto) {
    return this.policies.createCancellationPolicy(dto);
  }

  @Get('cancellation-policies/resolve/:venueId')
  resolveCancellationPolicy(@Param('venueId') venueId: string) {
    return this.policies.resolveCancellationPolicy(venueId);
  }

  @Post('commissions')
  createCommission(@Body() dto: CreateCommissionDto) {
    return this.policies.createCommission(dto);
  }

  @Get('commissions/resolve/:organizationId')
  resolveCommission(@Param('organizationId') organizationId: string) {
    return this.policies.resolveCommission(organizationId);
  }
}
