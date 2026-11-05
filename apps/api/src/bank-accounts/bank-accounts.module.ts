import { Module } from '@nestjs/common';
import { AdminBankAccountController, OwnerBankAccountController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';

@Module({
  controllers: [OwnerBankAccountController, AdminBankAccountController],
  providers: [BankAccountsService],
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
