// c:/Users/dalig/Downloads/QuoteMax/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/compliance-copy.ts
// Mandatory compliance copy for /q/solar/[token] (spec §6). This text is
// a regulatory requirement — keep it verbatim. compliance-copy.test.ts
// asserts each mandated fragment so a weakening edit fails CI.
//
// The en-dash in "Council–approved" and the ampersands are intentional
// and match the spec wording exactly.

export const SOLAR_COMPLIANCE_COPY =
  'Final system designed & installed by a Solar Accreditation Australia ' +
  '(SAA)-accredited installer using Clean Energy Council–approved ' +
  'components. STC rebate subject to eligibility & install date. ' +
  'Estimate, not a contract.'

/** Shown in place of the deposit CTA before the tradie confirms. */
export const SOLAR_PRE_CONFIRM_COPY =
  'We have estimated the system size and output. Your installer will review the price before it is released.'

// ── Premium-quote copy (spec 2026-06-12 §4.3) ─────────────────────────

/** Must accompany every 20-year financial summary / projection chart. */
export const SOLAR_PROJECTION_COPY =
  'Savings projections are modelled estimates, not financial advice or a ' +
  'guarantee. They apply the panel degradation, electricity price ' +
  'escalation and discount rates listed in the assumptions table; your ' +
  'actual bills depend on your usage, tariff changes and weather.'

/** Must accompany the deterministic panel-layout figure. */
export const SOLAR_LAYOUT_COPY =
  'Panel positions are drawn from Google Solar API roof geometry — an ' +
  'engineering-grade starting point, finalised by your installer at site.'

/** Must accompany the environmental section. */
export const SOLAR_ENVIRONMENTAL_COPY =
  'Carbon figures use the grid emissions factor reported for your area ' +
  'and the tree/vehicle equivalence constants listed in the assumptions.'
