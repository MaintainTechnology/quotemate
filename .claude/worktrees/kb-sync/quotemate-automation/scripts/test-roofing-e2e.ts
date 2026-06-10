// End-to-end roofing pipeline test: REAL Geoscape measurement + env-driven
// Google Solar pitch enrichment, exactly as production runs it.
//
//   node --env-file=.env.local --import tsx scripts/test-roofing-e2e.ts
//   node --env-file=.env.local --import tsx scripts/test-roofing-e2e.ts "12 Smith St, Penrith NSW 2750" 2750 NSW
//
// Proves the bit the Solar smoke test skipped: Geoscape resolves the
// building → its footprint centroid is handed to the Solar API → measured
// pitch overrides the declared bucket → flows into the price. Calling with
// NO solar opts means it reads ROOFING_SOLAR_ENRICHMENT + the key from the
// env, i.e. the real production path.

import { measureAndPriceRoof, measureAndPriceRoofs } from '../lib/roofing/measure'
import type { RoofAddressInput, RoofUserInputs } from '../lib/roofing/types'

const argv = process.argv.slice(2)
const address: RoofAddressInput =
  argv.length >= 3
    ? { address: argv[0], postcode: argv[1], state: argv[2] as RoofAddressInput['state'] }
    : { address: '670 London Rd, Chandler QLD 4155', postcode: '4155', state: 'QLD' }

// Declare 'standard' deliberately, so if the measured pitch differs we see
// the override fire.
const inputs: RoofUserInputs = {
  material: 'colorbond_trimdek',
  pitch: 'standard',
  intent: 'full_reroof',
  building_year_built: null,
}

function flags() {
  return [
    `ROOFING_SOLAR_ENRICHMENT=${process.env.ROOFING_SOLAR_ENRICHMENT ?? '(unset)'}`,
    `GEOSCAPE_API_KEY=${process.env.GEOSCAPE_API_KEY ? 'set' : 'MISSING'}`,
    `GOOGLE_MAPS_API_KEY=${process.env.GOOGLE_MAPS_API_KEY ? 'set' : 'MISSING'}`,
  ].join('  ')
}

function printMetrics(m: any) {
  console.log(`   footprint      : ${m.footprint_m2} m²`)
  console.log(`   sloped area    : ${m.sloped_area_m2 ?? '—'} m²`)
  console.log(`   form / storeys : ${m.form} / ${m.storeys ?? '?'}`)
  console.log(`   PITCH SOURCE   : ${m.pitch_source ?? '(declared/legacy)'}`)
  if (m.pitch_source === 'measured') {
    console.log(`   measured pitch : ${m.pitch_degrees}°  · imagery ${m.imagery_date ?? 'n/a'} · ${m.imagery_quality ?? 'n/a'} · ${m.roof_segment_count ?? '?'} planes`)
  }
}

async function main() {
  console.log(`\nFlags: ${flags()}`)
  console.log(`Address: ${address.address}\n`)

  console.log('── single-structure (measureAndPriceRoof) ─────────────────────')
  const single = await measureAndPriceRoof(address, inputs)
  if (!single.ok) {
    console.log(`❌ ${single.code}: ${single.detail}`)
  } else {
    console.log(`✅ provider=${single.provider}`)
    printMetrics(single.metrics)
    console.log(`   routing        : ${single.price.routing.decision}`)
    console.log(`   tiers (inc GST): ${single.price.tiers.map((t) => `${t.tier} $${t.inc_gst}`).join('  ')}`)
    if (single.warnings.length) {
      console.log('   warnings:')
      for (const w of single.warnings) console.log(`     • ${w}`)
    }
  }

  console.log('\n── multi-structure (measureAndPriceRoofs) ─────────────────────')
  const multi = await measureAndPriceRoofs(address, inputs)
  if (!multi.ok) {
    console.log(`❌ ${multi.code}: ${multi.detail}`)
  } else {
    console.log(`✅ provider=${multi.provider} · ${multi.quote.structures.length} structure(s)`)
    for (const s of multi.quote.structures) {
      console.log(`\n  [${s.role}] ${s.label}`)
      printMetrics(s.metrics)
    }
    if (multi.warnings.length) {
      console.log('\n   warnings:')
      for (const w of multi.warnings) console.log(`     • ${w}`)
    }
  }
  console.log('\nDone.')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
