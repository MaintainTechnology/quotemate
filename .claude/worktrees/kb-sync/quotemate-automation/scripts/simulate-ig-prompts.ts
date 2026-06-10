// QuoteMate · simulation — what the IG Engine actually sends to Gemini
//
// Constructs realistic PromptContexts (the same shape the live pipeline
// passes in) and prints the exact system + user messages buildPreviewPromptV2
// and buildSamplePrompts would emit RIGHT NOW with all today's fixes
// applied (Fix #2 sensible-default counts, Fix #3 generic placement,
// Fix #6 V2 samples, WP9 chosen-product photo via line_items.image_path).
//
// Pure read-only — no DB, no API calls. Just the prompt builders against
// hand-constructed inputs.
//
// Run:  npx tsx scripts/simulate-ig-prompts.ts

import {
  buildPreviewPromptV2,
  buildSamplePrompts,
  type PromptContext,
} from '../lib/ig-engine/prompts'

// ── Helpers ─────────────────────────────────────────────────────────
function divider(label: string, char = '═') {
  const line = char.repeat(76)
  console.log(`\n${line}`)
  console.log(`  ${label}`)
  console.log(`${line}\n`)
}
function sub(label: string) {
  console.log(`\n──── ${label} ────────────────────────────────────────────────\n`)
}
function indent(s: string, prefix = '  | ') {
  return s
    .split('\n')
    .map(l => prefix + l)
    .join('\n')
}
function wc(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length
}

// ── Three realistic scenarios ───────────────────────────────────────

// Scenario A — the "6 → 8 smoke alarms" failure case from the eval.
// Electrical, high count, has ordinal placement, customer photo + WP9-style
// catalogue product with an image_path.
const SCENARIO_A: PromptContext = {
  intake: {
    job_type: 'smoke_alarms',
    scope: {
      item_count: 6,
      is_new_install: false,
      description: 'replace the smoke alarms in our house, 3 bedrooms + hallway, 2 storey',
      specs: {},
    },
    access: { ceiling_type: 'flat' },
    property: { bedrooms: 3, levels: 2 },
    caller: { name: 'Mark' },
    trade: 'electrical',
  } as PromptContext['intake'],
  quote: { selected_tier: 'better' },
  lineItems: [
    {
      tier: 'better',
      description: 'Brilliant Smartalert 10-year Photoelectric Smoke Alarm 240V',
      quantity: 6,
      source: 'material',
      image_path: 'catalogue/brilliant-smartalert.jpg',
    },
  ],
  corrections: [],
}

// Scenario B — single-item plumbing replacement.
// Customer didn't state a count ("fix my hot water"), so the intake's
// item_count is undefined; Fix #2's sensible-default fills it as 1.
const SCENARIO_B: PromptContext = {
  intake: {
    job_type: 'hot_water',
    scope: {
      // NO item_count — the customer never stated "1"
      is_new_install: false,
      description: 'my hot water has died, need it replaced, family of 4',
    },
    access: {},
    caller: { name: 'Sarah' },
    trade: 'plumbing',
  } as PromptContext['intake'],
  quote: { selected_tier: 'better' },
  lineItems: [
    {
      tier: 'better',
      description: 'Rheem Stellar 360L Electric Storage Hot Water System',
      quantity: 1,
      source: 'material',
      image_path: 'catalogue/rheem-stellar.jpg',
    },
  ],
  corrections: [],
}

// Scenario C — single-item plumbing repair, NO catalogue photo.
// Tests the path where there's no product reference image — the prompt
// still needs to enforce count + describe the install.
const SCENARIO_C: PromptContext = {
  intake: {
    job_type: 'tap_repair',
    scope: {
      is_new_install: false,
      description: 'dripping tap in the kitchen, started yesterday',
    },
    access: {},
    caller: { name: 'Joe' },
    trade: 'plumbing',
  } as PromptContext['intake'],
  quote: { selected_tier: 'better' },
  lineItems: [
    {
      tier: 'better',
      description: 'Tap washer + service (no anchor photo on file)',
      quantity: 1,
      source: 'material',
      // NO image_path — catalogue row lacks one
    },
  ],
  corrections: [],
}

// ── Run + print ─────────────────────────────────────────────────────
function simulate(label: string, ctx: PromptContext) {
  divider(label)

  sub('Inputs (what the rest of the system handed the IG Engine)')
  console.log(`  job_type:        ${ctx.intake.job_type}`)
  console.log(`  intake.item_count: ${ctx.intake.scope?.item_count ?? '(undefined)'}`)
  console.log(`  is_new_install:  ${ctx.intake.scope?.is_new_install ?? '(undefined)'}`)
  console.log(`  caller:          ${ctx.intake.caller?.name ?? '(none)'}`)
  console.log(`  anchor line:     ${ctx.lineItems?.[0]?.description ?? '(none)'}`)
  console.log(`  anchor image:    ${ctx.lineItems?.[0]?.image_path ?? '(none — no WP4 reference photo will be attached)'}`)

  sub('PREVIEW prompt — what Gemini receives for the customer-photo edit')
  const preview = buildPreviewPromptV2(ctx)
  console.log('SYSTEM (' + wc(preview.system) + ' words):')
  console.log(indent(preview.system))
  console.log('\nUSER (' + wc(preview.user) + ' words):')
  console.log(indent(preview.user))

  sub('SAMPLE prompts — the 3 gallery shots (showing the WIDE shot only)')
  const samples = buildSamplePrompts(ctx, { usePhotoReference: true })
  if (!samples) {
    console.log('  (samples skipped — no prompt set for this job_type)')
  } else {
    console.log('WIDE.system (' + wc(samples.wide.system) + ' words):')
    console.log(indent(samples.wide.system))
    console.log('\nWIDE.user (' + wc(samples.wide.user) + ' words):')
    console.log(indent(samples.wide.user))
    console.log(`\n  (detail.system: ${wc(samples.detail.system)} words · lit.system: ${wc(samples.lit.system)} words — same structure)`)
  }
}

simulate('SCENARIO A — Mark · 6 smoke alarms · replacement · electrical', SCENARIO_A)
simulate('SCENARIO B — Sarah · hot water · no count stated · plumbing', SCENARIO_B)
simulate('SCENARIO C — Joe · tap repair · no count, no anchor photo · plumbing', SCENARIO_C)

divider('END OF SIMULATION', '─')
