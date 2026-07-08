// Pure render-decision helper for the persistent dashboard top nav
// (specs/dashboard-persistent-nav.md A1): the bar shows on every /dashboard
// sub-route and hides on the root /dashboard page, which already renders its
// own topbar.

import { describe, it, expect } from 'vitest'
import { showDashboardNav } from './dashboard-nav'

describe('showDashboardNav', () => {
  it('hides on the root dashboard page (own topbar)', () => {
    expect(showDashboardNav('/dashboard')).toBe(false)
    expect(showDashboardNav('/dashboard/')).toBe(false)
  })

  it('hides when pathname is not yet known', () => {
    expect(showDashboardNav(null)).toBe(false)
    expect(showDashboardNav(undefined)).toBe(false)
  })

  it('shows on every dashboard sub-route', () => {
    expect(showDashboardNav('/dashboard/quote/abc123')).toBe(true)
    expect(showDashboardNav('/dashboard/aircon')).toBe(true)
    expect(showDashboardNav('/dashboard/signage/queue')).toBe(true)
    expect(showDashboardNav('/dashboard/estimator/run-1')).toBe(true)
  })
})
