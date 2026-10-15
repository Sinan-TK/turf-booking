import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '@venue/config';
import { maskPhone } from './whatsapp-logging.util';

export type WhatsAppMenuState =
  | { screen: 'MAIN_MENU' }
  | { screen: 'BOOK_VENUE_CHOICE' }
  | { screen: 'MY_BOOKINGS_LIST' }
  | { screen: 'MY_BOOKINGS_DETAIL'; bookingId: string }
  | { screen: 'PROFILE_MENU' }
  | { screen: 'HELP_MENU' }
  | { screen: 'HELP_RAISE_TICKET_CATEGORY' }
  | { screen: 'HELP_RAISE_TICKET_DESCRIPTION'; category: string }
  // A brand-new contact has no name yet, so the very first exchange asks
  // for it before anything else. Distinct from AWAITING_NAME_EDIT so a
  // customer typing e.g. "hi" as their reply, mid-onboarding, is still
  // taken as their name rather than short-circuited by the "hi" -> main
  // menu shortcut (handleInboundMessage checks the missing name before
  // that shortcut). `pendingBookIntent` carries the raw "Book: ..."
  // deep-link text through onboarding when a brand-new contact's very
  // first message is a "Book This Slot" tap from the public search page
  // (whatsapp-menu.service.ts's parseBookIntentText/handleNameCapture) —
  // otherwise that message would be consumed as their name and the
  // booking intent silently lost.
  | { screen: 'AWAITING_NAME_ONBOARDING'; pendingBookIntent?: string }
  | { screen: 'AWAITING_NAME_EDIT' }
  // Bot has shown availability + price for a "Book This Slot" deep link
  // and is waiting for a Yes/No tap before actually reserving the slot
  // (WhatsAppMenuService.handleBookIntent/handleBookSlotConfirm).
  | {
      screen: 'BOOK_SLOT_CONFIRM';
      resourceId: string;
      startTime: string;
      durationMinutes: number;
      facilityCode: string;
    };

const SESSION_TTL_SECONDS = 30 * 60; // conversation navigation state only — not a security boundary

/**
 * Conversation navigation state, keyed by WhatsApp number — deliberately
 * in Redis, not the database (ARCHITECTURE.md §15): this is "which menu
 * screen is this chat on," not business state. Losing it just means the
 * customer sees the main menu again, never a correctness issue.
 */
@Injectable()
export class WhatsAppSessionService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(WhatsAppSessionService.name);

  constructor() {
    const env = loadEnv();
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  private key(whatsappNumber: string): string {
    return `whatsapp:session:${whatsappNumber}`;
  }

  // Timing instrumented here rather than at each call site — get()/set()
  // are called from several places beyond handleInboundMessage's own
  // top-level lookup (nested menu handlers read/write session state
  // too), and instrumenting here catches all of them uniformly rather
  // than only the first call. Temporary — added to diagnose reported
  // "late WhatsApp reply" behavior in production.
  async get(whatsappNumber: string): Promise<WhatsAppMenuState> {
    const startedAt = Date.now();
    try {
      const raw = await this.redis.get(this.key(whatsappNumber));
      return raw ? (JSON.parse(raw) as WhatsAppMenuState) : { screen: 'MAIN_MENU' };
    } catch {
      // Redis unavailable — fail open to the main menu rather than
      // breaking the whole conversation over navigation state.
      return { screen: 'MAIN_MENU' };
    } finally {
      this.logger.log(`[WA] session get: ${Date.now() - startedAt}ms (customer: ${maskPhone(whatsappNumber)})`);
    }
  }

  async set(whatsappNumber: string, state: WhatsAppMenuState): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.redis.set(
        this.key(whatsappNumber),
        JSON.stringify(state),
        'EX',
        SESSION_TTL_SECONDS,
      );
    } catch {
      // Same fail-open reasoning as get().
    } finally {
      this.logger.log(`[WA] session set: ${Date.now() - startedAt}ms (customer: ${maskPhone(whatsappNumber)})`);
    }
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
