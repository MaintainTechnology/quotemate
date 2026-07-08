// Line items a tier opens with in the editor. Solar quotes-row tiers store
// only {label, subtotal_ex_gst} (lib/solar/persist-helpers.ts:84-95) — no
// line_items — so without a seed the editor opened empty and every save
// failed the edit route's min-1-line schema (400). The seed is a single
// whole-of-job line whose total equals the engine subtotal, so the route's
// recomputed subtotal (edit/route.ts:281-283) round-trips unchanged.

export type SeedableLineItem = {
  description: string
  quantity: number
  unit?: string
  unit_price_ex_gst: number
  total_ex_gst?: number
  source?: string
  supplied_by?: 'tradie' | 'customer'
  safety_note?: string
}

export function seedLineItems(tier: {
  label?: string | null
  subtotal_ex_gst?: number | null
  line_items?: SeedableLineItem[] | null
}): SeedableLineItem[] {
  const stored = tier.line_items
  if (stored && stored.length > 0) return stored
  const subtotal = Number(tier.subtotal_ex_gst)
  if (!Number.isFinite(subtotal) || subtotal <= 0) return []
  return [
    {
      description: tier.label?.trim() ? `${tier.label.trim()} — as quoted` : 'Job as quoted',
      quantity: 1,
      unit: 'job',
      unit_price_ex_gst: subtotal,
    },
  ]
}
