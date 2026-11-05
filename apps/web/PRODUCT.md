# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Groups of friends, mostly young people in Kerala, booking a turf, court or activity venue for a group game. They book on their
phones, often the same day or evening, usually one person booking for the whole group.

## Product Purpose

Bookyo is the customer site of a venue-booking platform: find a venue by area or venue type (turfs, courts, pools, game rooms,
kayaking, studios and more), see which slots are free, pick a length, pay a small advance online and get a booking ID straight away.
Success is a group's slot locked in within a minute, without phoning the venue.

## Positioning

Live slots: what the site shows is what is free right now, per unit and per hour, and booking it is instant, with an advance paid
online and the rest at the venue. Do not position the product around WhatsApp (user decision, 2026-11-01).

## Operating Context

- Routes: `/` landing (admin-managed banners, venue types, how it works, owner call-out), `/explore` listing (search, venue type,
  location, date, venue cards with live slot counts and sold-out states), `/checkout/[bookingId]`, `/bookings/[id]`, `/account`
  (bookings, saved venues, wallet coins, support), `/support`, legal pages (terms, privacy, refunds, cookies).
- Customer sign-in: Google and email/password. Refunds go back as wallet coins. Venue owners sign up on the separate owner portal.
- Venue types, their icons (built-in or uploaded SVG) and pictures, banners, and locations (states, districts, areas) are managed by the
  Super Admin and are data, not design.

## Capabilities and Constraints

- Next.js 14 App Router, Tailwind, per-request CSP nonce (no third-party scripts or fonts beyond next/font self-hosting).
- Prices, advance rules and cancellation terms come from the API per facility; the UI never hard-codes money rules.
- Existing behaviour, test hooks (labels, roles, button names used by Playwright) and copy that states product facts must be kept.

## Brand Commitments

Name: Bookyo. The user left the visual identity open ("nothing is fixed"): wordmark styling, colour and type may all change.

## Evidence on Hand

No testimonials, ratings, user counts, venue counts or press. Future work must not invent them. Real content is the live venue,
venue-type and banner data from the API.

## Product Principles

1. Availability is the hero: show what is free now before anything else.
2. Phone first, thumb first: the group organiser books one-handed, often in a hurry.
3. Every price and rule shown comes from the venue's own settings.
4. Fewer steps beats more features.

## Accessibility & Inclusion

Keyboard focus visible everywhere, labelled controls, reduced-motion respected, readable contrast outdoors on a phone.
