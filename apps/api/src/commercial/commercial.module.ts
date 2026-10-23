import { Global, Module } from '@nestjs/common';
import { CommercialTermsService } from './commercial-terms.service';
import { AdminCommercialTermsController, OwnerCommercialTermsController } from './commercial-terms.controller';

/** Global: pricing, bookings, cancellation and settlement all read the resolved terms. */
@Global()
@Module({
  controllers: [AdminCommercialTermsController, OwnerCommercialTermsController],
  providers: [CommercialTermsService],
  exports: [CommercialTermsService],
})
export class CommercialModule {}
