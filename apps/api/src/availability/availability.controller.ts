import { Controller, Get, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { SearchDto } from './dto/search.dto';

@Controller('search')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  search(@Query() dto: SearchDto) {
    return this.availability.search(dto);
  }
}
