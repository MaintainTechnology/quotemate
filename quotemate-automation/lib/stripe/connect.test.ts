import { describe, expect, it } from 'vitest'
import {
  PLATFORM_FEE_PCT,
  platformFeeCents,
  connectDestinationForTenant,
  connectPaymentIntentExtras,
  connectSessionMetadata,
  payoutReleaseDecision,
  PAYOUT_CLAIM_SENTINEL,
} from './connect'

describe('platformFeeCents', () => {
  it('takes 2% of the amount, rounded to the cent', () => {
    expect(PLATFORM_FEE_PCT).toBe(2)
    expect(platformFeeCents(9900)).toBe(198) // $99 inspection → $1.98
    expect(platformFeeCents(33000)).toBe(660) // $330 deposit → $6.60
    expect(platformFeeCents(12345)).toBe(247) // 246.9 rounds up
    expect(platformFeeCents(0)).toBe(0)
  })
})

describe('connectDestinationForTenant', () => {
  const live = {
    stripe_connect_account_id: 'acct_1',
    stripe_connect_charges_enabled: true,
    stripe_connect_payouts_enabled: true,
  }
  it('routes via Connect only when the account is fully live', () => {
    expect(connectDestinationForTenant(live)).toEqual({ accountId: 'acct_1' })
  })
  it('stays platform-direct without an account or with a half-onboarded one', () => {
    expect(connectDestinationForTenant(null)).toBeNull()
    expect(connectDestinationForTenant({ ...live, stripe_connect_account_id: null })).toBeNull()
    expect(connectDestinationForTenant({ ...live, stripe_connect_charges_enabled: false })).toBeNull()
    expect(connectDestinationForTenant({ ...live, stripe_connect_payouts_enabled: false })).toBeNull()
  })
})

describe('connectPaymentIntentExtras / connectSessionMetadata', () => {
  it('builds the destination-charge params with the 2% fee', () => {
    expect(connectPaymentIntentExtras(33000, { accountId: 'acct_1' })).toEqual({
      on_behalf_of: 'acct_1',
      transfer_data: { destination: 'acct_1' },
      application_fee_amount: 660,
    })
  })
  it('mirrors the routing into session metadata for the webhook stamp', () => {
    expect(connectSessionMetadata(33000, { accountId: 'acct_1' })).toEqual({
      connect_destination: 'acct_1',
      application_fee_cents: '660',
    })
  })
})

describe('payoutReleaseDecision', () => {
  const paidQuote = {
    paid_at: '2026-07-01T00:00:00Z',
    paid_amount_cents: 33000,
    platform_fee_cents: 660,
    stripe_connect_destination: 'acct_1',
    stripe_payout_id: null,
  }
  const tenant = {
    stripe_connect_account_id: 'acct_1',
    stripe_connect_charges_enabled: true,
    stripe_connect_payouts_enabled: true,
  }

  it('releases the net (paid − fee) to the destination account', () => {
    expect(payoutReleaseDecision(paidQuote, tenant)).toEqual({
      ok: true,
      amountCents: 32340,
      accountId: 'acct_1',
    })
  })
  it('blocks an unpaid quote', () => {
    expect(payoutReleaseDecision({ ...paidQuote, paid_at: null }, tenant)).toEqual({
      ok: false,
      reason: 'not_paid',
    })
  })
  it('blocks legacy platform-direct payments (no destination)', () => {
    expect(
      payoutReleaseDecision({ ...paidQuote, stripe_connect_destination: null }, tenant),
    ).toEqual({ ok: false, reason: 'not_connect_routed' })
  })
  it('blocks when the tenant re-onboarded onto a different account', () => {
    expect(
      payoutReleaseDecision(paidQuote, { ...tenant, stripe_connect_account_id: 'acct_2' }),
    ).toEqual({ ok: false, reason: 'account_mismatch' })
  })
  it('blocks while payouts are not enabled on the account', () => {
    expect(
      payoutReleaseDecision(paidQuote, { ...tenant, stripe_connect_payouts_enabled: false }),
    ).toEqual({ ok: false, reason: 'payouts_not_ready' })
  })
  it('is idempotent on an already-released or in-flight quote', () => {
    expect(
      payoutReleaseDecision({ ...paidQuote, stripe_payout_id: 'po_1' }, tenant),
    ).toEqual({ ok: false, reason: 'already_released' })
    expect(
      payoutReleaseDecision({ ...paidQuote, stripe_payout_id: PAYOUT_CLAIM_SENTINEL }, tenant),
    ).toEqual({ ok: false, reason: 'release_in_progress' })
  })
  it('blocks a zero/negative net', () => {
    expect(
      payoutReleaseDecision({ ...paidQuote, paid_amount_cents: null }, tenant),
    ).toEqual({ ok: false, reason: 'nothing_to_release' })
    expect(
      payoutReleaseDecision(
        { ...paidQuote, paid_amount_cents: 660, platform_fee_cents: 660 },
        tenant,
      ),
    ).toEqual({ ok: false, reason: 'nothing_to_release' })
  })
})
