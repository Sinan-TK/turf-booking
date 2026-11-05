import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { parsePage, setTotalCount } from '../common/pagination';
import { parseEnumFilter, parseSearch } from '../common/list-filters';
import { DeletedFilesService, type DeletedFileStatus } from './deleted-files.service';

const markRemovedSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
class MarkRemovedDto extends createZodDto(markRemovedSchema) {}

const checkSchema = z.object({ recheckRemoved: z.boolean().optional() });
class CheckDto extends createZodDto(checkSchema) {}

/**
 * The Super Admin's list of files the app stopped using. The bucket's key cannot delete, so they are deleted there by hand: this list shows
 * what is left, hands over the keys, finds the ones already gone and marks them.
 */
@Controller('admin/deleted-files')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class DeletedFilesController {
  constructor(private readonly files: DeletedFilesService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const filter = (parseEnumFilter(status, ['waiting', 'removed', 'all'], 'status') as DeletedFileStatus | undefined) ?? 'waiting';
    const q = parseSearch(search);
    const [rows, total] = await Promise.all([this.files.list({ status: filter, q, ...parsePage(limit, offset) }), this.files.count(filter, q)]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get('summary')
  summary() {
    return this.files.summary();
  }

  /** Plain text, one key per line: the files still waiting. */
  @Get('export')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  exportWaiting() {
    return this.files.exportWaiting();
  }

  @Post('check')
  @HttpCode(200)
  check(@CurrentUser() actor: AuthContext, @Body() dto: CheckDto) {
    return this.files.check(actor, { recheckRemoved: dto?.recheckRemoved });
  }

  /** Deletes the history of files already confirmed gone. */
  @Delete('removed')
  clearRemoved(@CurrentUser() actor: AuthContext) {
    return this.files.clearRemoved(actor);
  }

  @Post('mark-removed')
  @HttpCode(200)
  markRemoved(@Body() dto: MarkRemovedDto, @CurrentUser() actor: AuthContext) {
    return this.files.markRemoved(dto.ids, actor);
  }

  @Post(':id/removed')
  @HttpCode(200)
  markOneRemoved(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.files.markRemoved([id], actor);
  }
}
