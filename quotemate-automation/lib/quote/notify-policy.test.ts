// Customer-notify decision for tradie quote edits
// (specs/tradie-manual-line-items.md, R10).
//
// A quote held for tradie approval must NOT SMS the customer on edit — only
// the explicit Approve action first-contacts them. Otherwise the tradie's
// opt-in (or the legacy price-changed default) drives notification.

import { describe, expect, it } from 'vitest'
import { shouldNotifyOnEdit } from './notify-policy'

describe('shouldNotifyOnEdit', () => {
  it('never notifies while the quote is held for tradie approval', () => {
    expect(
      shouldNotifyOnEdit({
        status: 'awaiting_tradie_approval',
        notifyCustomer: true,
        changedTiersCount: 2,
      }),
    ).toBe(false)
    expect(
      shouldNotifyOnEdit({
        status: 'awaiting_tradie_approval',
        notifyCustomer: undefined,
        changedTiersCount: 2,
      }),
    ).toBe(false)
    expect(
      shouldNotifyOnEdit({
        status: 'awaiting_tradie_approval',
        notifyCustomer: false,
        changedTiersCount: 0,
      }),
    ).toBe(false)
  })

  it('notifies when the tradie explicitly opts in (and the quote is not held)', () => {
    expect(
      shouldNotifyOnEdit({ status: 'sent', notifyCustomer: true, changedTiersCount: 0 }),
    ).toBe(true)
    expect(
      shouldNotifyOnEdit({ status: 'draft', notifyCustomer: true, changedTiersCount: 0 }),
    ).toBe(true)
  })

  it('never notifies when the tradie chose save-quietly', () => {
    expect(
      shouldNotifyOnEdit({ status: 'sent', notifyCustomer: false, changedTiersCount: 2 }),
    ).toBe(false)
  })

  it('legacy default (notify undefined): notifies iff a tier price changed', () => {
    expect(
      shouldNotifyOnEdit({ status: 'sent', notifyCustomer: undefined, changedTiersCount: 1 }),
    ).toBe(true)
    expect(
      shouldNotifyOnEdit({ status: 'sent', notifyCustomer: undefined, changedTiersCount: 0 }),
    ).toBe(false)
  })
})
