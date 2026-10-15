import { Module } from '@nestjs/common';
import { CoinsService } from './coins.service';
import { CoinsController } from './coins.controller';
import { COINS_REPOSITORY } from './coins.repository';
import { PrismaCoinsRepository } from './prisma-coins.repository';
import { WhatsAppClientModule } from '../whatsapp/whatsapp-client.module';

@Module({
  imports: [WhatsAppClientModule],
  controllers: [CoinsController],
  providers: [
    CoinsService,
    PrismaCoinsRepository,
    { provide: COINS_REPOSITORY, useClass: PrismaCoinsRepository },
  ],
  exports: [CoinsService, COINS_REPOSITORY],
})
export class CoinsModule {}
