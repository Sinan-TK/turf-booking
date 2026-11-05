import { Module } from '@nestjs/common';
import { DeletedFilesController } from './deleted-files.controller';
import { DeletedFilesService } from './deleted-files.service';

@Module({
  controllers: [DeletedFilesController],
  providers: [DeletedFilesService],
})
export class DeletedFilesModule {}
