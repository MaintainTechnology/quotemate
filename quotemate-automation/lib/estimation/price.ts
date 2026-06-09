// Deterministic, grounded pricer for an electrical plan take-off.
//
// Turns counted items into an indicative estimate using the SAME math as the
// estimate engine, but as a pure function with NO LLM in the price path:
//   material line = count × unit_price_ex_gst × (1 + markup)
//   labour line   = count × labour_hours × hourly_rate     (labour isn't marked up)
//   + min-labour floor, + GST when the tenant is registered.
//
// Prices are GROUNDED: every priced line maps to a real assembly row passed in
// (shared_assemblies + tenant_custom_assemblies). Anything that doesn't match a
// catalogue assembly is returned UNMATCHED (flagged for manual) — never guessed.

export type AssemblyRow = {
  name: string
  category?: string | null
  default_unit_price_ex_gst: number
  default_labour_hours: number
  default_unit?: string | null
}

export type PricingBook = {
  hourly_rate: number
  default_markup_pct: number
  min_labour_hours?: number | null
  gst_registered?: boolean | null
}

export type TakeoffItem = { type: string; count: number }

export type PricedLine = {
  type: string
  count: number
  matched: string // assembly name
  unitPriceExGst: number // marked-up per-unit material price
  materialExGst: number
  labourHours: number
  labourExGst: number
  lineExGst: number
}

export type PricedBom = {
  lines: PricedLine[]
  unmatched: { type: string; count: number }[]
  materialExGst: number
  labourExGst: number
  labourFloorAddedExGst: number
  subtotalExGst: number
  gstExGst: number
  totalIncGst: number
  gstRegistered: boolean
  assumptions: { hourlyRate: number; markupPct: number; minLabourHours: number }
}

const round2 = (n: number) => Math.round(n * 100) / 100

function norm(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Curated electrical "signal" phrases. An AI item type matches an assembly when
// they share a signal. Multi-word signals are listed before the bare word so the
// specific match wins (e.g. "ceiling fan"/"exhaust fan" beat a bare "fan", which
// is intentionally absent to avoid cross-matching ceiling vs exhaust fans).
const SIGNALS = [
  'recessed downlight', 'led downlight', 'downlight',
  'power point', 'power outlet', 'general power outlet', 'double gpo', 'single gpo', 'gpo',
  'ceiling fan', 'exhaust fan',
  'smoke alarm', 'smoke detector',
  'data outlet', 'data point', 'comms outlet', 'data',
  'hot water',
  'oven', 'cooktop', 'rangehood',
  'switchboard', 'distribution board', 'switch board',
  'exit sign', 'emergency light', 'emergency',
  'outdoor', 'flood light', 'wall light', 'batten', 'led strip',
  'ceiling rose', 'isolator', 'tv point', 'antenna',
]

/** Best-matching assembly for an item type, or null when nothing matches.
 *  Score = total length of signals shared by the item type and the assembly
 *  name/category; longest-signal-overlap wins, first assembly breaks ties. */
export function matchAssembly(type: string, assemblies: AssemblyRow[]): AssemblyRow | null {
  const t = norm(type)
  if (!t) return null
  let best: AssemblyRow | null = null
  let bestScore = 0
  for (const a of assemblies) {
    const hay = `${norm(a.name)} ${norm(a.category ?? '')}`
    let score = 0
    for (const sig of SIGNALS) {
      if (t.includes(sig) && hay.includes(sig)) score += sig.length
    }
    if (score > bestScore) {
      bestScore = score
      best = a
    }
  }
  return bestScore > 0 ? best : null
}

/** Price a take-off against the catalogue + pricing book. Pure + deterministic. */
export function priceTakeoff(
  items: TakeoffItem[],
  assemblies: AssemblyRow[],
  book: PricingBook,
): PricedBom {
  const markup = 1 + (Number(book.default_markup_pct) || 0) / 100
  const hourly = Number(book.hourly_rate) || 0
  const minLabour = Number(book.min_labour_hours ?? 0) || 0
  const gstRegistered = book.gst_registered !== false

  const lines: PricedLine[] = []
  const unmatched: { type: string; count: number }[] = []
  let materialExGst = 0
  let labourExGst = 0
  let labourHoursTotal = 0

  for (const it of items ?? []) {
    const count = Math.max(0, Math.round(Number(it.count) || 0))
    const match = matchAssembly(it.type, assemblies)
    if (!match || count === 0) {
      if (count > 0) unmatched.push({ type: it.type, count })
      continue
    }
    const unitPrice = round2((Number(match.default_unit_price_ex_gst) || 0) * markup)
    const material = round2(count * unitPrice)
    const labourHours = round2(count * (Number(match.default_labour_hours) || 0))
    const labour = round2(labourHours * hourly)
    materialExGst += material
    labourExGst += labour
    labourHoursTotal += labourHours
    lines.push({
      type: it.type,
      count,
      matched: match.name,
      unitPriceExGst: unitPrice,
      materialExGst: material,
      labourHours,
      labourExGst: labour,
      lineExGst: round2(material + labour),
    })
  }

  // Min-labour floor: never underprice a small job on labour. Pure labour only.
  const labourFloorAddedExGst =
    lines.length > 0 && labourHoursTotal < minLabour - 0.05
      ? round2((minLabour - labourHoursTotal) * hourly)
      : 0

  const subtotalExGst = round2(materialExGst + labourExGst + labourFloorAddedExGst)
  const gstExGst = gstRegistered ? round2(subtotalExGst * 0.1) : 0
  const totalIncGst = round2(subtotalExGst + gstExGst)

  return {
    lines,
    unmatched,
    materialExGst: round2(materialExGst),
    labourExGst: round2(labourExGst),
    labourFloorAddedExGst,
    subtotalExGst,
    gstExGst,
    totalIncGst,
    gstRegistered,
    assumptions: { hourlyRate: hourly, markupPct: Number(book.default_markup_pct) || 0, minLabourHours: minLabour },
  }
}
