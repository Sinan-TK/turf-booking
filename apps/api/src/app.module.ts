import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LocationsModule } from './locations/locations.module';
import { VenuesModule } from './venues/venues.module';
import { VenueCategoriesModule } from './venue-categories/venue-categories.module';
import { OwnerOrganizationsModule } from './owner-organizations/owner-organizations.module';
import { ResourcesModule } from './resources/resources.module';
import { VenueConfigModule } from './venue-config/venue-config.module';
import { PoliciesModule } from './policies/policies.module';
import { CustomersModule } from './customers/customers.module';
import { SavedVenuesModule } from './saved-venues/saved-venues.module';
import { BookingSessionsModule } from './booking-sessions/booking-sessions.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { CoinsModule } from './coins/coins.module';
import { SupportModule } from './support/support.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { JobsModule } from './jobs/jobs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    LocationsModule,
    VenuesModule,
    VenueCategoriesModule,
    OwnerOrganizationsModule,
    ResourcesModule,
    VenueConfigModule,
    PoliciesModule,
    CustomersModule,
    SavedVenuesModule,
    BookingSessionsModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    CoinsModule,
    SupportModule,
    WhatsAppModule,
    JobsModule,
    DashboardModule,
    HealthModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModule {}
