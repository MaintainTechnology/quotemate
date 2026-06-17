// ════════════════════════════════════════════════════════════════════
// Solar — AI "panels installed" concept preview.
//
// Takes the SAME Google Maps satellite aerial we show on the quote page
// as the SOURCE image and asks Gemini (image-to-image) to render the
// quoted system installed — exactly the headline tier's panel count on
// the primary-orientation plane(s), footprint and surroundings
// unchanged. The result is cached on solar_estimates.panels_image_path
// (intake-photos bucket) and served via the token-gated
// /api/solar/q/[token]/panels-after proxy.
//
// The satellite hero stays a REAL photo (spec §1, §6) — this concept is
// a separate, clearly-labelled image. Google-coverage estimates only:
// the manual path has no trustworthy aerial to edit.
//
// The prompt builder is PURE + unit-tested (panels-after-prompt.ts).
// generateSolarPanelsImage does the I/O (fetch satellite → Gemini →
// storage) and is best-effort: any failure records
// panels_image_status='failed' and the page simply omits the concept.
// Mirrors lib/roofing/roof-after.ts (CAS claim, never throws).
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'
import {
  buildSolarPanelsAfterPrompt,
  buildSolarBoxReplacementPrompt,
  deriveSolarLayoutFacts,
  CLEAN_REFERENCE_LABEL,
} from './panels-after-prompt'
import { buildPanelMarkupPaths } from './panel-marked-map'
import { resolveSolarOverlayCenter } from './static-map-center'
import type { SolarEstimate } from './types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = 'intake-photos'

export type SolarPanelsImageStatus = 'idle' | 'generating' | 'ready' | 'failed'

export type SolarPanelsImageResult =
  | { ok: true; path: string }
  | { ok: false; status: 'busy' | 'failed' | 'skipped'; error?: string }

/**
 * Generate (or no-op) the AI "panels installed" concept for one saved
 * estimate. CAS-claims panels_image_status so two concurrent triggers
 * don't both call Gemini. Best-effort: never throws; records 'failed'.
 */
export async function generateSolarPanelsImage(
  token: string,
): Promise<SolarPanelsImageResult> {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, status: 'skipped', error: 'GEMINI_API_KEY missing' }
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return { ok: false, status: 'skipped', error: 'GOOGLE_MAPS_API_KEY missing' }
  }

  const { data: row } = await supabase
    .from('solar_estimates')
    .select('id, address, estimate, panels_image_status, panels_image_path')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return { ok: false, status: 'skipped', error: 'not_found' }
  if (row.panels_image_status === 'ready' && row.panels_image_path) {
    return { ok: true, path: row.panels_image_path as string }
  }

  const estimate = (row.estimate ?? null) as SolarEstimate | null
  if (!estimate) return { ok: false, status: 'skipped', error: 'no_estimate' }

  // Manual-declared roofs have no trustworthy aerial to edit, and an
  // unsized roof has no panel count to render.
  if (estimate.coverage_source !== 'google') {
    return { ok: false, status: 'skipped', error: 'manual_coverage' }
  }
  const headlineTier = estimate.sizing.tiers[estimate.sizing.tiers.length - 1]
  if (!headlineTier) return { ok: false, status: 'skipped', error: 'no_tiers' }

  // CAS claim — only proceed if nobody else is mid-generation.
  const { data: claimed } = await supabase
    .from('solar_estimates')
    .update({ panels_image_status: 'generating' })
    .eq('public_token', token)
    .or('panels_image_status.is.null,panels_image_status.eq.idle,panels_image_status.eq.failed')
    .select('id')
    .maybeSingle()
  if (!claimed) return { ok: false, status: 'busy' }

  try {
    // SAME centre the hero static map + the deterministic layout/string
    // figures use (panel centroid → polygon → geocode), so the per-plane
    // region descriptions in the prompt match the source frame exactly.
    const center = resolveSolarOverlayCenter({
      roof: estimate.roof,
      location: estimate.context.location ?? null,
    })
    const address = (row.address as string | null) ?? undefined
    if (!center && !address) throw new Error('no_location')

    // No marker pin — the render needs a clean source canvas.
    const target = buildStaticMapUrl(
      {
        address: center ? undefined : address,
        center: center ?? undefined,
        zoom: 20,
        size: { width: 640, height: 480 },
      },
      { apiKey: process.env.GOOGLE_MAPS_API_KEY! },
    )
    const satRes = await fetch(target)
    if (!satRes.ok) throw new Error(`satellite fetch ${satRes.status}`)
    const satMime = satRes.headers.get('content-type') ?? 'image/png'
    const satBytes = Buffer.from(await satRes.arrayBuffer())

    // Ground the render on the SAME per-plane distribution the Proposed
    // Panel Layout / string figures draw (premium quote §4.2): plane,
    // count, rows, photo region, rectangle orientation. Empty for
    // pre-premium rows → the builder falls back to orientation-only.
    const layout = center
      ? deriveSolarLayoutFacts({
          panels: estimate.roof.panels ?? [],
          planes: estimate.roof.planes,
          center,
          panel_limit: headlineTier.panels_count,
          prefer_contiguous_layout: true,
          panel_size_m: estimate.roof.panel_size_m ?? null,
        })
      : []

    // PANEL-MARKED PLAN — the strongest grounding: the same aerial with
    // every panel rectangle drawn at its exact geo position by Static
    // Maps (identical shapes to the layout-overlay figure). In
    // box-replacement mode this marked frame IS the source image Gemini
    // edits — pure local replacement (rectangle → panel) is far more
    // compliant than transferring positions across images. Best-effort:
    // a fetch miss degrades to the legacy clean-photo + text brief.
    let markedPlan: { base64: string; mime: string } | null = null
    const markupPaths = center
      ? buildPanelMarkupPaths({
          panels: estimate.roof.panels ?? [],
          planes: estimate.roof.planes,
          panel_size_m: estimate.roof.panel_size_m ?? null,
          panel_limit: headlineTier.panels_count,
          prefer_contiguous_layout: true,
        })
      : []
    if (markupPaths.length > 0 && center) {
      try {
        const markedUrl = buildStaticMapUrl(
          {
            center,
            zoom: 20,
            size: { width: 640, height: 480 },
            paths: markupPaths,
          },
          { apiKey: process.env.GOOGLE_MAPS_API_KEY! },
        )
        const markedRes = await fetch(markedUrl)
        if (markedRes.ok) {
          markedPlan = {
            base64: Buffer.from(await markedRes.arrayBuffer()).toString('base64'),
            mime: markedRes.headers.get('content-type') ?? 'image/png',
          }
        } else {
          console.warn('[solar/panels-after] marked-map fetch failed', markedRes.status)
        }
      } catch (e) {
        console.warn(
          '[solar/panels-after] marked-map skipped (non-fatal)',
          e instanceof Error ? e.message : e,
        )
      }
    }

    let out: { base64: string; mime: string }
    if (markedPlan) {
      // DIRECT box-replacement (simplified 2026-06-13): the Proposed
      // Panel Layout frame IS the source image; the short prompt tells
      // the editor to turn each rectangle into a real-size panel. No
      // vision pre-step — the drawn boxes are the instruction.
      const prompt = buildSolarBoxReplacementPrompt({
        panelsCount: headlineTier.panels_count,
        systemKwDc: headlineTier.system_kw_dc,
        panelSizeM: estimate.roof.panel_size_m ?? null,
      })
      out = await geminiProvider.renderImage({
        system: prompt.system,
        user: prompt.user,
        // SOURCE = the marked plan (edit these pixels);
        // REFERENCE = the clean photo (match it outside the panels).
        sourceImage: markedPlan,
        reference: {
          label: CLEAN_REFERENCE_LABEL,
          image: { base64: satBytes.toString('base64'), mime: satMime },
        },
        aspectRatio: '4:3',
      })
    } else {
      // Legacy path (no geometry / marked frame unavailable): edit the
      // clean photo with the text-grounded brief.
      const prompt = buildSolarPanelsAfterPrompt({
        panelsCount: headlineTier.panels_count,
        systemKwDc: headlineTier.system_kw_dc,
        orientation: estimate.roof.primary_orientation,
        layout,
      })
      out = await geminiProvider.renderImage({
        system: prompt.system,
        user: prompt.user,
        sourceImage: { base64: satBytes.toString('base64'), mime: satMime },
        aspectRatio: '4:3',
      })
    }

    const ext = out.mime === 'image/jpeg' ? 'jpg' : 'png'
    const path = `solar/${row.id}/panels-after-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(out.base64, 'base64'), { contentType: out.mime, upsert: false })
    if (upErr) throw new Error(`storage upload: ${upErr.message}`)

    await supabase
      .from('solar_estimates')
      .update({ panels_image_path: path, panels_image_status: 'ready' })
      .eq('public_token', token)
    return { ok: true, path }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[solar/panels-after] generation failed', { token, error })
    await supabase
      .from('solar_estimates')
      .update({ panels_image_status: 'failed' })
      .eq('public_token', token)
    return { ok: false, status: 'failed', error }
  }
}
