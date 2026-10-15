import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { loadEnv } from '@venue/config';
import { WhatsAppClientService } from './whatsapp-client.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import type { WhatsAppMenuState } from './whatsapp-session.service';
import { CustomersService } from '../customers/customers.service';
import { BookingSessionsService } from '../booking-sessions/booking-sessions.service';
import { BookingsService } from '../bookings/bookings.service';
import { PoliciesService } from '../policies/policies.service';
import { SupportService } from '../support/support.service';
import { SavedVenuesService } from '../saved-venues/saved-venues.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@venue/shared';
import type { AuthContext } from '../auth/auth.types';
import { maskPhone } from './whatsapp-logging.util';
import { createHoldSchema } from '../bookings/dto/booking.dto';

export type InboundMessage =
  { kind: 'text'; text: string } | { kind: 'interactive_reply'; id: string; title: string };

/**
 * The exact text format the public search page (apps/web/app/page.tsx)
 * builds for its "Book This Slot" wa.me deep link — machine-generated, not
 * hand-typed, so a strict format is fine; a customer who edits it before
 * hitting send just gets treated as a normal free-text message instead
 * (parseBookIntentText returns null, no special handling kicks in).
 */
const BOOK_INTENT_PATTERN =
  /^Book:\s*(\S+)\s*\|\s*Resource:\s*([0-9a-f-]{36})\s*\|\s*(\S+)\s*\|\s*(\d+)min$/i;

interface BookIntent {
  facilityCode: string;
  resourceId: string;
  startTime: string;
  durationMinutes: number;
}

/** `iso` is a UTC instant; formatted in the venue's own local timezone so
 * "6 PM" means the venue's 6 PM, not the server's. */
function formatLocalDateTime(iso: string, venueTimezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(venueTimezone).toFormat('EEE d MMM, h:mm a');
}

function parseBookIntentText(text: string): BookIntent | null {
  const match = BOOK_INTENT_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, facilityCode, resourceId, startTime, durationStr] = match;
  const durationMinutes = Number(durationStr);
  // Re-validated here regardless — this text came from a customer's phone,
  // not a trusted server, exactly like any other inbound WhatsApp message.
  const parsed = createHoldSchema.safeParse({ resourceId, startTime, durationMinutes });
  if (!parsed.success) return null;
  return { facilityCode, resourceId, startTime, durationMinutes };
}

const TICKET_CATEGORIES = [
  { id: 'REFUND_ISSUE', title: '💰 Refund Issue' },
  { id: 'PAID_BUT_BOOKING_FAILED', title: '💳 Paid but Booking Failed' },
  { id: 'BOOKING_ISSUE', title: '📅 Booking Issue' },
  { id: 'ACCOUNT_PROFILE_ISSUE', title: '👤 Account/Profile Issue' },
  { id: 'OTHER', title: '❓ Other' },
];

/**
 * The main menu state machine (ARCHITECTURE.md §15). Deliberately thin —
 * this module contains presentation/routing only, never booking/payment/
 * coin logic itself, all of which it delegates to the same services the
 * web app's API calls (BookingsService, PoliciesService, etc.). "Book a
 * Venue" hands off to the web app immediately rather than building the
 * booking flow inside WhatsApp, per the brief's explicit instruction.
 */
@Injectable()
export class WhatsAppMenuService {
  private readonly logger = new Logger(WhatsAppMenuService.name);

  constructor(
    private readonly client: WhatsAppClientService,
    private readonly sessions: WhatsAppSessionService,
    private readonly customers: CustomersService,
    private readonly bookingSessions: BookingSessionsService,
    private readonly bookings: BookingsService,
    private readonly policies: PoliciesService,
    private readonly support: SupportService,
    private readonly savedVenues: SavedVenuesService,
    private readonly prisma: PrismaService,
  ) {}

  async handleInboundMessage(whatsappNumber: string, message: InboundMessage): Promise<void> {
    // Timing instrumentation (temporary — added to diagnose reported
    // "late WhatsApp reply" behavior in production; safe to remove once
    // the real bottleneck is confirmed from these numbers). maskPhone()
    // keeps only the last 4 digits so logs never carry a full phone
    // number, while still letting every [WA] line for one exchange be
    // correlated by eye.
    const id = maskPhone(whatsappNumber);
    const startedAt = Date.now();
    this.logger.log(`[WA] inbound received (customer: ${id}, kind: ${message.kind})`);

    // Customer lookup and session read are independent of each other —
    // run them concurrently rather than one after the other (previously
    // sequential awaits). Each is timed individually, not just as a
    // combined pair, so a slow customer lookup and a slow session read
    // are distinguishable in the logs even though they now overlap in
    // wall-clock time. Session state is needed in every branch below
    // regardless of outcome, not just the "returning customer,
    // mid-navigation" one, so this also removes what used to be a
    // second, later sessions.get() call.
    const customerLookupStartedAt = Date.now();
    const customerPromise = this.customers.findOrCreateByWhatsAppNumber(whatsappNumber).then((c) => {
      this.logger.log(`[WA] customer lookup: ${Date.now() - customerLookupStartedAt}ms (customer: ${id})`);
      return c;
    });
    // sessions.get() logs its own "[WA] session get: Xms" line (see
    // WhatsAppSessionService) — instrumented there instead of here so
    // every call site is covered, not just this first one.
    const sessionPromise = this.sessions.get(whatsappNumber);
    const [customer, state] = await Promise.all([customerPromise, sessionPromise]);
    const actor: AuthContext = { role: Role.CUSTOMER, id: customer.id };

    // A brand-new (or not-yet-named) contact is asked for their name
    // before anything else — even before the "hi" shortcut below, so
    // their very first "hi" doesn't skip straight past onboarding. Once
    // they're mid-onboarding (session already parked on
    // AWAITING_NAME_ONBOARDING), their next message is taken as the
    // name itself, whatever it says.
    if (!customer.name) {
      if (state.screen === 'AWAITING_NAME_ONBOARDING') {
        return this.handleNameCapture(whatsappNumber, message, customer.id, {
          onboarding: true,
          pendingBookIntent: state.pendingBookIntent,
        });
      }
      // A brand-new contact's very first message can be a "Book This
      // Slot" deep link from the public search page — carried through
      // onboarding via session state (see WhatsAppMenuState's doc
      // comment) rather than lost as if it were their name.
      const pendingBookIntent =
        message.kind === 'text' && parseBookIntentText(message.text) ? message.text : undefined;
      await this.sessions.set(whatsappNumber, { screen: 'AWAITING_NAME_ONBOARDING', pendingBookIntent });
      await this.client.sendText(whatsappNumber, "👋 Welcome to Venue Booking! What's your name?");
      return;
    }

    if (message.kind === 'text') {
      const intent = parseBookIntentText(message.text);
      if (intent) {
        return this.handleBookIntent(whatsappNumber, intent);
      }
    }

    if (message.kind === 'text' && /^(hi|hello|hey|menu|start)$/i.test(message.text.trim())) {
      await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
      return this.sendMainMenu(whatsappNumber, customer.name);
    }

    const menuLogicStartedAt = Date.now();
    try {
      await this.dispatchMenuState(whatsappNumber, message, actor, customer, state);
    } catch (error) {
      this.logger.error(`Menu handling failed for ${whatsappNumber}: ${(error as Error).message}`);
      await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
      await this.client.sendText(
        whatsappNumber,
        "Sorry, something went wrong. Let's start over — send 'Hi' to see the menu.",
      );
    } finally {
      // "menu logic" includes whatever session.set()/client.send() calls
      // happen inside the branch itself (e.g. sendMainMenu ends in a
      // Graph API call) — those already have their own [WA] session
      // set / Graph API log lines, so the breakdown is still visible;
      // this is just the outer bound for that branch as a whole.
      this.logger.log(`[WA] menu logic: ${Date.now() - menuLogicStartedAt}ms (customer: ${id}, screen: ${state.screen})`);
      this.logger.log(`[WA] handleInboundMessage total: ${Date.now() - startedAt}ms (customer: ${id})`);
    }
  }

  /** The screen-dispatch switch, extracted out of handleInboundMessage
   * only so its total execution time can be bracketed for the
   * "[WA] menu logic" timing log without disturbing each case's own
   * early-return shape. */
  private async dispatchMenuState(
    whatsappNumber: string,
    message: InboundMessage,
    actor: AuthContext,
    customer: { id: string; name: string | null },
    state: WhatsAppMenuState,
  ): Promise<void> {
    switch (state.screen) {
      case 'MAIN_MENU':
        return await this.handleMainMenu(whatsappNumber, message, actor);
      case 'BOOK_VENUE_CHOICE':
        return await this.handleBookVenueChoice(whatsappNumber, message, actor);
      case 'BOOK_SLOT_CONFIRM':
        return await this.handleBookSlotConfirm(whatsappNumber, message, actor, state);
      case 'MY_BOOKINGS_LIST':
        return await this.handleMyBookingsList(whatsappNumber, message);
      case 'MY_BOOKINGS_DETAIL':
        return await this.handleMyBookingsDetail(whatsappNumber, message, state.bookingId, actor);
      case 'PROFILE_MENU':
        return await this.handleProfileMenu(whatsappNumber, message, actor);
      case 'AWAITING_NAME_EDIT':
        return await this.handleNameCapture(whatsappNumber, message, customer.id, {
          onboarding: false,
        });
      case 'HELP_MENU':
        return await this.handleHelpMenu(whatsappNumber, message);
      case 'HELP_RAISE_TICKET_CATEGORY':
        return await this.handleTicketCategory(whatsappNumber, message);
      case 'HELP_RAISE_TICKET_DESCRIPTION':
        return await this.handleTicketDescription(whatsappNumber, message, state.category, actor);
      default:
        await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
        return await this.sendMainMenu(whatsappNumber, customer.name);
    }
  }

  /** Re-fetches the current name and shows the main menu — used at every
   * "back to the top" transition so a returning customer, not just a
   * first-time one, gets "Welcome back, <name>" instead of the generic
   * greeting. */
  private async sendMainMenuFor(whatsappNumber: string, customerId: string): Promise<void> {
    const customer = await this.prisma.client.customerProfile.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
    return this.sendMainMenu(whatsappNumber, customer?.name ?? null);
  }

  private async sendMainMenu(whatsappNumber: string, name: string | null): Promise<void> {
    const greeting = name ? `👋 Welcome back, ${name}!` : '👋 Welcome to Venue Booking!';
    await this.client.sendInteractiveButtons(
      whatsappNumber,
      `${greeting}\n\nWhat would you like to do?`,
      [
        { id: 'MENU_BOOK', title: '⚽ Book a Venue' },
        { id: 'MENU_MY_BOOKINGS', title: '📋 My Bookings' },
        { id: 'MENU_PROFILE', title: '👤 Profile' },
      ],
    );
    // WhatsApp interactive buttons cap at 3 — Help sent as a follow-up
    // text rather than forced into the same message.
    await this.client.sendText(whatsappNumber, "Or type 'help' for 🆘 Help.");
  }

  private async handleMainMenu(
    whatsappNumber: string,
    message: InboundMessage,
    actor: AuthContext,
  ): Promise<void> {
    const selection =
      message.kind === 'interactive_reply' ? message.id : message.text.trim().toLowerCase();

    if (selection === 'MENU_BOOK') {
      return this.startBookVenueFlow(whatsappNumber, actor.id);
    }

    if (selection === 'MENU_MY_BOOKINGS') {
      return this.showMyBookingsList(whatsappNumber, actor);
    }

    if (selection === 'MENU_PROFILE') {
      return this.sendProfileMenu(whatsappNumber, actor.id);
    }

    if (selection === 'help') {
      return this.showHelpMenu(whatsappNumber);
    }

    return this.sendMainMenuFor(whatsappNumber, actor.id);
  }

  /**
   * "Book a Venue" entry point. A customer with saved venues (⭐, from
   * either the WhatsApp booking-detail screen or the web app's search
   * results) gets them offered as a shortcut ahead of a fresh search —
   * one with none saved sees exactly the same plain link as before this
   * feature existed.
   */
  private async startBookVenueFlow(whatsappNumber: string, customerId: string): Promise<void> {
    const saved = await this.savedVenues.list(customerId);
    if (saved.length === 0) {
      return this.sendBookingLink(whatsappNumber);
    }

    // WhatsApp interactive lists cap at 10 rows total — reserve one for
    // "Search All Venues" and show at most the 9 most recently saved.
    const rows = saved.slice(0, 9).map((venue) => ({
      id: `BOOK_SAVED_${venue.id}`,
      // WhatsApp truncates/rejects titles over 24 chars and row
      // descriptions over 72 — trimmed defensively rather than trusting
      // every venue name to fit.
      title: venue.name.slice(0, 24),
      description: `${venue.facilityCode} · ${venue.address}`.slice(0, 72),
    }));
    rows.push({ id: 'BOOK_SEARCH_ALL', title: '🔍 Search All Venues', description: '' });

    await this.client.sendInteractiveList(
      whatsappNumber,
      '⭐ Book one of your saved venues, or search all venues.',
      'Choose',
      rows,
    );
    await this.sessions.set(whatsappNumber, { screen: 'BOOK_VENUE_CHOICE' });
  }

  private async handleBookVenueChoice(
    whatsappNumber: string,
    message: InboundMessage,
    actor: AuthContext,
  ): Promise<void> {
    if (message.kind !== 'interactive_reply') {
      await this.client.sendText(whatsappNumber, 'Please tap an option from the list above.');
      return;
    }

    if (message.id === 'BOOK_SEARCH_ALL') {
      return this.sendBookingLink(whatsappNumber);
    }

    if (message.id.startsWith('BOOK_SAVED_')) {
      const venueId = message.id.replace('BOOK_SAVED_', '');
      const venue = await this.prisma.client.venue.findUnique({ where: { id: venueId } });
      if (!venue) {
        await this.client.sendText(whatsappNumber, 'That saved venue could not be found.');
        return this.sendMainMenuFor(whatsappNumber, actor.id);
      }
      return this.sendBookingLink(whatsappNumber, venue.facilityCode);
    }

    await this.client.sendText(whatsappNumber, 'Please tap an option from the list above.');
  }

  /** Mints a fresh BookingSession and sends its link — with
   * `facilityCode` pre-filled (via the same query param the web app's
   * own search already supports) when booking a specific saved venue, or
   * plain when searching from scratch. Always returns the customer to
   * MAIN_MENU: the 20-minute booking session/link itself is the next
   * step, not another WhatsApp menu screen. */
  private async sendBookingLink(whatsappNumber: string, facilityCode?: string): Promise<void> {
    const env = loadEnv();
    const session = await this.bookingSessions.start(whatsappNumber, 'WHATSAPP');
    const link = facilityCode
      ? `${env.WEB_APP_URL}/book/${session.bookingSessionToken}?facilityCode=${encodeURIComponent(facilityCode)}`
      : `${env.WEB_APP_URL}/book/${session.bookingSessionToken}`;
    await this.client.sendText(
      whatsappNumber,
      `Great! Tap below to find and book a venue. This link is valid for 20 minutes:\n\n${link}`,
    );
    await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
  }

  /**
   * Entry point for the public search page's "Book This Slot" wa.me deep
   * link (parseBookIntentText). Deliberately a plain availability+price
   * PREVIEW (BookingsService.previewSlot) rather than reserving the slot
   * immediately — the slot is only actually held (BookingsService.
   * createHold) once the customer taps Yes in handleBookSlotConfirm, so a
   * customer who backs out never leaves behind an orphaned
   * PENDING_PAYMENT booking.
   */
  private async handleBookIntent(whatsappNumber: string, intent: BookIntent): Promise<void> {
    const preview = await this.bookings.previewSlot(
      intent.resourceId,
      new Date(intent.startTime),
      intent.durationMinutes,
    );
    if (!preview.available || preview.venue.facilityCode !== intent.facilityCode) {
      await this.client.sendText(
        whatsappNumber,
        "Sorry, that slot isn't available anymore. Let's find you another one.",
      );
      return this.sendBookingLink(whatsappNumber);
    }

    const hours = intent.durationMinutes / 60;
    const priceLine = preview.price ? `\n💰 ${preview.price.currency} ${preview.price.amount}` : '';
    await this.client.sendInteractiveButtons(
      whatsappNumber,
      `🏟️ ${preview.venue.name} (${preview.resource.name})\n🗓️ ${formatLocalDateTime(intent.startTime, preview.venue.timezone)}\n⏱️ ${hours} hour${hours === 1 ? '' : 's'}${priceLine}\n\nThis slot is available! Shall I generate a payment link?`,
      [
        { id: 'BOOK_CONFIRM_YES', title: '✅ Yes, book it' },
        { id: 'BOOK_CONFIRM_NO', title: '❌ No' },
      ],
    );
    await this.sessions.set(whatsappNumber, {
      screen: 'BOOK_SLOT_CONFIRM',
      resourceId: intent.resourceId,
      startTime: intent.startTime,
      durationMinutes: intent.durationMinutes,
      facilityCode: intent.facilityCode,
    });
  }

  /** Yes/No response to handleBookIntent's availability preview. Only
   * "Yes" actually reserves the slot (BookingsService.createHold) — the
   * same atomic ResourceLock exclusion-constraint machinery every other
   * booking path goes through, so a slot taken by someone else between
   * the preview and this confirmation still surfaces here as a clean
   * "no longer available," not a double-booking. */
  private async handleBookSlotConfirm(
    whatsappNumber: string,
    message: InboundMessage,
    actor: AuthContext,
    state: Extract<WhatsAppMenuState, { screen: 'BOOK_SLOT_CONFIRM' }>,
  ): Promise<void> {
    if (message.kind !== 'interactive_reply' || !['BOOK_CONFIRM_YES', 'BOOK_CONFIRM_NO'].includes(message.id)) {
      await this.client.sendText(whatsappNumber, 'Please tap Yes or No above.');
      return;
    }

    if (message.id === 'BOOK_CONFIRM_NO') {
      await this.client.sendText(whatsappNumber, "No worries! Send 'hi' any time to book something else.");
      return this.sendMainMenuFor(whatsappNumber, actor.id);
    }

    let booking;
    try {
      booking = await this.bookings.createHold(
        {
          resourceId: state.resourceId,
          startTime: state.startTime,
          durationMinutes: state.durationMinutes,
        },
        actor,
      );
    } catch {
      await this.client.sendText(
        whatsappNumber,
        'Sorry, that slot was just taken by someone else. Let\'s find you another one.',
      );
      return this.sendBookingLink(whatsappNumber, state.facilityCode);
    }

    const env = loadEnv();
    const session = await this.bookingSessions.start(whatsappNumber, 'WHATSAPP');
    const link = `${env.WEB_APP_URL}/book/${session.bookingSessionToken}?bookingId=${booking.id}`;
    await this.client.sendText(
      whatsappNumber,
      `✅ Slot held for you! Tap below to complete payment — this link is valid for 20 minutes:\n\n${link}`,
    );
    await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
  }

  private async sendProfileMenu(whatsappNumber: string, customerId: string): Promise<void> {
    const customer = await this.prisma.client.customerProfile.findUnique({
      where: { id: customerId },
    });
    await this.client.sendText(
      whatsappNumber,
      `👤 Profile\n\nName: ${customer?.name ?? '(not set)'}\nPhone: ${whatsappNumber}\nEmail: ${customer?.email ?? '(not set)'}`,
    );
    await this.client.sendInteractiveButtons(whatsappNumber, 'What would you like to do?', [
      { id: 'EDIT_NAME', title: '✏️ Edit Name' },
      { id: 'ACTION_BACK', title: '⬅️ Back to Menu' },
    ]);
    await this.sessions.set(whatsappNumber, { screen: 'PROFILE_MENU' });
  }

  private async handleProfileMenu(
    whatsappNumber: string,
    message: InboundMessage,
    actor: AuthContext,
  ): Promise<void> {
    const selection = message.kind === 'interactive_reply' ? message.id : '';

    if (selection === 'EDIT_NAME') {
      await this.sessions.set(whatsappNumber, { screen: 'AWAITING_NAME_EDIT' });
      await this.client.sendText(whatsappNumber, 'What would you like your name to be?');
      return;
    }

    // ACTION_BACK, or anything unrecognized — back to the main menu
    // rather than re-showing the profile on every stray reply.
    const customer = await this.prisma.client.customerProfile.findUnique({
      where: { id: actor.id },
      select: { name: true },
    });
    await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
    return this.sendMainMenu(whatsappNumber, customer?.name ?? null);
  }

  /**
   * Shared by first-contact onboarding and the Profile "Edit Name" flow —
   * both are "capture the next text message as the name," differing only
   * in what greeting/next screen follows.
   */
  private async handleNameCapture(
    whatsappNumber: string,
    message: InboundMessage,
    customerId: string,
    opts: { onboarding: boolean; pendingBookIntent?: string },
  ): Promise<void> {
    if (message.kind !== 'text' || message.text.trim().length === 0) {
      await this.client.sendText(whatsappNumber, 'Please reply with your name as text.');
      return;
    }
    const name = message.text.trim().slice(0, 100);
    await this.customers.updateName(customerId, name);

    if (opts.onboarding) {
      await this.client.sendText(whatsappNumber, `Nice to meet you, ${name}! 🎉`);
      const intent = opts.pendingBookIntent ? parseBookIntentText(opts.pendingBookIntent) : null;
      if (intent) {
        return this.handleBookIntent(whatsappNumber, intent);
      }
      await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
      return this.sendMainMenu(whatsappNumber, name);
    }

    await this.client.sendText(whatsappNumber, `✅ Name updated to ${name}.`);
    return this.sendProfileMenu(whatsappNumber, customerId);
  }

  private async showMyBookingsList(whatsappNumber: string, actor: AuthContext): Promise<void> {
    const allBookings = await this.bookings.listForCustomer(actor);
    const upcoming = allBookings
      .filter((b) => b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT')
      .slice(0, 10);

    if (upcoming.length === 0) {
      await this.client.sendText(whatsappNumber, "You don't have any upcoming bookings yet.");
      return this.sendMainMenuFor(whatsappNumber, actor.id);
    }

    await this.client.sendInteractiveList(
      whatsappNumber,
      '📋 Your upcoming bookings — tap one to view details.',
      'View Bookings',
      upcoming.map((b) => ({
        id: `BOOKING_${b.id}`,
        title: b.orderId,
        description: `${b.groundType} · ${b.startTime.toISOString().slice(0, 16).replace('T', ' ')}`,
      })),
    );
    await this.sessions.set(whatsappNumber, { screen: 'MY_BOOKINGS_LIST' });
  }

  private async handleMyBookingsList(
    whatsappNumber: string,
    message: InboundMessage,
  ): Promise<void> {
    if (message.kind !== 'interactive_reply' || !message.id.startsWith('BOOKING_')) {
      await this.client.sendText(whatsappNumber, 'Please tap a booking from the list above.');
      return;
    }
    const bookingId = message.id.replace('BOOKING_', '');
    const booking = await this.prisma.client.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      await this.client.sendText(whatsappNumber, 'That booking could not be found.');
      await this.sessions.set(whatsappNumber, { screen: 'MAIN_MENU' });
      return;
    }

    const venue = await this.prisma.client.venue.findUnique({ where: { id: booking.venueId } });
    const details = [
      `🏟️ ${venue?.name ?? ''} (${venue?.facilityCode ?? ''})`,
      `⚽ ${booking.groundType}`,
      `📅 ${booking.startTime.toISOString().slice(0, 16).replace('T', ' ')}`,
      `🆔 Order ID: ${booking.orderId}`,
      `💳 Payment: ${booking.paymentMethod ?? 'PENDING'}`,
      `💰 Amount: ${booking.currency} ${booking.amount}`,
      `📌 Status: ${booking.status}`,
    ].join('\n');

    if (booking.status === 'CONFIRMED' || booking.status === 'PENDING_PAYMENT') {
      // WhatsApp interactive buttons cap at 3 — Cancel/Back already used
      // both slots before Save existed; still fits exactly.
      await this.client.sendInteractiveButtons(whatsappNumber, details, [
        { id: 'ACTION_CANCEL', title: '❌ Cancel Booking' },
        { id: 'ACTION_SAVE_VENUE', title: '⭐ Save Venue' },
        { id: 'ACTION_BACK', title: '⬅️ Back' },
      ]);
    } else {
      // A past/cancelled booking can't be cancelled again, but saving
      // the venue for next time is still useful — buttons instead of
      // plain text here too.
      await this.client.sendInteractiveButtons(whatsappNumber, details, [
        { id: 'ACTION_SAVE_VENUE', title: '⭐ Save Venue' },
        { id: 'ACTION_BACK', title: '⬅️ Back' },
      ]);
    }
    await this.sessions.set(whatsappNumber, { screen: 'MY_BOOKINGS_DETAIL', bookingId });
  }

  private async handleMyBookingsDetail(
    whatsappNumber: string,
    message: InboundMessage,
    bookingId: string,
    actor: AuthContext,
  ): Promise<void> {
    const selection = message.kind === 'interactive_reply' ? message.id : '';

    if (selection === 'ACTION_BACK') {
      return this.showMyBookingsList(whatsappNumber, actor);
    }

    if (selection === 'ACTION_SAVE_VENUE') {
      const booking = await this.prisma.client.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      await this.savedVenues.save(actor.id, booking.venueId);
      await this.client.sendText(whatsappNumber, "⭐ Saved! You'll see this venue as a shortcut next time you tap 'Book a Venue'.");
      return;
    }

    if (selection === 'ACTION_CANCEL') {
      const booking = await this.prisma.client.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      if (booking.status === 'CONFIRMED') {
        const policy = await this.policies.resolveCancellationPolicy(booking.venueId);
        const hoursBeforeStart = (booking.startTime.getTime() - Date.now()) / (1000 * 60 * 60);
        const tiers = policy.tiers as Array<{ minHoursBeforeStart: number; refundPercent: number }>;
        const tier = [...tiers]
          .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart)
          .find((t) => hoursBeforeStart >= t.minHoursBeforeStart);
        await this.client.sendInteractiveButtons(
          whatsappNumber,
          `Cancellation policy: you'll receive ${tier?.refundPercent ?? 0}% back as Coins (${Math.round(((tier?.refundPercent ?? 0) / 100) * Number(booking.amount))} coins).\n\nConfirm cancellation?`,
          [
            { id: 'CONFIRM_CANCEL', title: '✅ Confirm Cancel' },
            { id: 'ACTION_BACK', title: '⬅️ Keep Booking' },
          ],
        );
      } else {
        await this.client.sendInteractiveButtons(
          whatsappNumber,
          "This booking hasn't been paid yet — cancelling it releases the slot with no charge.\n\nConfirm cancellation?",
          [
            { id: 'CONFIRM_CANCEL', title: '✅ Confirm Cancel' },
            { id: 'ACTION_BACK', title: '⬅️ Keep Booking' },
          ],
        );
      }
      return;
    }

    if (selection === 'CONFIRM_CANCEL') {
      // BookingsService.cancel sends the "✅ Booking cancelled" WhatsApp
      // notification itself (so a web-initiated cancellation notifies
      // just the same as a WhatsApp-initiated one, from one place rather
      // than duplicated per channel) — nothing to send here.
      await this.bookings.cancel(bookingId, 'Cancelled via WhatsApp', actor);
      return this.sendMainMenuFor(whatsappNumber, actor.id);
    }

    await this.client.sendText(whatsappNumber, 'Please choose an option above.');
  }

  private async showHelpMenu(whatsappNumber: string): Promise<void> {
    await this.client.sendInteractiveButtons(whatsappNumber, '🆘 Help — what do you need?', [
      { id: 'HELP_MY_TICKETS', title: '🎫 My Tickets' },
      { id: 'HELP_RAISE_TICKET', title: '➕ Raise a Ticket' },
    ]);
    await this.sessions.set(whatsappNumber, { screen: 'HELP_MENU' });
  }

  private async handleHelpMenu(whatsappNumber: string, message: InboundMessage): Promise<void> {
    const selection = message.kind === 'interactive_reply' ? message.id : '';

    if (selection === 'HELP_MY_TICKETS') {
      const customer = await this.customers.findOrCreateByWhatsAppNumber(whatsappNumber);
      const tickets = await this.support.listForCustomer({ role: Role.CUSTOMER, id: customer.id });
      if (tickets.length === 0) {
        await this.client.sendText(whatsappNumber, "You haven't raised any tickets yet.");
      } else {
        const lines = tickets
          .slice(0, 10)
          .map((t) => `🎫 ${t.subject} — ${t.status}`)
          .join('\n');
        await this.client.sendText(whatsappNumber, lines);
      }
      return this.sendMainMenuFor(whatsappNumber, customer.id);
    }

    if (selection === 'HELP_RAISE_TICKET') {
      await this.client.sendInteractiveList(
        whatsappNumber,
        'What is this about?',
        'Select Category',
        TICKET_CATEGORIES,
      );
      await this.sessions.set(whatsappNumber, { screen: 'HELP_RAISE_TICKET_CATEGORY' });
      return;
    }

    return this.showHelpMenu(whatsappNumber);
  }

  private async handleTicketCategory(
    whatsappNumber: string,
    message: InboundMessage,
  ): Promise<void> {
    const category = message.kind === 'interactive_reply' ? message.id : undefined;
    if (!category || !TICKET_CATEGORIES.some((c) => c.id === category)) {
      await this.client.sendText(whatsappNumber, 'Please choose a category from the list above.');
      return;
    }
    await this.client.sendText(whatsappNumber, 'Please describe the issue in a few words.');
    await this.sessions.set(whatsappNumber, { screen: 'HELP_RAISE_TICKET_DESCRIPTION', category });
  }

  private async handleTicketDescription(
    whatsappNumber: string,
    message: InboundMessage,
    category: string,
    actor: AuthContext,
  ): Promise<void> {
    if (message.kind !== 'text' || message.text.trim().length === 0) {
      await this.client.sendText(
        whatsappNumber,
        'Please send a short text description of the issue.',
      );
      return;
    }
    const ticket = await this.support.createTicket(
      {
        category: category as
          | 'REFUND_ISSUE'
          | 'PAID_BUT_BOOKING_FAILED'
          | 'BOOKING_ISSUE'
          | 'ACCOUNT_PROFILE_ISSUE'
          | 'OTHER',
        subject: message.text.trim().slice(0, 100),
        description: message.text.trim(),
      },
      actor,
    );
    await this.client.sendText(
      whatsappNumber,
      `✅ Ticket raised. Our support team will get back to you soon.\n\nReference: TK-${ticket.id.slice(0, 8).toUpperCase()}`,
    );
    return this.sendMainMenuFor(whatsappNumber, actor.id);
  }
}
