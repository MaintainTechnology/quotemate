// Diagnostic — rebuild the EXACT panel-marked plan + prompts that
// generateSolarPanelsImage would send to Gemini for one estimate token,
// WITHOUT calling Gemini. Saves the marked frame next to the repo so a
// human can count the rectangles.
// Usage: npx tsx --env-file=.env.local scripts/debug-solar-marked-plan.ts <public_token>

import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '../lib/roofing/google-maps'
import { buildPanelMarkupPaths } from '../lib/solar/panel-marked-map'
import {
  deriveSolarLayoutFacts,
  buildSolarBoxReplacementPrompt,
} from '../lib/solar/panels-after-prompt'
import { resolveSolarOverlayCenter } from '../lib/solar/static-map-center'
import type { SolarEstimate } from '../lib/solar/types'

async function main() {
const token = process.argv[2]
if (!token) throw new Error('usage: debug-solar-marked-plan.ts <public_token>')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const { data: row } = await supabase
  .from('solar_estimates')
  .select('id, address, estimate')
  .eq('public_token', token)
  .maybeSingle()
if (!row) throw new Error('estimate not found')

const estimate = row.estimate as SolarEstimate
const headlineTier = estimate.sizing.tiers[estimate.sizing.tiers.length - 1]
console.log('address:', row.address)
console.log('headline tier:', headlineTier.tier, '| panels_count:', headlineTier.panels_count, '| kW:', headlineTier.system_kw_dc)
console.log('roof.panels[] available:', (estimate.roof.panels ?? []).length)

const center = resolveSolarOverlayCenter({
  roof: estimate.roof,
  location: estimate.context.location ?? null,
})
if (!center) throw new Error('no center')

const markupPaths = buildPanelMarkupPaths({
  panels: estimate.roof.panels ?? [],
  planes: estimate.roof.planes,
  panel_size_m: estimate.roof.panel_size_m ?? null,
  panel_limit: headlineTier.panels_count,
})
console.log('marked-plan rectangles:', markupPaths.length)

const markedUrl = buildStaticMapUrl(
  { center, zoom: 20, size: { width: 640, height: 480 }, paths: markupPaths },
  { apiKey: process.env.GOOGLE_MAPS_API_KEY! },
)
console.log('static-map URL length:', markedUrl.length)
const res = await fetch(markedUrl)
console.log('static-map HTTP:', res.status)
if (res.ok) {
  writeFileSync('debug-marked-plan.png', Buffer.from(await res.arrayBuffer()))
  console.log('saved debug-marked-plan.png')
}

const layout = deriveSolarLayoutFacts({
  panels: estimate.roof.panels ?? [],
  planes: estimate.roof.planes,
  center,
  panel_limit: headlineTier.panels_count,
  panel_size_m: estimate.roof.panel_size_m ?? null,
})
console.log('\nlayout facts:', JSON.stringify(layout, null, 2))

const prompt = buildSolarBoxReplacementPrompt({
  panelsCount: headlineTier.panels_count,
  systemKwDc: headlineTier.system_kw_dc,
  layout,
})
console.log('\n── SYSTEM PROMPT ──\n' + prompt.system)
console.log('\n── USER PROMPT ──\n' + prompt.user)
}

main().catch((e) => { console.error(e); process.exit(1) })
