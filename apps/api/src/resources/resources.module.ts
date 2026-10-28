import { Module } from '@nestjs/common';
import { ResourcesService } from './resources.service';
import { ResourcesController } from './resources.controller';
import { ResourcePhotosService } from './resource-photos.service';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [SchedulingModule],
  controllers: [ResourcesController],
  providers: [ResourcesService, ResourcePhotosService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
