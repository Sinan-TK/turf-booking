import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AdminAuditController } from './audit.controller';

@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
