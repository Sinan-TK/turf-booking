import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AdminAuditController, OwnerAuditController } from './audit.controller';

@Global()
@Module({
  controllers: [AdminAuditController, OwnerAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
