import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { loadEnv } from '@venue/config';
import { BookingSessionsService } from './booking-sessions.service';
import { CUSTOMER_SESSION_COOKIE_OPTIONS, CUSTOMER_SESSION_COOKIE } from '../auth/auth.constants';

// BookingSessions are minted only server-side, by the WhatsApp module
// when a customer taps "Book a Venue" (BookingSessionsService.start).
// There is deliberately no public route to start one: it would let
// anyone obtain a customer session for an arbitrary phone number.
@Controller('booking-sessions')
export class BookingSessionsController {
  constructor(private readonly bookingSessions: BookingSessionsService) {}

  // The web app's very first call when it opens /book/:token — resolves
  // the token AND authenticates the browser (sets the CustomerSession
  // cookie) in one round trip, so every following customer API call
  // (/search, /bookings/hold, /payments/*, /me/*) is already
  // credentialed.
  @Get(':token')
  async resolve(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const env = loadEnv();
    const { session, customerSessionToken } = await this.bookingSessions.resolveAndAuthenticate(token);
    res.cookie(CUSTOMER_SESSION_COOKIE, customerSessionToken, {
      ...CUSTOMER_SESSION_COOKIE_OPTIONS(),
      maxAge: env.CUSTOMER_SESSION_TTL_HOURS * 60 * 60 * 1000,
    });
    return { expiresAt: session.expiresAt };
  }
}
