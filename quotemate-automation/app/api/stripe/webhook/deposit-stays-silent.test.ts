// Spec specs/tradie-booking-notifications.md AC8 — paying the deposit must
// NOT text the tradie.
//
// lib/quote/booking-notify.ts:141 sets the contract for every trade: "Tradie
// is notified only for a CONFIRMED booking (a slot exists). The
// deposit-paid-but-unscheduled case nudges the customer only." The tradie
// hears about the job when the customer picks a time, from
// /api/q/book/[trade]/[token].
//
// When the roofing booking alert was added (2026-07-27) the obvious next move
// was to also fire one from recordRoofingSiteVisit — the tradie would then get
// two texts a minute apart on a pay-then-book funnel, and roofing would drift
// from the convention the other trades follow. This pins the webhook shut.
//
// A structural assertion rather than a Stripe harness: the branches send
// nothing today, and the way that regresses is someone importing a sender
// here. Note the quotes branch delegates to finalisePaidQuote, so the webhook
// itself importing a dispatcher is unambiguously the roofing/painting mistake.
// The import is the whole guarantee — no import, no branch can send.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(join(__dirname, 'route.ts'), 'utf8')

describe('AC8 the deposit webhook stays silent', () => {
  it('imports no SMS sender', () => {
    const senders = [
      'dispatchQuoteMessage',
      'notifyRoofingTradie',
      'notifyBookingConfirmed',
      'buildTradieBookingNotification',
      'sendSms',
    ]
    const imported = senders.filter((s) => new RegExp(`import[^;]*\\b${s}\\b`, 's').test(SOURCE))
    expect(
      imported,
      `The Stripe webhook must not send SMS directly. If a deposit really should ` +
        `notify someone, change lib/quote/booking-notify.ts so EVERY trade changes ` +
        `together — do not give roofing or painting its own convention.`,
    ).toEqual([])
  })

  it('the deposit recorders both still exist to be covered by that rule', () => {
    for (const fn of ['recordRoofingSiteVisit', 'recordPaintingDeposit']) {
      expect(SOURCE, `${fn} not found — did it move? Re-point this guard.`).toContain(
        `async function ${fn}(`,
      )
    }
  })
})
