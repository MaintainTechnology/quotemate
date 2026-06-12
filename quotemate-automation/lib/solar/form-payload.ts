// Pure builder for the /solar/[tenantSlug] form → POST body. Keeps the
// client component dumb and the shape unit-testable. Matches
// SolarEstimateRequestSchema exactly: manual + panel_type are omitted
// when not applicable.

import type { SolarEstimateRequestBody } from './request-schema'

export function buildSolarFormPayload(state: {
  address: string
  postcode: string
  state: string
  manualOpen: boolean
  orientation: string
  roofSize: 'small' | 'medium' | 'large'
  storeys: 1 | 2 | 3
  panelType: 'standard_panels' | 'premium_panels' | 'unknown'
  customerName?: string
  customerMobile?: string
  /** Raw quarterly-bill text from the optional form field (e.g. "850"). */
  quarterlyBill?: string
  /** Quote layout variant (Felt tab spec 2026-06-13). Omitted = instant. */
  variant?: 'instant' | 'felt'
}): SolarEstimateRequestBody {
  const payload: SolarEstimateRequestBody = {
    address: {
      address: state.address.trim(),
      postcode: state.postcode.trim(),
      state: state.state as SolarEstimateRequestBody['address']['state'],
    },
  }
  if (state.manualOpen) {
    payload.manual = {
      orientation: state.orientation as NonNullable<SolarEstimateRequestBody['manual']>['orientation'],
      roof_size: state.roofSize,
      storeys: state.storeys,
    }
  }
  if (state.panelType !== 'unknown') {
    payload.panel_type = state.panelType
  }
  // Optional contact — only include keys the customer actually filled, so an
  // empty field never persists as a blank phone/name.
  const name = state.customerName?.trim()
  const mobile = state.customerMobile?.trim()
  if (name || mobile) {
    payload.customer = {
      ...(name ? { name } : {}),
      ...(mobile ? { mobile } : {}),
    }
  }
  // Optional quarterly bill — parsed leniently ("$850" / "850.50" both
  // work); only a finite positive number within the schema bound is sent,
  // so a blank or junk field never reaches the API.
  const billRaw = state.quarterlyBill?.trim().replace(/^\$/, '')
  if (billRaw) {
    const bill = Number.parseFloat(billRaw)
    if (Number.isFinite(bill) && bill > 0 && bill <= 10_000) {
      payload.energy = { quarterly_bill_aud: bill }
    }
  }
  // The Felt variant rides the SAME engine; only the quote layout + map
  // provisioning differ. 'instant' is the schema default, so omit it.
  if (state.variant === 'felt') {
    payload.variant = 'felt'
  }
  return payload
}
