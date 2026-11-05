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
        customerReleased: false,
        notifyCustomer: true,
        changedTiersCount: 2,
      }),
    ).toBe(false)
    expect(
      shouldNotifyOnEdit({
        status: 'awaiting_tradie_approval',
        customerReleased: false,
        notifyCustomer: undefined,
        changedTiersCount: 2,
      }),
    ).toBe(false)
    expect(
      shouldNotifyOnEdit({
        status: 'awaiting_tradie_approval',
        customerReleased: false,
        notifyCustomer: false,
        changedTiersCount: 0,
      }),
    ).toBe(false)
  })

  it('notifies when the tradie explicitly opts in after customer release', () => {
    expect(
      shouldNotifyOnEdit({ status: 'sent', customerReleased: true, notifyCustomer: true, changedTiersCount: 0 }),
    ).toBe(true)
    expect(
      shouldNotifyOnEdit({ status: 'draft', customerReleased: true, notifyCustomer: true, changedTiersCount: 0 }),
    ).toBe(true)
  })

  it('never notifies when the tradie chose save-quietly', () => {
    expect(
      shouldNotifyOnEdit({ status: 'sent', customerReleased: true, notifyCustomer: false, changedTiersCount: 2 }),
    ).toBe(false)
  })

  it('legacy default (notify undefined): notifies iff a tier price changed', () => {
    expect(
      shouldNotifyOnEdit({ status: 'sent', customerReleased: true, notifyCustomer: undefined, changedTiersCount: 1 }),
    ).toBe(true)
    expect(
      shouldNotifyOnEdit({ status: 'sent', customerReleased: true, notifyCustomer: undefined, changedTiersCount: 0 }),
    ).toBe(false)
  })

  it.each(['draft', 'awaiting_tradie_approval', null, undefined])('never first-contacts an unreleased %s quote', status => {
    for (const notifyCustomer of [true, false, undefined]) {
      expect(shouldNotifyOnEdit({ status, customerReleased: false, notifyCustomer, changedTiersCount: 1 })).toBe(false)
    }
  })
})
