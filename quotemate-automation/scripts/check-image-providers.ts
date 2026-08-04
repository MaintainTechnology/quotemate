// ════════════════════════════════════════════════════════════════════
// Which image provider does each trade actually render with?
//
// The 2026-08-04 consolidation put every trade on Gemini. The failure mode
// it guards against is SILENT: a leftover ROOFING_IMAGE_PROVIDER=huggingface
// or IG_IMAGE_PROVIDER=replicate in the environment still produces a
// perfectly good image — just not from Gemini — and nothing logs it. So this
// resolves each trade through THE REAL SELECTOR the trade's code calls
// (never a reimplementation of the rules) and fails if any lands elsewhere.
//
//   node --env-file=.env.local --import tsx scripts/check-image-providers.ts
//   node --env-file=.env.local --import tsx scripts/check-image-providers.ts --live
//
// Without --live this is a routing check: it proves selection, not that the
// Gemini key works. --live additionally renders one real image per trade
// through that trade's resolved provider and reports who served it — the
// only check that actually satisfies "an image per trade came from Gemini".
// It costs real Gemini quota (~8 renders), so it is opt-in.
// ════════════════════════════════════════════════════════════════════

import sharp from 'sharp'
import { resolveEditImageProvider } from '../lib/ig-engine/providers/edit-select'
import { selectImageProvider, imageGenReadiness } from '../lib/ig-engine/providers/select'
import { geminiProvider } from '../lib/ig-engine/providers/gemini'
import type { ImageProvider } from '../lib/ig-engine/providers/base'

const EXPECTED = 'gemini'

type Mode = 'edit' | 'text' | 'none'

type TradeCheck = {
  trade: string
  /** Where the render actually happens — so a failure points at a file. */
  site: string
  mode: Mode
  /** Resolved exactly the way the call site resolves it. null = no provider
   *  configured at all (the call site would skip the render). */
  provider: () => ImageProvider | null
}

// Mirrors every image-GENERATION call site in the app. Vision/detect paths
// (detect-material, detect-solar, layout-plan, judge, verify) are deliberately
// absent — they classify images, they do not generate them.
const TRADES: TradeCheck[] = [
  {
    trade: 'electrical',
    site: 'lib/ig-engine/generate.ts + samples.ts (SMS preview/samples)',
    mode: 'text',
    provider: () => selectImageProvider(),
  },
  {
    trade: 'plumbing',
    site: 'lib/ig-engine/generate.ts + samples.ts (SMS preview/samples)',
    mode: 'text',
    provider: () => selectImageProvider(),
  },
  {
    trade: 'roofing',
    site: 'lib/roofing/roof-after.ts + showcase-render.ts',
    mode: 'edit',
    provider: () => resolveEditImageProvider(process.env.ROOFING_IMAGE_PROVIDER),
  },
  {
    trade: 'roofing (3D model)',
    site: 'lib/roofing/model3d.ts — imports geminiProvider directly',
    mode: 'edit',
    provider: () => geminiProvider,
  },
  {
    trade: 'solar',
    site: 'lib/solar/panels-after.ts — imports geminiProvider directly',
    mode: 'edit',
    provider: () => geminiProvider,
  },
  {
    trade: 'painting',
    site: 'lib/painting/paint-after.ts + app/api/painting/preview/{,refine/}route.ts',
    mode: 'edit',
    provider: () => resolveEditImageProvider(process.env.PAINTING_IMAGE_PROVIDER),
  },
  {
    trade: 'commercial_painting',
    site: 'app/api/tenant/commercial-painting/preview/route.ts',
    mode: 'edit',
    provider: () => resolveEditImageProvider(process.env.PAINTING_IMAGE_PROVIDER),
  },
  {
    trade: 'aircon',
    site: '— no image-generation path (plan upload + sizing only)',
    mode: 'none',
    provider: () => null,
  },
  {
    trade: 'signage',
    site: '— no image-generation path (photo assessment only)',
    mode: 'none',
    provider: () => null,
  },
]

/** A small real photo-ish PNG so the edit path has a valid source image. */
async function syntheticSource() {
  const base64 = (
    await sharp({
      create: { width: 256, height: 256, channels: 3, background: { r: 150, g: 160, b: 170 } },
    })
      .png()
      .toBuffer()
  ).toString('base64')
  return { base64, mime: 'image/png' }
}

async function liveRender(check: TradeCheck, provider: ImageProvider) {
  const req =
    check.mode === 'edit'
      ? {
          system: 'You edit photographs in place.',
          user: 'Leave the image essentially as-is; adjust the tone very slightly.',
          sourceImage: await syntheticSource(),
        }
      : { system: 'You generate photographs.', user: 'A plain grey studio backdrop.' }

  const started = Date.now()
  const out = await provider.renderImage(req)
  const kb = Math.round(Buffer.from(out.base64, 'base64').length / 1024)
  return `${kb} KB ${out.mime} in ${((Date.now() - started) / 1000).toFixed(1)}s`
}

async function main() {
  const live = process.argv.includes('--live')
  const rows: string[] = []
  const failures: string[] = []

  // Readiness of the text-to-image path is reported separately: selection can
  // say "gemini" while the credential is missing, which skips the render.
  const readiness = imageGenReadiness()
  if (!readiness.ready) {
    failures.push(`text-to-image path not ready: ${readiness.reason}`)
  }

  for (const check of TRADES) {
    if (check.mode === 'none') {
      rows.push(`  ${check.trade.padEnd(20)} n/a       ${check.site}`)
      continue
    }

    const provider = check.provider()
    if (!provider) {
      failures.push(`${check.trade}: NO provider configured — ${check.site} would skip the render`)
      rows.push(`  ${check.trade.padEnd(20)} NONE      ${check.site}`)
      continue
    }

    if (provider.name !== EXPECTED) {
      failures.push(
        `${check.trade}: resolves to '${provider.name}', expected '${EXPECTED}' — ${check.site}`,
      )
    }

    let detail = check.site
    if (live && provider.name === EXPECTED) {
      try {
        detail = await liveRender(check, provider)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(`${check.trade}: live render failed via ${provider.name} — ${msg}`)
        detail = `LIVE RENDER FAILED: ${msg}`
      }
    }
    rows.push(`  ${check.trade.padEnd(20)} ${provider.name.padEnd(9)} ${detail}`)
  }

  console.log(`\nImage generation provider per trade${live ? ' (live renders)' : ''}:\n`)
  console.log(`  ${'TRADE'.padEnd(20)} ${'PROVIDER'.padEnd(9)} ${live ? 'RESULT' : 'CALL SITE'}`)
  console.log(rows.join('\n'))

  // Overrides are the whole reason a trade silently drifts off Gemini — name
  // any that are set, whatever they are set to.
  const overrides = ['IG_IMAGE_PROVIDER', 'ROOFING_IMAGE_PROVIDER', 'PAINTING_IMAGE_PROVIDER']
    .map((k) => [k, process.env[k]?.trim()] as const)
    .filter(([, v]) => v)
  console.log(
    overrides.length
      ? `\nActive overrides: ${overrides.map(([k, v]) => `${k}=${v}`).join(', ')}`
      : '\nActive overrides: none (every trade takes the Gemini default)',
  )

  if (failures.length) {
    console.error(`\n✗ ${failures.length} problem(s):`)
    for (const f of failures) console.error(`  · ${f}`)
    process.exit(1)
  }
  console.log(
    `\n✓ every image-generating trade routes to ${EXPECTED}${live ? ' and rendered' : ''}.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
