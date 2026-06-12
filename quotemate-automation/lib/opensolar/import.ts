// ════════════════════════════════════════════════════════════════════
// OpenSolar project import — the I/O orchestration behind
// POST /api/tenant/opensolar/import (and re-import).
//
// Flow: fetch project (address/contacts + compressed design on the Raw
// Data plan) → fetch systems/details and pick the system → fetch the
// proposal-data slice (best-effort; plan-gated) → run the STC + totals
// guardrails → cache the system-image render and the customer-facing
// generated documents (shade report / energy yield report / PV site
// plan) into Supabase storage (best-effort per asset) → upsert the
// opensolar_proposals row keyed on (tenant_id, project_id, system_uuid).
//
// Re-import resets confirmed_at/pdf_path: the design may have changed in
// OpenSolar studio, so the tradie must review and confirm again — the
// human-in-loop gate is never skipped on changed numbers.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPylonStcAmount, pylonEnabled } from '@/lib/pylon/client'
import {
  decompressOpenSolarDesign,
  downloadOpenSolarAsset,
  extractOpenSolarDocumentUrl,
  fetchOpenSolarProject,
  fetchOpenSolarProposalData,
  fetchOpenSolarSystemDetails,
  fetchOpenSolarSystemImage,
  generateOpenSolarDocument,
  type OpenSolarClientOpts,
  type OpenSolarDocumentType,
} from './client'
import {
  extractOpenSolarProposalSlice,
  generateOpenSolarToken,
  normalizeOpenSolarDesign,
  normalizeOpenSolarProject,
  pickOpenSolarSystem,
  validateOpenSolarProposal,
  type OpenSolarProposalCustomer,
  type OpenSolarProposalDesign,
  type OpenSolarProposalSite,
} from './proposal'

/** Cached OpenSolar artefacts live beside the other solar imagery. */
const BUCKET = 'intake-photos'

/** System-image render size — 2:1.5 matches the proposal figure ratio. */
const IMAGE_W = 1200
const IMAGE_H = 900

export type OpenSolarAssetPaths = {
  system_image_path: string | null
  shade_report_path: string | null
  energy_yield_path: string | null
  site_plan_path: string | null
  /** Install-pack documents are generated lazily from the dashboard. */
  bom_path: string | null
  owners_manual_path: string | null
  financials_path: string | null
  performance_8760_path: string | null
}

export const EMPTY_OPENSOLAR_ASSETS: OpenSolarAssetPaths = {
  system_image_path: null,
  shade_report_path: null,
  energy_yield_path: null,
  site_plan_path: null,
  bom_path: null,
  owners_manual_path: null,
  financials_path: null,
  performance_8760_path: null,
}

export type OpenSolarImportResult =
  | {
      ok: true
      token: string
      flags: string[]
      design: OpenSolarProposalDesign
    }
  | { ok: false; status: number; error: string }

async function uploadAsset(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true })
  if (error) {
    console.warn(`[opensolar/import] asset upload failed (${path}): ${error.message}`)
    return false
  }
  return true
}

/** Best-effort: the authoritative system-image render → storage. */
async function cacheSystemImage(
  supabase: SupabaseClient,
  args: { tenantId: string; projectId: string; systemUuid: string },
  opts: OpenSolarClientOpts,
): Promise<string | null> {
  if (!args.systemUuid) return null
  const res = await fetchOpenSolarSystemImage(
    args.projectId,
    args.systemUuid,
    { width: IMAGE_W, height: IMAGE_H },
    opts,
  )
  if (!res.ok) {
    console.warn(`[opensolar/import] system image fetch failed (${res.code}): ${res.detail}`)
    return null
  }
  const path = `opensolar/${args.tenantId}/${args.projectId}/${args.systemUuid}/system-image.png`
  const ok = await uploadAsset(
    supabase,
    path,
    res.data.bytes,
    res.data.contentType ?? 'image/png',
  )
  return ok ? path : null
}

/** The customer-facing engineering documents cached at import time. */
const CUSTOMER_DOCUMENTS: Array<{
  type: OpenSolarDocumentType
  key: keyof OpenSolarAssetPaths
  filename: string
}> = [
  { type: 'shade_report', key: 'shade_report_path', filename: 'shade-report.pdf' },
  { type: 'energy_yield_report', key: 'energy_yield_path', filename: 'energy-yield-report.pdf' },
  { type: 'pv_site_plan', key: 'site_plan_path', filename: 'pv-site-plan.pdf' },
]

/** Best-effort: generate one OpenSolar document and cache it. */
export async function generateAndCacheOpenSolarDocument(
  supabase: SupabaseClient,
  args: {
    tenantId: string
    projectId: string
    systemUuid: string
    type: OpenSolarDocumentType
    filename: string
  },
  opts: OpenSolarClientOpts = {},
): Promise<string | null> {
  const gen = await generateOpenSolarDocument(
    args.projectId,
    args.type,
    { systemUuid: args.systemUuid || null },
    opts,
  )
  if (!gen.ok) {
    console.warn(`[opensolar/import] ${args.type} generation failed (${gen.code}): ${gen.detail}`)
    return null
  }
  const url = extractOpenSolarDocumentUrl(gen.data)
  if (!url) {
    console.warn(`[opensolar/import] ${args.type} response carried no downloadable URL.`)
    return null
  }
  const dl = await downloadOpenSolarAsset(url, opts)
  if (!dl.ok) {
    console.warn(`[opensolar/import] ${args.type} download failed (${dl.code}): ${dl.detail}`)
    return null
  }
  const path = `opensolar/${args.tenantId}/${args.projectId}/${args.systemUuid}/${args.filename}`
  const contentType =
    dl.data.contentType ?? (args.filename.endsWith('.csv') ? 'text/csv' : 'application/pdf')
  const ok = await uploadAsset(supabase, path, dl.data.bytes, contentType)
  return ok ? path : null
}

/** Best-effort: second-opinion STC quantity via the Pylon calculator
 *  (only when the Pylon client is enabled — same guardrail pattern). */
async function calculatedStcs(
  design: OpenSolarProposalDesign,
  site: OpenSolarProposalSite | null,
): Promise<number | null> {
  if (
    !pylonEnabled({
      PYLON_ENABLED: process.env.PYLON_ENABLED,
      PYLON_API_KEY: process.env.PYLON_API_KEY,
    })
  ) {
    return null
  }
  const kw = design.kw_stc
  const postcode = site?.zip ?? null
  if (!kw || !postcode) return null
  const res = await fetchPylonStcAmount({
    output_kw: kw,
    site_postcode: postcode,
    installation_year: new Date().getFullYear(),
  })
  return res.ok ? res.data.stcs : null
}

/**
 * Import (or re-import) one OpenSolar project system for a tenant.
 * Never throws — returns a result object the route maps to a response.
 */
export async function importOpenSolarProject(
  supabase: SupabaseClient,
  args: { tenantId: string; projectId: string; systemUuid?: string | null },
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarImportResult> {
  // ── 1. Project facts (address, contacts, compressed design) ────────
  const projectRes = await fetchOpenSolarProject(args.projectId, opts)
  if (!projectRes.ok) {
    const status = projectRes.code === 'http_error' && /404/.test(projectRes.detail) ? 404 : 502
    return { ok: false, status, error: `OpenSolar project fetch failed: ${projectRes.detail}` }
  }
  const { customer, site } = normalizeOpenSolarProject(projectRes.data)

  const importWarnings: string[] = []
  const decoded = decompressOpenSolarDesign(projectRes.data.design)
  if (!decoded.ok) {
    importWarnings.push(`design_decode_failed: ${decoded.detail}`)
  } else if (decoded.data === null) {
    importWarnings.push(
      'plan_limited: full design data not exposed (API Access plan) — sections fall back to QuoteMate-modelled figures.',
    )
  }

  // ── 2. Systems/details → pick the system ───────────────────────────
  const detailsRes = await fetchOpenSolarSystemDetails(args.projectId, opts)
  if (!detailsRes.ok) {
    return {
      ok: false,
      status: 502,
      error: `OpenSolar system details fetch failed: ${detailsRes.detail}`,
    }
  }
  const system = pickOpenSolarSystem(detailsRes.data, args.systemUuid ?? null)
  if (!system) {
    return {
      ok: false,
      status: 422,
      error: args.systemUuid
        ? 'That system no longer exists on the OpenSolar project — re-open the picker.'
        : 'The OpenSolar project has no designed systems yet — design one in studio first.',
    }
  }

  // ── 3. Proposal data (Raw Data plan; plan-gated = clean degrade) ────
  let proposalSlice = null
  const proposalRes = await fetchOpenSolarProposalData(args.projectId, opts)
  if (proposalRes.ok) {
    proposalSlice = extractOpenSolarProposalSlice(
      proposalRes.data,
      args.projectId,
      typeof system.uuid === 'string' ? system.uuid : null,
    )
  } else if (proposalRes.code === 'plan') {
    importWarnings.push(
      'plan_limited: proposal data requires Raw Data API Access — financials are QuoteMate-modelled.',
    )
  } else {
    console.warn(
      `[opensolar/import] proposal data fetch failed (${proposalRes.code}): ${proposalRes.detail}`,
    )
  }

  const design = normalizeOpenSolarDesign({
    projectId: args.projectId,
    system,
    proposalSlice,
    importWarnings,
  })

  // ── 4. Guardrails (flag, never fix) ─────────────────────────────────
  const stcs = await calculatedStcs(design, site)
  const flags = validateOpenSolarProposal(design, stcs)

  // ── 5. Asset caching (best-effort per asset) ────────────────────────
  const assets: OpenSolarAssetPaths = { ...EMPTY_OPENSOLAR_ASSETS }
  assets.system_image_path = await cacheSystemImage(
    supabase,
    { tenantId: args.tenantId, projectId: args.projectId, systemUuid: design.system_uuid },
    opts,
  )
  for (const doc of CUSTOMER_DOCUMENTS) {
    assets[doc.key] = await generateAndCacheOpenSolarDocument(
      supabase,
      {
        tenantId: args.tenantId,
        projectId: args.projectId,
        systemUuid: design.system_uuid,
        type: doc.type,
        filename: doc.filename,
      },
      opts,
    )
  }

  // ── 6. Upsert keyed on (tenant, project, system) — re-import keeps
  //       the public token and resets the confirm gate ────────────────
  const { data: existing } = await supabase
    .from('opensolar_proposals')
    .select('id, public_token')
    .eq('tenant_id', args.tenantId)
    .eq('opensolar_project_id', args.projectId)
    .eq('opensolar_system_uuid', design.system_uuid)
    .maybeSingle()

  const token = (existing?.public_token as string | undefined) ?? generateOpenSolarToken()
  const row = {
    tenant_id: args.tenantId,
    public_token: token,
    opensolar_project_id: args.projectId,
    opensolar_system_uuid: design.system_uuid,
    title: design.system_name,
    address_text: site.address_text,
    customer: customer satisfies OpenSolarProposalCustomer,
    site,
    design,
    assets,
    flags,
    status: flags.length > 0 ? 'flagged' : 'awaiting_confirmation',
    confirmed_at: null,
    paid_at: null,
    pdf_path: null,
    stripe_checkout_url: null,
    updated_at: new Date().toISOString(),
  }

  const result = existing
    ? await supabase.from('opensolar_proposals').update(row).eq('id', existing.id)
    : await supabase.from('opensolar_proposals').insert(row)
  if (result.error) {
    return { ok: false, status: 500, error: `Proposal save failed: ${result.error.message}` }
  }

  return { ok: true, token, flags, design }
}
