import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AvailabilityService } from './availability.service';
import { SearchDto } from './dto/search.dto';
import { NEXT_CURSOR_HEADER } from './availability.service';

@Controller('search')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  /** The cards as a plain array; when more are waiting, X-Next-Cursor says where to continue. */
  async search(@Query() dto: SearchDto, @Res({ passthrough: true }) res: Response) {
    const { results, nextCursor } = await this.availability.searchPage(dto);
    if (nextCursor) res.setHeader(NEXT_CURSOR_HEADER, nextCursor);
    return results;
  }
}
