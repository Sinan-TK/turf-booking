import { Global, Module } from '@nestjs/common';
import { OwnerScopeService } from './owner-scope.service';

@Global()
@Module({
  providers: [OwnerScopeService],
  exports: [OwnerScopeService],
})
export class OwnerScopeModule {}
