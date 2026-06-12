// ════════════════════════════════════════════════════════════════════
// Solar — pure SVG chart builders (premium quote spec §4.2).
//
// Four deterministic figures shared verbatim by /q/solar/[token] and the
// Gotenberg PDF (theme-parameterised: dark page, light print):
//
//   1. Monthly production bars — seasonal AU curve scaled to the tier's
//      annual_kwh_ac. The shape is MODELLED (southern-hemisphere
//      insolation profile; monthly flux rasters are deferred) and every
//      caption says so.
//   2. Utility costs — annual bill before vs with solar.
//   3. Monthly bill comparison — before vs with-solar by month (solar
//      offset follows the same seasonal shape).
//   4. Cumulative savings line — the 25-year projection series from
//      financial-summary.ts (degradation + escalation applied).
//
// Numbers are rendered with AU formatting; tabular figures; no
// animation (print-safe). PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type ChartTheme = 'dark' | 'light'

type Palette = {
  text: string
  textStrong: string
  grid: string
  bar: string
  barAlt: string
  line: string
  fill: string
}

const PALETTES: Record<ChartTheme, Palette> = {
  dark: {
    text: '#8e9aa8',
    textStrong: '#e8edf3',
    grid: '#27313d',
    bar: '#FF5F00',
    barAlt: '#2DD4BF',
    line: '#FF5F00',
    fill: 'rgba(255,95,0,0.14)',
  },
  light: {
    text: '#6b7683',
    textStrong: '#16202b',
    grid: '#e6ebf0',
    bar: '#FF5F00',
    barAlt: '#0f766e',
    line: '#FF5F00',
    fill: 'rgba(255,95,0,0.10)',
  },
}

export const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const

// Southern-hemisphere modelled monthly insolation weights (Jan → Dec),
// normalised at module load so the twelve fractions sum to exactly 1.
const RAW_MONTH_WEIGHTS = [
  10.5, 9.2, 9.2, 7.7, 6.2, 5.5, 6.3, 7.5, 8.5, 9.5, 9.7, 10.6,
] as const
const WEIGHT_SUM = RAW_MONTH_WEIGHTS.reduce((a, b) => a + b, 0)

/** Normalised AU seasonal production shape — fractions summing to 1. */
export const AU_MONTHLY_PRODUCTION_SHAPE: readonly number[] = RAW_MONTH_WEIGHTS.map(
  (w) => w / WEIGHT_SUM,
)

export type SolarChart = {
  svg: string
  caption: string
}

const aud0 = (n: number) =>
  '$' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-AU')

const int = (n: number) =>
  Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-AU')

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── 1. Monthly production bars ───────────────────────────────────────

export function buildMonthlyProductionChart(args: {
  annual_kwh_ac: number
  theme: ChartTheme
  /** Real per-month series (Jan → Dec, kWh) when the design exposes one
   *  (e.g. OpenSolar output_monthly). Falls back to the modelled AU
   *  seasonal shape when absent — the caption states which was used. */
  monthly_kwh?: number[] | null
}): SolarChart | null {
  const { annual_kwh_ac } = args
  if (!Number.isFinite(annual_kwh_ac) || annual_kwh_ac <= 0) return null
  const pal = PALETTES[args.theme]

  const real =
    args.monthly_kwh &&
    args.monthly_kwh.length === 12 &&
    args.monthly_kwh.every((v) => Number.isFinite(v) && v >= 0) &&
    args.monthly_kwh.some((v) => v > 0)
      ? args.monthly_kwh
      : null
  const monthly = real ?? AU_MONTHLY_PRODUCTION_SHAPE.map((f) => annual_kwh_ac * f)
  const max = Math.max(...monthly)

  const W = 640
  const H = 240
  const padL = 46
  const padR = 12
  const padT = 18
  const padB = 30
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const slot = plotW / 12
  const barW = slot * 0.62

  const parts: string[] = []
  parts.push(gridLines({ max, padL, padT, plotW, plotH, pal, format: int, unit: ' kWh' }))

  monthly.forEach((v, i) => {
    const h = (v / max) * plotH
    const x = padL + i * slot + (slot - barW) / 2
    const y = padT + plotH - h
    parts.push(
      `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(barW)}" height="${r2(h)}" fill="${pal.bar}"/>`,
    )
    parts.push(
      `<text x="${r2(padL + i * slot + slot / 2)}" y="${H - 12}" text-anchor="middle" ` +
        `font-family="monospace" font-size="10" fill="${pal.text}">${MONTH_LABELS[i]}</text>`,
    )
  })

  return {
    svg: wrapSvg(
      parts,
      W,
      H,
      `${real ? 'Designed' : 'Modelled'} monthly production, ${int(annual_kwh_ac)} kWh per year total`,
    ),
    caption: real
      ? `Month-by-month production from your designed system — ${int(annual_kwh_ac)} kWh/yr total.`
      : `Modelled seasonal shape scaled to ${int(annual_kwh_ac)} kWh/yr — ` +
        'month-by-month figures are indicative, not metered.',
  }
}

// ── 2. Utility costs before / with solar ─────────────────────────────

export function buildUtilityCostsChart(args: {
  annual_bill_before_aud: number
  annual_bill_with_solar_aud: number
  source: 'personal' | 'modelled'
  theme: ChartTheme
}): SolarChart | null {
  const before = args.annual_bill_before_aud
  const withSolar = args.annual_bill_with_solar_aud
  if (!Number.isFinite(before) || before <= 0) return null
  const pal = PALETTES[args.theme]

  const W = 640
  const H = 200
  const padL = 56
  const padT = 18
  const padB = 44
  const plotH = H - padT - padB
  const max = Math.max(before, withSolar, 1)

  const bars: Array<{ label: string; value: number; color: string }> = [
    { label: 'Before solar', value: before, color: pal.barAlt },
    { label: 'With solar', value: Math.max(0, withSolar), color: pal.bar },
  ]

  const parts: string[] = []
  parts.push(gridLines({ max, padL, padT, plotW: W - padL - 12, plotH, pal, format: aud0, unit: '/yr' }))

  const slot = (W - padL - 12) / bars.length
  const barW = Math.min(140, slot * 0.5)
  bars.forEach((b, i) => {
    const h = (b.value / max) * plotH
    const x = padL + i * slot + (slot - barW) / 2
    const y = padT + plotH - h
    parts.push(
      `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(barW)}" height="${r2(h)}" fill="${b.color}"/>`,
    )
    parts.push(
      `<text x="${r2(x + barW / 2)}" y="${r2(Math.max(padT + 10, y - 6))}" text-anchor="middle" ` +
        `font-family="monospace" font-size="12" font-weight="700" fill="${pal.textStrong}">` +
        `${aud0(b.value)}</text>`,
    )
    parts.push(
      `<text x="${r2(x + barW / 2)}" y="${H - 24}" text-anchor="middle" ` +
        `font-family="monospace" font-size="10" fill="${pal.text}">${esc(b.label.toUpperCase())}</text>`,
    )
  })

  const credit = withSolar < 0
  const creditNote = credit ? ` With-solar figure is a net credit of ${aud0(Math.abs(withSolar))}/yr.` : ''

  return {
    svg: wrapSvg(
      parts,
      W,
      H,
      `Annual electricity costs: ${aud0(before)} before solar, ${aud0(withSolar)} with solar`,
    ),
    caption:
      (args.source === 'personal'
        ? 'Personalised from the quarterly bill you provided.'
        : 'Modelled on typical usage — add your quarterly bill for a personal figure.') + creditNote,
  }
}

// ── 3. Monthly bill comparison ───────────────────────────────────────

export function buildMonthlyBillComparisonChart(args: {
  annual_bill_before_aud: number
  annual_bill_with_solar_aud: number
  source: 'personal' | 'modelled'
  theme: ChartTheme
}): SolarChart | null {
  const before = args.annual_bill_before_aud
  const withSolar = args.annual_bill_with_solar_aud
  if (!Number.isFinite(before) || before <= 0) return null
  const pal = PALETTES[args.theme]

  // Monthly model: consumption is flat (before ÷ 12); the solar offset
  // follows the seasonal production shape, so summer months show deeper
  // cuts. Negative months are a credit; bars clamp at zero.
  const monthlyBefore = before / 12
  const totalOffset = before - withSolar
  const monthlyWith = AU_MONTHLY_PRODUCTION_SHAPE.map(
    (f) => monthlyBefore - totalOffset * f,
  )

  const W = 640
  const H = 240
  const padL = 50
  const padR = 12
  const padT = 18
  const padB = 30
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const slot = plotW / 12
  const pairW = slot * 0.7
  const barW = pairW / 2

  const max = Math.max(monthlyBefore, ...monthlyWith.map((v) => Math.max(0, v)), 1)

  const parts: string[] = []
  parts.push(gridLines({ max, padL, padT, plotW, plotH, pal, format: aud0, unit: '/mo' }))

  monthlyWith.forEach((withV, i) => {
    const x0 = padL + i * slot + (slot - pairW) / 2
    const hBefore = (monthlyBefore / max) * plotH
    parts.push(
      `<rect x="${r2(x0)}" y="${r2(padT + plotH - hBefore)}" width="${r2(barW)}" ` +
        `height="${r2(hBefore)}" fill="${pal.barAlt}" opacity="0.85"/>`,
    )
    const hWith = (Math.max(0, withV) / max) * plotH
    parts.push(
      `<rect x="${r2(x0 + barW)}" y="${r2(padT + plotH - hWith)}" width="${r2(barW)}" ` +
        `height="${r2(hWith)}" fill="${pal.bar}"/>`,
    )
    parts.push(
      `<text x="${r2(padL + i * slot + slot / 2)}" y="${H - 12}" text-anchor="middle" ` +
        `font-family="monospace" font-size="10" fill="${pal.text}">${MONTH_LABELS[i]}</text>`,
    )
  })

  return {
    svg: wrapSvg(
      parts,
      W,
      H,
      'Monthly electricity bill, before solar vs with solar',
    ),
    caption:
      (args.source === 'personal'
        ? 'Personalised from the quarterly bill you provided. '
        : 'Modelled on typical usage. ') +
      'Teal = before solar, orange = with solar; summer months cut deepest.',
  }
}

// ── 4. Cumulative savings line (25-year projection) ──────────────────

export type SavingsSeriesPoint = { year: number; cumulative_aud: number }

export function buildCumulativeSavingsChart(args: {
  series: SavingsSeriesPoint[]
  /** Net system cost — drawn as a break-even reference line. */
  net_cost_aud?: number | null
  theme: ChartTheme
}): SolarChart | null {
  const series = (args.series ?? []).filter(
    (p) => Number.isFinite(p.year) && Number.isFinite(p.cumulative_aud),
  )
  if (series.length < 2) return null
  const pal = PALETTES[args.theme]

  const W = 640
  const H = 240
  const padL = 64
  const padR = 16
  const padT = 18
  const padB = 30
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const last = series[series.length - 1]
  const net = args.net_cost_aud != null && args.net_cost_aud > 0 ? args.net_cost_aud : null
  const max = Math.max(last.cumulative_aud, net ?? 0, 1)
  const years = last.year

  const xFor = (year: number) => padL + (year / years) * plotW
  const yFor = (v: number) => padT + plotH - (v / max) * plotH

  const parts: string[] = []
  parts.push(gridLines({ max, padL, padT, plotW, plotH, pal, format: aud0, unit: '' }))

  // Area fill + line.
  const linePts = series.map((p) => `${r2(xFor(p.year))},${r2(yFor(p.cumulative_aud))}`)
  parts.push(
    `<polygon points="${r2(padL)},${r2(padT + plotH)} ${linePts.join(' ')} ` +
      `${r2(xFor(last.year))},${r2(padT + plotH)}" fill="${pal.fill}"/>`,
  )
  parts.push(
    `<polyline points="${linePts.join(' ')}" fill="none" stroke="${pal.line}" ` +
      `stroke-width="2.5" stroke-linejoin="round"/>`,
  )

  // Break-even reference: the net system cost.
  if (net != null && net <= max) {
    const y = yFor(net)
    parts.push(
      `<line x1="${padL}" y1="${r2(y)}" x2="${padL + plotW}" y2="${r2(y)}" ` +
        `stroke="${pal.textStrong}" stroke-width="1" stroke-dasharray="5 4" opacity="0.7"/>`,
    )
    parts.push(
      `<text x="${padL + plotW}" y="${r2(y - 6)}" text-anchor="end" ` +
        `font-family="monospace" font-size="10" fill="${pal.textStrong}">` +
        `SYSTEM COST ${aud0(net)}</text>`,
    )
  }

  // X-axis year ticks every 5 years.
  for (let yr = 0; yr <= years; yr += 5) {
    parts.push(
      `<text x="${r2(xFor(yr))}" y="${H - 12}" text-anchor="middle" ` +
        `font-family="monospace" font-size="10" fill="${pal.text}">${yr === 0 ? 'YR 0' : yr}</text>`,
    )
  }

  // Endpoint marker + value.
  parts.push(
    `<circle cx="${r2(xFor(last.year))}" cy="${r2(yFor(last.cumulative_aud))}" r="3.5" fill="${pal.line}"/>`,
  )
  parts.push(
    `<text x="${r2(xFor(last.year) - 6)}" y="${r2(Math.max(padT + 12, yFor(last.cumulative_aud) - 10))}" ` +
      `text-anchor="end" font-family="monospace" font-size="12" font-weight="700" ` +
      `fill="${pal.textStrong}">${aud0(last.cumulative_aud)}</text>`,
  )

  return {
    svg: wrapSvg(
      parts,
      W,
      H,
      `Cumulative savings over ${years} years, reaching ${aud0(last.cumulative_aud)}`,
    ),
    caption:
      `Modelled cumulative savings over ${years} years, with panel degradation and ` +
      'electricity price escalation applied. A projection, not a guarantee.',
  }
}

// ── shared helpers ───────────────────────────────────────────────────

function gridLines(args: {
  max: number
  padL: number
  padT: number
  plotW: number
  plotH: number
  pal: Palette
  format: (n: number) => string
  unit: string
}): string {
  const { max, padL, padT, plotW, plotH, pal, format, unit } = args
  const lines: string[] = []
  const STEPS = 4
  for (let i = 0; i <= STEPS; i++) {
    const v = (max / STEPS) * i
    const y = padT + plotH - (v / max) * plotH
    lines.push(
      `<line x1="${padL}" y1="${r2(y)}" x2="${padL + plotW}" y2="${r2(y)}" ` +
        `stroke="${pal.grid}" stroke-width="1"/>`,
    )
    lines.push(
      `<text x="${padL - 6}" y="${r2(y + 3.5)}" text-anchor="end" ` +
        `font-family="monospace" font-size="9.5" fill="${pal.text}">` +
        `${format(v)}${i === STEPS ? unit : ''}</text>`,
    )
  }
  return lines.join('')
}

function wrapSvg(parts: string[], w: number, h: number, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${w}" height="${h}" role="img" aria-label="${esc(label)}">` +
    parts.join('') +
    `</svg>`
  )
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}
