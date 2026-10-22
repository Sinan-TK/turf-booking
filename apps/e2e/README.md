# Browser tests (Playwright)

End-to-end tests for the three apps, driven in a real Chrome:

| Project | App | What it covers |
|---|---|---|
| `setup` | owner + admin | Signs in through the real login pages and saves the sessions in `.auth/` |
| `owner` | Owner/staff portal (3002) | Login page, dashboard, venues (list, new, detail), blocking units/facilities and pausing a venue with confirmation dialogs, adding units, pricing (add/edit/block/unblock/remove and the overlap rule), walk-in bookings, bookings list (search, filters, paging), payments, refunds, notifications, settings |
| `admin` | Super Admin (3001) | Login page, every list (search, filters, empty state, clear, paging), venue status and units, customers (block/unblock, wallet), facilities, reference pages |
| `web` | Customer site (3000) | Facility chips, location search, per-unit cards with slot prices and the hours prices set, facility filter, login by one-time code, booking a slot up to checkout, account, support |

## Run it

The tests run against the normal dev stack, so start it first (API 4000, web 3000, admin 3001, owner 3002):

```bash
pnpm dev                      # in one terminal
pnpm e2e                      # in another (from the repo root); it is not part of `pnpm test`
pnpm --filter @venue/e2e exec playwright test --project=owner      # one app
pnpm --filter @venue/e2e exec playwright test tests/owner/pricing.spec.ts
pnpm --filter @venue/e2e exec playwright test --ui                  # watch and debug
pnpm --filter @venue/e2e report                                     # open the last HTML report
```

It uses the Chrome already installed on the machine (`E2E_CHANNEL=chrome`), so there is no browser download.
Set `E2E_CHANNEL=msedge` for Edge, or `E2E_CHANNEL=` (empty) after `pnpm exec playwright install chromium`
to use Playwright's own Chromium. `E2E_HEADED=1` shows the browser.

Needs the dev accounts from `pnpm --filter @venue/database seed:identity` (`admin@turf.local` and
`owner@turf.local`, password `DevPassword123!`). Override with `E2E_ADMIN_EMAIL`, `E2E_OWNER_EMAIL`,
`E2E_DEV_PASSWORD`, and the URLs with `E2E_API_URL`, `E2E_WEB_URL`, `E2E_ADMIN_URL`, `E2E_OWNER_URL`.

## What to know

- **It uses the real dev database.** Every test creates its own data named `PW …` (venues, customers, bookings,
  tickets) and never edits an existing venue. Nothing is deleted afterwards, as with the API tests.
- **Customer login** is a WhatsApp code a test can't receive. The tests plant a code they know for the phone number
  in the same table the API writes (`support/customer.ts`, using `DATABASE_URL` and `CUSTOMER_SESSION_SECRET`
  from `apps/api/.env`), then type it into the real dialog.
- **The customer search** is tested with a venue at its own coordinates in the open sea and the browser's
  geolocation set there, so a search sees only that venue. A district search would also scan the hundreds of
  test venues in the dev database and take minutes.
- **Rate limits:** the API throttles logins and one-time codes. Setup reuses a saved session when it still works, and
  each test uses its own phone number.
- If the API is restarting (the dev watcher rebuilds it), setup waits up to a minute for it.
