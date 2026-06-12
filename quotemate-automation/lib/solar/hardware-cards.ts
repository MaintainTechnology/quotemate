// PURE view helper — customer-facing hardware cards from the Pylon
// supplement (supplements build 2026-06-13) and the OpenSolar catalogue
// supplement (enrichment build 2026-06-13). Strips the INTERNAL price
// fields: the customer sees brand / series / model + the manufacturer
// datasheet link, never the tradie's component costs.
//
// Source precedence per component kind: the tenant's NOMINATED Pylon
// SKUs win (deliberate choices with datasheets); the OpenSolar activated
// catalogue fills any kind Pylon didn't cover (real products with
// wattage / technology / warranty detail).

import type { SolarEstimateContext } from './types'

export type SolarHardwareCard = {
  /** Customer-facing component label, e.g. "Solar panels". */
  kindLabel: string
  /** Headline name (datasheet name, else brand + model). */
  name: string
  /** Secondary line: brand · series · model, when distinct from name. */
  detail: string | null
  datasheetUrl: string | null
}

const KIND_LABEL: Record<string, string> = {
  module: 'Solar panels',
  inverter: 'Inverter',
  battery: 'Battery storage',
}

export function buildSolarHardwareCards(
  context: Pick<SolarEstimateContext, 'pylon_components' | 'opensolar'>,
): SolarHardwareCard[] {
  const components = context.pylon_components ?? []
  const cards: SolarHardwareCard[] = []
  const coveredKinds = new Set<string>()
  for (const c of components) {
    const detailParts = [c.brand, c.series, c.model_number].filter(
      (p): p is string => !!p && p.length > 0,
    )
    const name = c.name ?? (detailParts.length > 0 ? detailParts.join(' ') : null)
    if (!name) continue
    const detail = detailParts.join(' · ')
    cards.push({
      kindLabel: KIND_LABEL[c.kind] ?? c.kind,
      name,
      detail: detail && detail !== name ? detail : null,
      datasheetUrl: c.datasheet_url,
    })
    coveredKinds.add(c.kind)
  }

  // OpenSolar catalogue fills the kinds Pylon didn't cover.
  for (const h of context.opensolar?.hardware ?? []) {
    if (coveredKinds.has(h.kind)) continue
    const name = [h.manufacturer, h.code].filter(Boolean).join(' ')
    if (!name) continue
    const detail = [
      h.kw_stc != null ? `${Math.round(h.kw_stc * 1000)} W` : null,
      h.technology,
      h.product_warranty_years != null ? `${h.product_warranty_years}-yr warranty` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    cards.push({
      kindLabel: KIND_LABEL[h.kind] ?? h.kind,
      name,
      detail: detail || null,
      datasheetUrl: null,
    })
  }
  return cards
}
