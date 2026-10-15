import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AdminPaymentsController, OwnerPaymentsController, PaymentsController } from './payments.controller';
import { RazorpayProvider } from './razorpay.provider';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { PAYMENTS_REPOSITORY } from './payments.repository';
import { PrismaPaymentsRepository } from './prisma-payments.repository';
import { CoinsModule } from '../coins/coins.module';
import { CustomerMessagingModule } from '../customer-messaging/customer-messaging.module';

@Module({
  imports: [CoinsModule, CustomerMessagingModule],
  controllers: [PaymentsController, AdminPaymentsController, OwnerPaymentsController],
  providers: [
    PaymentsService,
    RazorpayProvider,
    { provide: PAYMENT_PROVIDER, useClass: RazorpayProvider },
    PrismaPaymentsRepository,
    { provide: PAYMENTS_REPOSITORY, useClass: PrismaPaymentsRepository },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER, PAYMENTS_REPOSITORY],
})
export class PaymentsModule {}
