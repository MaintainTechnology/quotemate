// c:/Users/dalig/Downloads/QuoteMate/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/compliance-copy.ts
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
export const SOLAR_PRE_CONFIRM_COPY = 'Your installer will confirm this estimate.'
