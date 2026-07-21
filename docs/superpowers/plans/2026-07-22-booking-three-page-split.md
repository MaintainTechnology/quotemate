# Booking Three-Page Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the post-payment booking experience into a calendar-only booking page and a new thank-you page, on all three customer funnels, with every funnel reversed to pay-first.

**Architecture:** Every funnel becomes `customer view → Stripe → /book → /thanks`. Pure decision helpers in `lib/quote/` carry the funnel order, the no-slots payment guard, the discount realisation point, and the paid-amount resolution, so the order is unit-testable without a DB or Stripe. Pages stay thin. The two rival slot pickers collapse into one (`BookingCalendar`), which starts honouring the API's `next` field.

**Tech Stack:** Next.js 16 App Router (server components + `force-dynamic`), React 19, Supabase service-role client, Stripe Checkout, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-22-booking-three-page-split-design.md`

**Commands:**
- unit: `cd quotemate-automation && npm test`
- single file: `cd quotemate-automation && npx vitest run <path>`
- e2e: `cd quotemate-automation && npm run test:e2e`
- types: `cd quotemate-automation && npm run typecheck`
- lint: `cd quotemate-automation && npm run lint`

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `lib/quote/paid-amount.ts` | Resolve the real amount charged, per funnel, to one display string |
| `lib/quote/thanks.ts` | Pure gates + booking reference for the thank-you page |
| `app/q/_chrome/BookedSummary.tsx` | Shared "What's booked" card — the only place the thank-you rows are laid out |
| `app/q/[token]/thanks/page.tsx` | Thank-you page, quotes funnel |
| `app/q/roof/[token]/thanks/page.tsx` | Thank-you page, roofing funnel |
| `app/q/paint/[token]/book/page.tsx` | Booking page, painting funnel |
| `app/q/paint/[token]/thanks/page.tsx` | Thank-you page, painting funnel |
| `app/q/paint/[token]/visit.ics/route.ts` | `.ics` download, painting funnel |
| `sql/migrations/181_trade_paid_amount.sql` | `paid_amount_cents` on both measurement tables |
| `scripts/run-migration-181.mjs` | Apply it |

**Modified**

| Path | Change |
|---|---|
| `lib/quote/booking.ts` | `payRedirectTarget` → pay-first; `paidPageTarget` gains `'thanks'`; add `canTakePayment` |
| `lib/quote/early-bird.ts` | Add `resolveMintDiscount` (realise at mint, not at booking) |
| `app/q/roof/[token]/BookingCalendar.tsx` | Move to `app/q/_chrome/`, honour `next`, extract `resolveBookingNext` |
| `app/q/[token]/book/page.tsx` | Calendar-only, paid-gated, booked → `/thanks` |
| `app/q/roof/[token]/book/page.tsx` | Strip video + booked state + AddToCalendar |
| `app/q/[token]/paid/page.tsx` | Becomes a pure router |
| `app/api/q/[token]/book/route.ts` | Require paid; drop the discount block; `next` → `/thanks` |
| `app/api/q/book/[trade]/[token]/route.ts` | `next` → `/q/<trade>/<token>/thanks` |
| `app/r/[token]/[tier]/route.ts` | No-slots guard; realise discount at mint |
| `app/r/roof/[token]/[tier]/route.ts` | No-slots guard |
| `app/r/paint/[token]/[tier]/route.ts` | No-slots guard |
| `app/q/paint/[token]/page.tsx` | Remove the inline picker; link to `/book` |
| `app/q/roof/[token]/page.tsx` | Remove the legacy inline `SlotPicker`; booked → link `/thanks` |
| `app/api/stripe/webhook/route.ts` | Stamp `paid_amount_cents` on trade rows |

**Deleted**

| Path | Why |
|---|---|
| `app/q/[token]/book/SlotPicker.tsx` | Superseded by the single `BookingCalendar` |
| `app/r/solar/[token]/[tier]/route.ts` + `.test.ts` | Unreachable; queries columns that do not exist |

---

## Task 1: Pay-first funnel order

**Files:**
- Modify: `quotemate-automation/lib/quote/booking.ts:54-59,112-117`
- Test: `quotemate-automation/lib/quote/booking.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/quote/booking.test.ts`:

```ts
describe('payRedirectTarget — pay-first (2026-07-22 reversal)', () => {
  it('sends an unpaid deposit with no slot to Stripe, not to /book', () => {
    expect(payRedirectTarget({ paid: false, scheduledAt: null, tier: 'better' })).toBe('stripe')
  })

  it('sends an unpaid deposit WITH a slot to Stripe', () => {
    expect(payRedirectTarget({ paid: false, scheduledAt: '2026-08-01T00:00:00Z', tier: 'best' })).toBe('stripe')
  })

  it('keeps the unpaid inspection on Stripe', () => {
    expect(payRedirectTarget({ paid: false, scheduledAt: null, tier: 'inspection' })).toBe('stripe')
  })

  it('never re-charges a paid quote, slot or no slot', () => {
    expect(payRedirectTarget({ paid: true, scheduledAt: null, tier: 'better' })).toBe('paid')
    expect(payRedirectTarget({ paid: true, scheduledAt: '2026-08-01T00:00:00Z', tier: 'better' })).toBe('paid')
    expect(payRedirectTarget({ paid: true, scheduledAt: null, tier: 'inspection' })).toBe('paid')
  })

  it('never returns "book" for any input', () => {
    for (const tier of ['good', 'better', 'best', 'inspection']) {
      for (const paid of [true, false]) {
        for (const scheduledAt of [null, '2026-08-01T00:00:00Z']) {
          expect(payRedirectTarget({ paid, scheduledAt, tier })).not.toBe('book')
        }
      }
    }
  })
})

describe('paidPageTarget — routes the Stripe landing', () => {
  it('paid with no slot goes to the booking page', () => {
    expect(paidPageTarget({ paid: true, scheduledAt: null })).toBe('book')
  })
  it('paid with a slot goes to the thank-you page', () => {
    expect(paidPageTarget({ paid: true, scheduledAt: '2026-08-01T00:00:00Z' })).toBe('thanks')
  })
  it('not paid yet goes back to the quote', () => {
    expect(paidPageTarget({ paid: false, scheduledAt: null })).toBe('quote')
    expect(paidPageTarget({ paid: false, scheduledAt: '2026-08-01T00:00:00Z' })).toBe('quote')
  })
})

describe('canTakePayment — no-slots guard', () => {
  it('allows payment when the tenant has bookable windows', () => {
    expect(canTakePayment({ bookableCount: 3 })).toBe(true)
  })
  it('blocks payment when the tenant has published none', () => {
    expect(canTakePayment({ bookableCount: 0 })).toBe(false)
  })
})
```

Add `canTakePayment` to the existing import at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd quotemate-automation && npx vitest run lib/quote/booking.test.ts`
Expected: FAIL — `canTakePayment is not a function`, and the `'book'`/`'thanks'` assertions fail.

- [ ] **Step 3: Implement**

In `lib/quote/booking.ts`, replace `payRedirectTarget` (lines 54-59) with:

```ts
export function payRedirectTarget(input: PayRedirectInput): PayRedirectKind {
  // Paid is checked FIRST: /r mints a fresh payable Session per click, so a
  // paid quote routed to 'stripe' would re-charge on every re-click of an old
  // SMS link.
  if (input.paid) return 'paid'
  // 2026-07-22 — pay-first on every funnel. The customer pays, THEN picks a
  // time on /book, THEN lands on /thanks. `scheduledAt` no longer changes the
  // answer; a slot chosen under the old book-first order still just pays next.
  return 'stripe'
}
```

Replace `paidPageTarget` (lines 112-117) with:

```ts
/**
 * Where /q/<token>/paid sends the customer. The page is a ROUTER, not a
 * rendered surface — it exists to absorb Stripe's success_url and run the
 * webhook-race guard before handing off.
 *   paid, no slot → 'book'   (pick a time)
 *   paid, slot    → 'thanks' (confirmed)
 *   not paid yet  → 'quote'  (payment still settling)
 */
export function paidPageTarget(input: {
  paid: boolean
  scheduledAt: string | null | undefined
}): 'book' | 'thanks' | 'quote' {
  if (!input.paid) return 'quote'
  return input.scheduledAt ? 'thanks' : 'book'
}

/**
 * May we take money for this job yet? Pay-first means the customer commits
 * before seeing any times, so a tenant with zero published windows must not be
 * charged — they would have paid for a visit nobody can schedule.
 */
export function canTakePayment(input: { bookableCount: number }): boolean {
  return input.bookableCount > 0
}
```

Then delete `'book'` from the `PayRedirectKind` union (lines 26-27) and update the doc comment at lines 1-19 to describe pay-first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd quotemate-automation && npx vitest run lib/quote/booking.test.ts`
Expected: PASS. Pre-existing book-first cases in that file (`:21`, `:69`, `:110`) will fail — delete those three cases; they assert the order we just reversed.

- [ ] **Step 5: Commit**

```bash
cd quotemate-automation
git add lib/quote/booking.ts lib/quote/booking.test.ts
git commit -m "feat(booking): reverse every funnel to pay-first

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: One picker that honours `next`

**Files:**
- Create: `quotemate-automation/app/q/_chrome/BookingCalendar.tsx` (moved from `app/q/roof/[token]/BookingCalendar.tsx`)
- Create: `quotemate-automation/app/q/_chrome/booking-next.ts`
- Test: `quotemate-automation/app/q/_chrome/booking-next.test.ts`
- Delete: `quotemate-automation/app/q/roof/[token]/BookingCalendar.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/q/_chrome/booking-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveBookingNext } from './booking-next'

describe('resolveBookingNext', () => {
  it('uses the API next field when present', () => {
    expect(resolveBookingNext({ ok: true, next: '/q/roof/abc/thanks' }, '/q/roof/abc/book'))
      .toBe('/q/roof/abc/thanks')
  })

  it('falls back to the current path when next is missing', () => {
    expect(resolveBookingNext({ ok: true }, '/q/roof/abc/book')).toBe('/q/roof/abc/book')
  })

  it('falls back when next is empty or not a string', () => {
    expect(resolveBookingNext({ ok: true, next: '' }, '/x')).toBe('/x')
    expect(resolveBookingNext({ ok: true, next: 42 as unknown as string }, '/x')).toBe('/x')
  })

  it('refuses an absolute off-site URL — open-redirect guard', () => {
    expect(resolveBookingNext({ ok: true, next: 'https://evil.example/steal' }, '/x')).toBe('/x')
    expect(resolveBookingNext({ ok: true, next: '//evil.example' }, '/x')).toBe('/x')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd quotemate-automation && npx vitest run app/q/_chrome/booking-next.test.ts`
Expected: FAIL — cannot resolve `./booking-next`.

- [ ] **Step 3: Implement**

Create `app/q/_chrome/booking-next.ts`:

```ts
// Where the customer goes after a successful booking POST.
//
// Extracted from the picker so the navigation decision is unit-testable — the
// two pickers previously disagreed (one honoured the API's `next`, one reloaded
// the current path), so the same action landed customers on different pages.
//
// Only same-origin relative paths are accepted: the response is server-issued,
// but treating it as a navigation target without a check would make any future
// injection into that field an open redirect.
export function resolveBookingNext(
  json: { next?: unknown },
  fallbackPath: string,
): string {
  const next = json?.next
  if (typeof next !== 'string' || next === '') return fallbackPath
  if (!next.startsWith('/') || next.startsWith('//')) return fallbackPath
  return next
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd quotemate-automation && npx vitest run app/q/_chrome/booking-next.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Move the calendar and wire it up**

```bash
cd quotemate-automation
git mv "app/q/roof/[token]/BookingCalendar.tsx" app/q/_chrome/BookingCalendar.tsx
```

In `app/q/_chrome/BookingCalendar.tsx`, add the import:

```ts
import { resolveBookingNext } from './booking-next'
```

Replace the success block (was lines 122-128):

```ts
      setStatus('done')
      // The endpoint says where to go — the thank-you page for a completed
      // booking. Falls back to reloading this page without its query string.
      const dest = resolveBookingNext(json, window.location.pathname)
      setTimeout(() => {
        window.location.href = dest
      }, 500)
```

Update the module doc comment (lines 3-10) to say it serves every funnel, not just roofing.

- [ ] **Step 6: Fix the import in the roofing booking page**

In `app/q/roof/[token]/book/page.tsx`, replace line 24:

```ts
import { BookingCalendar, type CalendarDay } from '@/app/q/_chrome/BookingCalendar'
```

- [ ] **Step 7: Verify the tree compiles**

Run: `cd quotemate-automation && npm run typecheck`
Expected: clean. If `app/q/roof/[token]/page.tsx` still imports the old path, update it the same way.

- [ ] **Step 8: Commit**

```bash
cd quotemate-automation
git add -A app/q/_chrome app/q/roof
git commit -m "refactor(booking): single shared calendar that honours the API next field

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Record and resolve the real amount paid

**Files:**
- Create: `quotemate-automation/sql/migrations/181_trade_paid_amount.sql`
- Create: `quotemate-automation/scripts/run-migration-181.mjs`
- Create: `quotemate-automation/lib/quote/paid-amount.ts`
- Test: `quotemate-automation/lib/quote/paid-amount.test.ts`
- Modify: `quotemate-automation/app/api/stripe/webhook/route.ts:98-103`
- Modify: `quotemate-automation/app/q/roof/[token]/book/page.tsx:109-118`

- [ ] **Step 1: Write the failing test**

Create `lib/quote/paid-amount.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolvePaidAmount, formatPaidAmount } from './paid-amount'

describe('resolvePaidAmount', () => {
  it('prefers the recorded Stripe amount', () => {
    expect(resolvePaidAmount({ paidAmountCents: 9900, paidTier: 'inspection', totalIncGst: 22000 })).toBe(99)
  })

  it('reads cents, not dollars', () => {
    expect(resolvePaidAmount({ paidAmountCents: 660000, paidTier: 'better', totalIncGst: null })).toBe(6600)
  })

  it('falls back to the flat inspection fee for legacy rows with no amount', () => {
    expect(resolvePaidAmount({ paidAmountCents: null, paidTier: 'inspection', totalIncGst: 22000 })).toBe(99)
  })

  it('falls back to the quote total for a legacy deposit row', () => {
    expect(resolvePaidAmount({ paidAmountCents: null, paidTier: 'better', totalIncGst: 22000 })).toBe(22000)
  })

  it('returns null when nothing is known rather than inventing a figure', () => {
    expect(resolvePaidAmount({ paidAmountCents: null, paidTier: null, totalIncGst: null })).toBeNull()
  })

  it('ignores a zero or negative recorded amount', () => {
    expect(resolvePaidAmount({ paidAmountCents: 0, paidTier: 'inspection', totalIncGst: null })).toBe(99)
    expect(resolvePaidAmount({ paidAmountCents: -5, paidTier: 'inspection', totalIncGst: null })).toBe(99)
  })
})

describe('formatPaidAmount', () => {
  it('formats AU currency with two decimals', () => {
    expect(formatPaidAmount(99)).toBe('$99.00')
    expect(formatPaidAmount(22000)).toBe('$22,000.00')
  })
  it('returns null for null', () => {
    expect(formatPaidAmount(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd quotemate-automation && npx vitest run lib/quote/paid-amount.test.ts`
Expected: FAIL — cannot resolve `./paid-amount`.

- [ ] **Step 3: Implement**

Create `lib/quote/paid-amount.ts`:

```ts
// What the customer ACTUALLY paid, for the thank-you page.
//
// The trade tables (roofing_measurements / painting_measurements) historically
// recorded only paid_tier, so the $99 site-visit figure was inferred from a
// constant. That is wrong the moment a tenant charges anything else, and the
// five-sections review already caught the sibling bug on /paid, where a $99
// site-visit payment displayed the tier total ("Paid $22,000.00").
//
// Migration 181 adds paid_amount_cents, stamped from the Stripe Session's
// amount_total. This resolver prefers that recorded figure and only falls back
// for rows written before the migration.
import { INSPECTION_FEE_AUD } from './money'

export function resolvePaidAmount(input: {
  /** Stripe amount_total in cents (mig 181 / quotes mig 160). */
  paidAmountCents: number | null | undefined
  paidTier: string | null | undefined
  /** Quote total inc GST — the legacy deposit fallback. */
  totalIncGst: number | null | undefined
}): number | null {
  const cents = Number(input.paidAmountCents)
  if (Number.isFinite(cents) && cents > 0) return cents / 100
  if (input.paidTier === 'inspection') return INSPECTION_FEE_AUD
  const total = Number(input.totalIncGst)
  if (Number.isFinite(total) && total > 0) return total
  return null
}

export function formatPaidAmount(amount: number | null): string | null {
  if (amount == null) return null
  return `$${amount.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd quotemate-automation && npx vitest run lib/quote/paid-amount.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the migration**

Create `sql/migrations/181_trade_paid_amount.sql`:

```sql
-- 181 · record what the customer actually paid on the trade measurement tables.
--
-- roofing_measurements / painting_measurements carried paid_tier +
-- paid_stripe_session_id (mig 165) but no amount, so the thank-you page could
-- only infer the figure from the INSPECTION_FEE_AUD constant. Mirrors
-- quotes.paid_amount_cents (mig 160). Stamped from the Stripe Session's
-- amount_total by the webhook and by the page-level race guard.

alter table public.roofing_measurements
  add column if not exists paid_amount_cents bigint;

alter table public.painting_measurements
  add column if not exists paid_amount_cents bigint;

comment on column public.roofing_measurements.paid_amount_cents is
  'Stripe Session amount_total in cents. Null on rows paid before mig 181.';
comment on column public.painting_measurements.paid_amount_cents is
  'Stripe Session amount_total in cents. Null on rows paid before mig 181.';
```

- [ ] **Step 6: Write the runner**

Create `scripts/run-migration-181.mjs`, copying the shape of the newest existing `scripts/run-migration-*.mjs` in the repo (read one first — it connects with `pg` using `SUPABASE_DB_URL` and prints the applied statements).

- [ ] **Step 7: Apply it**

Run: `cd quotemate-automation && node --env-file=.env.local scripts/run-migration-181.mjs`
Expected: both `alter table` statements report success (idempotent — safe to re-run).

- [ ] **Step 8: Stamp the amount at both write points**

In `app/api/stripe/webhook/route.ts`, inside `recordRoofingSiteVisit` (the update at lines 98-103), add `paid_amount_cents`:

```ts
          .update({
            paid_at: now,
            paid_tier: 'inspection',
            paid_stripe_session_id: session.id,
            paid_amount_cents: session.amount_total ?? null,
          })
```

Apply the same addition to the painting equivalent in the same file.

In `app/q/roof/[token]/book/page.tsx`, the race-guard update (lines 109-118) gains the same field:

```ts
          .update({
            paid_at: new Date().toISOString(),
            paid_tier: 'inspection',
            paid_stripe_session_id: session.id,
            paid_amount_cents: session.amount_total ?? null,
          })
```

- [ ] **Step 9: Verify**

Run: `cd quotemate-automation && npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 10: Commit**

```bash
cd quotemate-automation
git add sql/migrations/181_trade_paid_amount.sql scripts/run-migration-181.mjs lib/quote/paid-amount.ts lib/quote/paid-amount.test.ts app/api/stripe/webhook/route.ts "app/q/roof/[token]/book/page.tsx"
git commit -m "feat(booking): record the real amount charged on the trade tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: No-slots payment guard

**Files:**
- Modify: `quotemate-automation/app/r/[token]/[tier]/route.ts`
- Modify: `quotemate-automation/app/r/roof/[token]/[tier]/route.ts:56-63`
- Modify: `quotemate-automation/app/r/paint/[token]/[tier]/route.ts`
- Test: `quotemate-automation/app/r/[token]/[tier]/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/r/[token]/[tier]/route.test.ts`:

```ts
describe('resolvePayRedirect — no-slots guard', () => {
  const base = { token: 'tok123', appUrl: APP, paid: false, scheduledAt: null, expired: false }

  it('blocks the charge and returns to the quote when no windows are published', () => {
    expect(resolvePayRedirect({ ...base, tier: 'better', bookableCount: 0 })).toEqual({
      kind: 'no-slots',
      url: `${APP}/q/tok123?slots=0`,
    })
  })

  it('blocks the $99 site visit too — same trap', () => {
    expect(resolvePayRedirect({ ...base, tier: 'inspection', bookableCount: 0 })).toEqual({
      kind: 'no-slots',
      url: `${APP}/q/tok123?slots=0`,
    })
  })

  it('lets the charge through when windows exist', () => {
    expect(resolvePayRedirect({ ...base, tier: 'better', bookableCount: 4 })).toEqual({ kind: 'stripe' })
  })

  it('never blocks an already-paid quote — it is not being charged', () => {
    expect(resolvePayRedirect({ ...base, paid: true, tier: 'better', bookableCount: 0 })).toEqual({
      kind: 'paid',
      url: `${APP}/q/tok123/paid?tier=better&already=1`,
    })
  })

  it('expiry still wins over the slots guard', () => {
    expect(resolvePayRedirect({ ...base, tier: 'better', expired: true, bookableCount: 0 })).toEqual({
      kind: 'expired',
      url: `${APP}/q/tok123`,
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd quotemate-automation && npx vitest run "app/r/[token]/[tier]/route.test.ts"`
Expected: FAIL — `bookableCount` is not accepted; `'no-slots'` never returned.

- [ ] **Step 3: Implement the decision**

In `app/r/[token]/[tier]/route.ts`, add `'no-slots'` to `PayRedirectDecision`'s kind union, then replace `resolvePayRedirect` (lines 85-110):

```ts
export function resolvePayRedirect(input: {
  tier: string
  paid: boolean
  scheduledAt: string | null | undefined
  expired: boolean
  token: string
  appUrl: string
  /** How many bookable windows the tenant currently has. Pay-first means the
   *  customer commits before seeing any times, so zero windows must not be
   *  charged — see canTakePayment. */
  bookableCount: number
}): PayRedirectDecision {
  const { tier, paid, scheduledAt, expired, token, appUrl, bookableCount } = input

  if (tier !== 'inspection' && !paid && expired) {
    return { kind: 'expired', url: `${appUrl}/q/${token}` }
  }

  const target = payRedirectTarget({ paid, scheduledAt, tier })
  if (target === 'paid') {
    return { kind: 'paid', url: `${appUrl}/q/${token}/paid?tier=${tier}&already=1` }
  }
  // About to charge — refuse if there is nothing to book afterwards.
  if (!canTakePayment({ bookableCount })) {
    return { kind: 'no-slots', url: `${appUrl}/q/${token}?slots=0` }
  }
  return { kind: 'stripe' }
}
```

Import `canTakePayment` from `@/lib/quote/booking`.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd quotemate-automation && npx vitest run "app/r/[token]/[tier]/route.test.ts"`
Expected: PASS. Delete the old `:84` book-first case asserting `kind: 'book'`.

- [ ] **Step 5: Feed the count in at the GET handler**

In the same file's `GET`, before calling `resolvePayRedirect`, load the tenant's options with the resolver the booking page uses, and pass `bookableCount: options.length`:

```ts
  const tz = tzForState(tenantRow?.state ?? null)
  const { data: bookedRows } = await db()
    .from('quotes')
    .select('scheduled_at, scheduled_window')
    .eq('tenant_id', quote.tenant_id)
    .in('booking_state', ['reserved', 'booked'])
    .not('scheduled_at', 'is', null)
    .neq('id', quote.id)
  const options = resolveBookingOptions({
    availability: tenantRow?.default_availability ?? null,
    availableSlots: tenantRow?.available_slots,
    timezone: tz,
    bookedKeys: buildBookedKeys(bookedRows ?? [], tz),
  })
```

Handle the new kind alongside the other non-stripe kinds — they all 302 to `decision.url`, so no new branch is needed at the redirect site.

- [ ] **Step 6: Same guard on the two trade short-links**

In `app/r/roof/[token]/[tier]/route.ts`, before minting (line 56), add:

```ts
  const options = await loadTenantBookingOptions(db(), {
    tenantId: row.tenant_id as string,
    table: 'roofing_measurements',
  })
  if (!canTakePayment({ bookableCount: options.length })) {
    return Response.redirect(`${appUrl}/q/roof/${token}?slots=0`, 302)
  }
```

Apply the equivalent in `app/r/paint/[token]/[tier]/route.ts` with `table: 'painting_measurements'` and `/q/paint/${token}?slots=0`.

- [ ] **Step 7: Render the notice**

On each of the three customer-view pages, when `searchParams.slots === '0'`, render a notice above the tier cards:

> **We'll arrange your time by text.** {tradieName} hasn't published bookable times yet, so we haven't taken any payment. They'll text you within one business day to lock one in.

- [ ] **Step 8: Verify**

Run: `cd quotemate-automation && npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
cd quotemate-automation
git add app/r app/q lib
git commit -m "feat(booking): never charge when the tenant has no bookable windows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Move the early-booking discount to the Stripe mint

**Files:**
- Modify: `quotemate-automation/lib/quote/early-bird.ts`
- Modify: `quotemate-automation/app/r/[token]/[tier]/route.ts:174-187`
- Modify: `quotemate-automation/app/api/q/[token]/book/route.ts:254-335` (delete the block)
- Test: `quotemate-automation/lib/quote/early-bird.test.ts`

Under pay-first the book route's `!alreadyPaid` branch never runs, so without this task the discount silently stops applying to every customer.

- [ ] **Step 1: Write the failing test**

Append to `lib/quote/early-bird.test.ts`:

```ts
import { resolveMintDiscount } from './early-bird'

describe('resolveMintDiscount — realised at Stripe mint (pay-first)', () => {
  const now = new Date('2026-07-22T00:00:00Z')

  it('realises a live offer', () => {
    expect(resolveMintDiscount({
      appliedPct: 0, offerPct: 10, expiresAt: '2026-07-23T00:00:00Z', tier: 'better', now,
    })).toEqual({ pct: 10, stamp: true })
  })

  it('keeps an already-realised discount without re-stamping', () => {
    expect(resolveMintDiscount({
      appliedPct: 12, offerPct: 10, expiresAt: '2026-07-23T00:00:00Z', tier: 'better', now,
    })).toEqual({ pct: 12, stamp: false })
  })

  it('ignores a lapsed offer', () => {
    expect(resolveMintDiscount({
      appliedPct: 0, offerPct: 10, expiresAt: '2026-07-21T00:00:00Z', tier: 'better', now,
    })).toEqual({ pct: 0, stamp: false })
  })

  it('never discounts the flat $99 inspection fee', () => {
    expect(resolveMintDiscount({
      appliedPct: 0, offerPct: 10, expiresAt: '2026-07-23T00:00:00Z', tier: 'inspection', now,
    })).toEqual({ pct: 0, stamp: false })
  })

  it('ignores a missing offer', () => {
    expect(resolveMintDiscount({
      appliedPct: 0, offerPct: null, expiresAt: null, tier: 'best', now,
    })).toEqual({ pct: 0, stamp: false })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd quotemate-automation && npx vitest run lib/quote/early-bird.test.ts`
Expected: FAIL — `resolveMintDiscount is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/quote/early-bird.ts`:

```ts
const DISCOUNTABLE_TIERS = new Set(['good', 'better', 'best'])

/**
 * The realised early-booking discount at Stripe mint time.
 *
 * Pay-first (2026-07-22) moved the choke-point: the customer now commits money
 * BEFORE picking a time, so the discount must be decided here rather than in
 * the book route (whose !alreadyPaid branch no longer runs). Decided
 * server-side from the DB-stamped deadline; nothing the client sends is read.
 *
 * `stamp` tells the caller to write applied_discount_pct — false when the
 * discount was already realised on an earlier click, so a re-click never
 * double-stamps.
 */
export function resolveMintDiscount(input: {
  appliedPct: number
  offerPct: number | null
  expiresAt: string | null
  tier: string
  now?: Date
}): { pct: number; stamp: boolean } {
  if (!DISCOUNTABLE_TIERS.has(input.tier)) return { pct: 0, stamp: false }
  if (input.appliedPct > 0) return { pct: input.appliedPct, stamp: false }
  const status = earlyBirdStatus(input.offerPct, input.expiresAt, input.now)
  return status.state === 'live'
    ? { pct: status.discountPct, stamp: true }
    : { pct: 0, stamp: false }
}
```

If `earlyBirdStatus` does not already accept a `now` argument, add it as an optional third parameter defaulting to `new Date()` — the tests depend on injectable time.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd quotemate-automation && npx vitest run lib/quote/early-bird.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it at the mint**

In `app/r/[token]/[tier]/route.ts`, replace the discount read (lines 174-187) with a `resolveMintDiscount` call that selects `early_bird_discount_pct, early_bird_expires_at, applied_discount_pct`, and when `stamp` is true writes `applied_discount_pct` + `applied_discount_at` before minting. Keep it in its own `try` so a pre-migration deploy simply finds no offer.

- [ ] **Step 6: Delete the superseded block**

Remove lines 254-335 of `app/api/q/[token]/book/route.ts` (the whole `// ─── v8 Phase A` block), the now-unused `appliedDiscountPct` variable, the `PAY_TIERS` constant, and the `earlyBirdStatus` / `expireCheckoutSession` imports. Drop `early_bird_discount_pct` from the response body.

- [ ] **Step 7: Verify**

Run: `cd quotemate-automation && npm test && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
cd quotemate-automation
git add lib/quote/early-bird.ts lib/quote/early-bird.test.ts app/r app/api
git commit -m "fix(booking): realise the early-booking discount at mint, not at booking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: The thank-you pages

**Files:**
- Create: `quotemate-automation/lib/quote/thanks.ts` + `thanks.test.ts`
- Create: `quotemate-automation/app/q/_chrome/BookedSummary.tsx`
- Create: `quotemate-automation/app/q/[token]/thanks/page.tsx`
- Create: `quotemate-automation/app/q/roof/[token]/thanks/page.tsx`

- [ ] **Step 1: Write the failing test**

Create `lib/quote/thanks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { thanksPageTarget, bookingRef } from './thanks'

describe('thanksPageTarget', () => {
  it('renders for a paid, scheduled job', () => {
    expect(thanksPageTarget({ paid: true, scheduledAt: '2026-08-01T00:00:00Z' })).toBe('render')
  })
  it('sends a paid job with no slot to the booking page', () => {
    expect(thanksPageTarget({ paid: true, scheduledAt: null })).toBe('book')
  })
  it('sends an unpaid visitor to pay', () => {
    expect(thanksPageTarget({ paid: false, scheduledAt: null })).toBe('pay')
    expect(thanksPageTarget({ paid: false, scheduledAt: '2026-08-01T00:00:00Z' })).toBe('pay')
  })
})

describe('bookingRef', () => {
  it('is the first 8 characters of the token, uppercased', () => {
    expect(bookingRef('a3f9c21b-dead-beef')).toBe('A3F9C21B')
  })
  it('tolerates a short token', () => {
    expect(bookingRef('abc')).toBe('ABC')
  })
  it('returns empty for a missing token rather than throwing', () => {
    expect(bookingRef(null)).toBe('')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd quotemate-automation && npx vitest run lib/quote/thanks.test.ts`
Expected: FAIL — cannot resolve `./thanks`.

- [ ] **Step 3: Implement**

Create `lib/quote/thanks.ts`:

```ts
// Gates for the thank-you page — the third and final page of the booking flow.
//
// The page confirms a COMPLETED booking, so it must never render a half-state:
// an unpaid visitor is sent to pay, a paid visitor with no time is sent to pick
// one. Pure so the gate is testable without a DB.

export function thanksPageTarget(input: {
  paid: boolean
  scheduledAt: string | null | undefined
}): 'render' | 'book' | 'pay' {
  if (!input.paid) return 'pay'
  return input.scheduledAt ? 'render' : 'book'
}

/** Customer-quotable booking reference. Matches the existing quote-ref
 *  convention on /q/[token]/paid and the roofing sheet label. */
export function bookingRef(token: string | null | undefined): string {
  if (!token) return ''
  return token.slice(0, 8).toUpperCase()
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd quotemate-automation && npx vitest run lib/quote/thanks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Build the shared summary card**

Create `app/q/_chrome/BookedSummary.tsx` — a server component taking
`{ tradieName, jobLabel, visitLabel, place, ref, paidLabel }` and rendering the
rows through the existing `CredentialFooter` row styling (118px mono label
column + value). The **Booked** row reads `Online · self-serve · ref {ref}`.
Omit any row whose value is null. No client JS.

- [ ] **Step 6: Build the two thank-you pages**

Both are `export const dynamic = 'force-dynamic'` server components that:

1. Load the row by token; `notFound()` when absent.
2. Run the same webhook-race guard the current `/paid` and roof `/book` pages
   use, so a customer beating the webhook still sees a confirmation.
3. Switch on `thanksPageTarget(...)` — `'pay'` redirects to that funnel's pay
   short-link, `'book'` redirects to `/book`, `'render'` continues.
4. Render, in order: `TrustVideo` with `trustVideoUrls(identity).thankyou` and
   the caption `"A thank-you message from your tradie"`, the next-steps
   paragraph, `BookedSummary`, `AddToCalendar`, and a "Download quote (PDF)"
   link when the quote is priced.

`app/q/[token]/thanks/page.tsx` uses `quotes` + `intakes`, `formatScheduled`
from the current `/paid` page, `buildGoogleCalendarUrl` / `resolveEventWindow`,
and `icsHref="/api/q/<token>/ics"`.

`app/q/roof/[token]/thanks/page.tsx` uses `roofing_measurements`,
`formatVisitSlot`, `visitCalendarLinks`, and `icsHref="/q/roof/<token>/visit.ics"`,
inside `QuoteChrome` + `QuoteSheet` + `Letterhead` to match its funnel.

Both take the paid figure from `resolvePaidAmount` + `formatPaidAmount`.

- [ ] **Step 7: Verify**

Run: `cd quotemate-automation && npm test && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
cd quotemate-automation
git add lib/quote/thanks.ts lib/quote/thanks.test.ts app/q/_chrome/BookedSummary.tsx "app/q/[token]/thanks" "app/q/roof/[token]/thanks"
git commit -m "feat(booking): thank-you pages for the quotes and roofing funnels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Booking pages become calendar-only

**Files:**
- Modify: `quotemate-automation/app/q/roof/[token]/book/page.tsx`
- Modify: `quotemate-automation/app/q/[token]/book/page.tsx`
- Delete: `quotemate-automation/app/q/[token]/book/SlotPicker.tsx`

- [ ] **Step 1: Strip the roofing booking page**

Delete from `app/q/roof/[token]/book/page.tsx`:
- the entire `{/* Thank-you video */}` `SheetSection` (lines 171-188)
- the booked-state branch and its `AddToCalendar` (lines 192-207)
- the now-unused `TrustVideo`, `AddToCalendar`, `visitCalendarLinks`,
  `formatVisitSlot` imports and the `calLinks` / `slotLabel` locals

Replace the booked branch with a redirect placed with the other guards:

```ts
  // A booked visit belongs on the thank-you page — this page's only job is
  // picking a time.
  if (scheduledAt) redirect(`/q/roof/${token}/thanks`)
```

The remaining body is the letterhead, one instruction line, `BookingCalendar`,
and the back link.

- [ ] **Step 2: Rewrite the quotes booking page**

`app/q/[token]/book/page.tsx` loses `StepStrip`, `AlreadyScheduledState`,
`ReservedPayState`, `NoSlotsPayState`, `PickState` and the `Topo` decoration.
Its guards become:

```ts
  if (!quote) notFound()
  if (priceExpired) { /* keep ExpiredState — a lapsed price must not be booked */ }
  if (!isPaid) redirect(`/r/${token}/${tier}`)      // pay-first
  if (isScheduled) redirect(`/q/${token}/thanks`)   // already booked
```

The body renders `BookingCalendar` with `endpoint={`/api/q/${token}/book`}`,
built from `options` via the same `toCalendarDays` helper the roofing page uses
— move that helper into `app/q/_chrome/BookingCalendar.tsx` and export it so
both pages share one implementation.

- [ ] **Step 3: Delete the superseded picker**

```bash
cd quotemate-automation
git rm "app/q/[token]/book/SlotPicker.tsx"
```

Update the two remaining importers — `app/q/paint/[token]/page.tsx:33` and
`app/q/roof/[token]/page.tsx:68` — in Task 8.

- [ ] **Step 4: Verify**

Run: `cd quotemate-automation && npm run typecheck`
Expected: errors ONLY in the two files Task 8 fixes. Nothing else may reference `SlotPicker`.

- [ ] **Step 5: Commit**

```bash
cd quotemate-automation
git add -A "app/q/[token]/book" "app/q/roof/[token]/book"
git commit -m "feat(booking): booking pages render the calendar and nothing else

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Painting funnel, routers, and dead-code removal

**Files:**
- Create: `quotemate-automation/app/q/paint/[token]/book/page.tsx`
- Create: `quotemate-automation/app/q/paint/[token]/thanks/page.tsx`
- Create: `quotemate-automation/app/q/paint/[token]/visit.ics/route.ts`
- Modify: `quotemate-automation/app/q/paint/[token]/page.tsx:685-709`
- Modify: `quotemate-automation/app/q/roof/[token]/page.tsx`
- Modify: `quotemate-automation/app/q/[token]/paid/page.tsx`
- Modify: `quotemate-automation/app/api/q/[token]/book/route.ts`
- Modify: `quotemate-automation/app/api/q/book/[trade]/[token]/route.ts:142`
- Delete: `quotemate-automation/app/r/solar/[token]/[tier]/route.ts` + `route.test.ts`

- [ ] **Step 1: Painting booking + thank-you pages**

Copy the roofing pair, swapping `roofing_measurements` → `painting_measurements`,
`/q/roof/` → `/q/paint/`, `roof` → `paint` in the API endpoint, and the trade
label. `visit.ics/route.ts` mirrors the roofing route with `visitIcsText`.

- [ ] **Step 2: Remove the inline paint picker**

In `app/q/paint/[token]/page.tsx`, replace the booking `SheetSection`
(lines 685-709) with a link, and delete the `SlotPicker` import (line 33) and
the `paintBookingOptions` load (lines 175-182):

```tsx
{paid ? (
  <SheetSection eyebrow={paintScheduledAt ? 'Your visit' : 'Book your visit'} eyebrowAccent>
    <a href={`/q/paint/${token}/${paintScheduledAt ? 'thanks' : 'book'}`} className="qm-cta" style={ctaStyle}>
      {paintScheduledAt ? 'View your booking →' : 'Pick your visit time →'}
    </a>
  </SheetSection>
) : null}
```

- [ ] **Step 3: Remove the legacy roof inline picker**

In `app/q/roof/[token]/page.tsx`, delete the `SlotPicker` import (line 68) and
its render (around line 1107-1112); point the booked state's link at
`/q/roof/<token>/thanks` instead of `/book` (line 810).

- [ ] **Step 4: Turn /paid into a router**

`app/q/[token]/paid/page.tsx` keeps its lookup and `confirmPaidFromSession`
guard, then ends:

```ts
  const target = paidPageTarget({ paid: !!paidAt, scheduledAt })
  const tierParam = paidTier ?? sp.tier ?? null
  const q = tierParam ? `?tier=${encodeURIComponent(tierParam)}` : ''
  if (target === 'thanks') redirect(`/q/${token}/thanks${q}`)
  if (target === 'book') redirect(`/q/${token}/book${q}`)
  redirect(`/q/${token}`)
```

Everything below that — the video, the confirmation card, the actions — is
deleted; it now lives on `/thanks`.

- [ ] **Step 5: Point the booking APIs at /thanks**

`app/api/q/[token]/book/route.ts`: require payment before a slot may be picked
(mirroring the trade route), and always return the thank-you page:

```ts
  if (!quote.paid_at) {
    return Response.json(
      { ok: false, error: 'Pay the deposit first, then pick your time.' },
      { status: 409 },
    )
  }
```

```ts
  const next = `/q/${token}/thanks`
```

Since every booking is now post-payment, the `alreadyPaid` conditional
collapses: always write `booking_state: BOOKING_STATE.BOOKED`, `status:
'accepted'`, prune the slot, and fire `notifyBookingConfirmed`.

`app/api/q/book/[trade]/[token]/route.ts:142`:

```ts
  return Response.json({ ok: true, scheduled_at: slot, next: `/q/${trade}/${token}/thanks` })
```

- [ ] **Step 6: Delete the dead solar short-link**

```bash
cd quotemate-automation
git rm "app/r/solar/[token]/[tier]/route.ts" "app/r/solar/[token]/[tier]/route.test.ts"
```

It 404s before its redirect (selects `token`/`paid_at`/`scheduled_at`/`stripe_links`
from `solar_estimates`, none of which exist) and targets pages that do not
exist. Solar books through the generic quotes pages via token twinning.

- [ ] **Step 7: Verify**

Run: `cd quotemate-automation && npm test && npm run typecheck && npm run lint`
Expected: PASS, clean. `grep -r SlotPicker app lib` must return nothing.

- [ ] **Step 8: Commit**

```bash
cd quotemate-automation
git add -A app
git commit -m "feat(booking): painting three-page flow, /paid router, drop dead solar link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: End-to-end coverage

**Files:**
- Modify: `quotemate-automation/tests/e2e/roofing-quote-workflow.spec.ts:170,183`
- Modify: `quotemate-automation/tests/e2e/roofing-five-sections.spec.ts:168,178,186,275`
- Create: `quotemate-automation/tests/e2e/booking-three-page-split.spec.ts`

- [ ] **Step 1: Rewrite the book-first assertions**

`roofing-quote-workflow.spec.ts:170` currently asserts `/r/<token>/better`
redirects to `/q/<token>/book`. Under pay-first it must reach Stripe:

```ts
    expect(res.status()).toBe(302)
    const loc = res.headers()['location'] ?? ''
    expect(loc).toContain('checkout.stripe.com')
    expect(loc).not.toContain('/book')
```

`:183` seeds `paid_at` on the quote before visiting `/q/<token>/book`, since
the page is now paid-gated.

`roofing-five-sections.spec.ts:275` moves from `/q/<paidToken>/paid` to
`/q/<paidToken>/thanks` — `/paid` no longer renders.

- [ ] **Step 2: Write the new spec**

Create `tests/e2e/booking-three-page-split.spec.ts` covering, per funnel:

```ts
test('booking page shows a calendar and no thank-you video', async ({ page }) => {
  await page.goto(`/q/roof/${token}/book`)
  await expect(page.getByRole('grid', { name: /choose a date/i })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.getByText(/thank-you message from your tradie/i)).toHaveCount(0)
})

test('confirming a time lands on the thank-you page', async ({ page }) => {
  await page.goto(`/q/roof/${token}/book`)
  await page.getByRole('button', { name: /^\d+$/ }).first().click()
  await page.getByRole('button', { name: /morning|afternoon|am|pm/i }).first().click()
  await page.getByRole('button', { name: /book this time/i }).click()
  await page.waitForURL(`**/q/roof/${token}/thanks`)
})

test('thank-you page shows the amount, the slot, the ref and the calendar links', async ({ page }) => {
  await page.goto(`/q/roof/${token}/thanks`)
  await expect(page.getByText('$99.00')).toBeVisible()
  await expect(page.getByText(/Online · self-serve · ref/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /add to calendar/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Google$/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Outlook$/ })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(1)
})

test('an unpaid visitor reaches neither page', async ({ page }) => {
  const book = await page.request.get(`/q/roof/${unpaidToken}/book`, { maxRedirects: 0 })
  expect(book.status()).toBe(307)
  const thanks = await page.request.get(`/q/roof/${unpaidToken}/thanks`, { maxRedirects: 0 })
  expect(thanks.status()).toBe(307)
})

test('a tenant with no published windows is not charged', async ({ page }) => {
  const res = await page.request.get(`/r/roof/${noSlotsToken}/inspection`, { maxRedirects: 0 })
  expect(res.headers()['location']).toContain('slots=0')
  expect(res.headers()['location']).not.toContain('checkout.stripe.com')
})
```

Seed fixtures with the service-role client following the pattern already in
`roofing-quote-workflow.spec.ts`.

- [ ] **Step 3: Run the suite**

Run: `cd quotemate-automation && npm run test:e2e`
Expected: PASS.

- [ ] **Step 4: Full gate**

Run: `cd quotemate-automation && npm test && npm run typecheck && npm run lint && npm run test:e2e`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd quotemate-automation
git add tests/e2e
git commit -m "test(booking): cover the three-page split end to end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Record the strategy drift

**Files:**
- Modify: `docs/strategy.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the iteration entry**

Append a new iteration entry to `docs/strategy.md` recording that the
`WP6 reorder: BOOK FIRST, PAY LAST` decision is superseded for deposit tiers as
of 2026-07-22, why (one consistent three-page funnel across all trades), and
the mitigation (`canTakePayment` blocks a charge when no windows are published).

- [ ] **Step 2: Update the engineering notes**

In `CLAUDE.md`, update the webpage-surface list to include `/q/[token]/thanks`,
`/q/roof/[token]/{book,thanks}` and `/q/paint/[token]/{book,thanks}`, and note
that `/q/[token]/paid` is now a router.

- [ ] **Step 3: Run the strategy reviewer**

Invoke the `strategy-reviewer` agent, as `CLAUDE.md` requires after any
`docs/strategy.md` edit.

- [ ] **Step 4: Commit**

```bash
git add docs/strategy.md CLAUDE.md
git commit -m "docs: log the pay-first funnel reversal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** R1 → Tasks 6/7/8. R2 → Task 2 + Task 7 Step 3. R3 → Task 7. R4 → Task 6. R5 → Tasks 1 + 8 Step 4. R6a → Task 4. R6b → Task 5. R6c → Task 3. R7 → Task 8 Step 6. Definition-of-done items 1-3 → Task 9 Step 4; item 4 → post-plan browser verification; item 5 → Task 8 Step 7.

**Type consistency:** `paidPageTarget` returns `'book' | 'thanks' | 'quote'` in Task 1 and is consumed with exactly those in Task 8. `canTakePayment({ bookableCount })` is defined in Task 1 and called with that key in Task 4. `resolvePaidAmount` / `formatPaidAmount` defined in Task 3, used in Task 6. `thanksPageTarget` / `bookingRef` defined in Task 6, used in Task 6. `resolveBookingNext(json, fallbackPath)` defined in Task 2, used in Task 2.

**Known risk:** Task 7 deletes `SlotPicker` while Task 8 fixes its last two importers, so the tree does not typecheck between those tasks. Task 7 Step 4 states this explicitly.
