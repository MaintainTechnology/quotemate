// Unit tests for the Accounts v2 provisioning in lib/stripe/provision.ts.
//
// Covers the v1→v2 migration: the v2 create body shape (the Express-equivalent
// recipe), the v1-interop manual payout follow-up + its fail-closed readback,
// and the v2 account-onboarding link. Stripe is fully mocked via ./client, so
// no network is touched and no secret key is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const accountsCreate = vi.fn()
  const accountsUpdate = vi.fn()
  const accountLinksCreate = vi.fn()
  const stripe = {
    v2: {
      core: {
        accounts: { create: accountsCreate },
        accountLinks: { create: accountLinksCreate },
      },
    },
    accounts: { update: accountsUpdate },
  }
  return { accountsCreate, accountsUpdate, accountLinksCreate, stripe }
})

vi.mock('./client', () => ({ getStripe: () => h.stripe }))

import { provisionStripeConnectAccount, createConnectOnboardingLink } from './provision'

const opts = {
  tenantId: 'tenant-1',
  ownerEmail: 'sparky@example.com',
  businessName: 'Atomic Electrical',
}

beforeEach(() => {
  h.accountsCreate.mockReset()
  h.accountsUpdate.mockReset()
  h.accountLinksCreate.mockReset()
  vi.stubEnv('STRIPE_PROVISIONING_ENABLED', 'true')
})

describe('provisionStripeConnectAccount', () => {
  it('stubs (no Stripe call) when provisioning is disabled', async () => {
    vi.stubEnv('STRIPE_PROVISIONING_ENABLED', 'false')
    const res = await provisionStripeConnectAccount(opts)
    expect(res).toEqual({ ok: true, stubbed: true, accountId: null })
    expect(h.accountsCreate).not.toHaveBeenCalled()
  })

  it('creates a v2 Express-equivalent account and sets a manual payout schedule', async () => {
    h.accountsCreate.mockResolvedValue({ id: 'acct_new' })
    h.accountsUpdate.mockResolvedValue({
      settings: { payouts: { schedule: { interval: 'manual' } } },
    })

    const res = await provisionStripeConnectAccount(opts)
    expect(res).toEqual({ ok: true, stubbed: false, accountId: 'acct_new' })

    // v2 create body — the exact Express-equivalent recipe.
    expect(h.accountsCreate).toHaveBeenCalledTimes(1)
    const body = h.accountsCreate.mock.calls[0][0]
    expect(body).toMatchObject({
      contact_email: 'sparky@example.com',
      display_name: 'Atomic Electrical',
      dashboard: 'express',
      identity: { country: 'AU', entity_type: 'individual' },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
      defaults: {
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      },
      metadata: { tenant_id: 'tenant-1' },
    })
    // No legacy v1 presets leaked into the v2 body.
    expect(body.controller).toBeUndefined()
    expect(body.type).toBeUndefined()
    expect(body.capabilities).toBeUndefined()

    // Manual payout schedule set via v1 interop on the same acct id.
    expect(h.accountsUpdate).toHaveBeenCalledWith('acct_new', {
      settings: { payouts: { schedule: { interval: 'manual' } } },
    })
  })

  it('fails closed (never returns an accountId) when the manual schedule does not stick', async () => {
    h.accountsCreate.mockResolvedValue({ id: 'acct_auto' })
    // Stripe left it on an automatic cadence — must NOT persist this account.
    h.accountsUpdate.mockResolvedValue({
      settings: { payouts: { schedule: { interval: 'daily' } } },
    })

    const res = await provisionStripeConnectAccount(opts)
    expect(res).toMatchObject({ ok: false, code: 'manual_payout_not_set' })
    expect(res).not.toHaveProperty('accountId')
  })

  it('returns ok:false with the Stripe message + code when the v2 create throws', async () => {
    h.accountsCreate.mockRejectedValue(Object.assign(new Error('boom'), { code: 'account_invalid' }))
    const res = await provisionStripeConnectAccount(opts)
    expect(res).toMatchObject({ ok: false, reason: 'boom', code: 'account_invalid' })
    // No payout update attempted when the account never got created.
    expect(h.accountsUpdate).not.toHaveBeenCalled()
  })
})

describe('createConnectOnboardingLink', () => {
  it('mints a v2 account_onboarding link for both configurations', async () => {
    h.accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/x' })

    const res = await createConnectOnboardingLink({
      accountId: 'acct_new',
      appUrl: 'https://app.test',
    })
    expect(res).toEqual({ ok: true, url: 'https://connect.stripe.com/setup/x' })
    expect(h.accountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_new',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant', 'recipient'],
          refresh_url: 'https://app.test/onboard/stripe/refresh',
          return_url: 'https://app.test/onboard/stripe/return',
        },
      },
    })
  })

  it('returns mobile onboarding to the verified payouts app link', async () => {
    h.accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/mobile' })

    await createConnectOnboardingLink({
      accountId: 'acct_new',
      appUrl: 'https://app.test',
      returnClient: 'mobile',
    })

    expect(h.accountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        use_case: expect.objectContaining({
          account_onboarding: expect.objectContaining({
            refresh_url: 'https://app.test/app/sections/payouts?stripe=refresh',
            return_url: 'https://app.test/app/sections/payouts?stripe=return',
          }),
        }),
      }),
    )
  })

  it('refuses (no Stripe call) when provisioning is disabled', async () => {
    vi.stubEnv('STRIPE_PROVISIONING_ENABLED', 'false')
    const res = await createConnectOnboardingLink({ accountId: 'acct_x', appUrl: 'https://app.test' })
    expect(res.ok).toBe(false)
    expect(h.accountLinksCreate).not.toHaveBeenCalled()
  })
})
