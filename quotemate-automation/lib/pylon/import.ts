// ════════════════════════════════════════════════════════════════════
// Pylon design import — the I/O orchestration behind
// POST /api/tenant/pylon/import (and re-import).
//
// Flow: fetch design → fetch its solar_project (customer/site, best-
// effort) → enrich component SKUs with datasheets (best-effort) → run
// the STC + totals guardrails → cache the snapshot / single-line-diagram
// / site-info assets into Supabase storage (best-effort per asset) →
// upsert the pylon_proposals row keyed on (tenant_id, pylon_design_id).
//
// Re-import resets confirmed_at/pdf_path: the design may have changed in
// Pylon studio, so the tradie must review and confirm again — the human-
// in-loop gate is never skipped on changed numbers.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  downloadPylonAsset,
  fetchPylonComponent,
  fetchPylonSolarDesign,
  fetchPylonSolarProject,
  fetchPylonStcAmount,
  type PylonClientOpts,
  type PylonComponentKind,
} from './client'
import {
  designProjectId,
  generatePylonToken,
  normalizePylonDesign,
  normalizePylonProject,
  validatePylonProposal,
  type PylonProposalCustomer,
  type PylonProposalDesign,
  type PylonProposalSite,
} from './proposal'

/** Cached Pylon artefacts live beside the other solar imagery. */
const BUCKET = 'intake-photos'

export type PylonAssetPaths = {
  snapshot_path: string | null
  sld_path: string | null
  site_info_path: string | null
}

export type PylonImportResult =
  | {
      ok: true
      token: string
      flags: string[]
      design: PylonProposalDesign
    }
  | { ok: false; status: number; error: string }

/** The asset kinds we cache, with their design-summary source URL. */
function assetSources(design: PylonProposalDesign): Array<{
  key: keyof PylonAssetPaths
  url: string | null
  filename: string
  fallbackContentType: string
}> {
  return [
    {
      key: 'snapshot_path',
      url: design.summary.latest_snapshot_url,
      filename: 'snapshot.jpg',
      fallbackContentType: 'image/jpeg',
    },
    {
      key: 'sld_path',
      url: design.summary.single_line_diagram_pdf_url,
      filename: 'single-line-diagram.pdf',
      fallbackContentType: 'application/pdf',
    },
    {
      key: 'site_info_path',
      url: design.summary.pv_site_information_url,
      filename: 'pv-site-information.pdf',
      fallbackContentType: 'application/pdf',
    },
  ]
}

/** Best-effort: cache each Pylon artefact into storage; null on failure. */
async function cacheAssets(
  supabase: SupabaseClient,
  args: { tenantId: string; designId: string; design: PylonProposalDesign },
  opts: PylonClientOpts,
): Promise<PylonAssetPaths> {
  const paths: PylonAssetPaths = { snapshot_path: null, sld_path: null, site_info_path: null }
  for (const src of assetSources(args.design)) {
    if (!src.url) continue
    const res = await downloadPylonAsset(src.url, opts)
    if (!res.ok) {
      console.warn(`[pylon/import] asset ${src.key} fetch failed (${res.code}): ${res.detail}`)
      continue
    }
    const path = `pylon/${args.tenantId}/${args.designId}/${src.filename}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, res.data.bytes, {
        contentType: res.data.contentType ?? src.fallbackContentType,
        upsert: true,
      })
    if (error) {
      console.warn(`[pylon/import] asset ${src.key} upload failed: ${error.message}`)
      continue
    }
    paths[src.key] = path
  }
  return paths
}

/** Best-effort: enrich module/inverter/battery components with datasheets. */
async function enrichComponents(
  design: PylonProposalDesign,
  opts: PylonClientOpts,
): Promise<void> {
  const lookups = design.components
    .filter(
      (c): c is typeof c & { sku: string; kind: PylonComponentKind } =>
        !!c.sku && (c.kind === 'module' || c.kind === 'inverter' || c.kind === 'battery'),
    )
    .map(async (c) => {
      const res = await fetchPylonComponent(c.kind, c.sku, opts)
      if (res.ok) c.datasheet = res.data
    })
  await Promise.all(lookups)
}

/** Best-effort: Pylon's own STC calculator for the cross-check guardrail. */
async function calculatedStcs(
  design: PylonProposalDesign,
  site: PylonProposalSite | null,
  opts: PylonClientOpts,
): Promise<number | null> {
  const kw = design.summary.dc_output_kw
  const postcode = site?.address.zip ?? null
  if (!kw || !postcode) return null
  const res = await fetchPylonStcAmount(
    {
      output_kw: kw,
      site_postcode: postcode,
      installation_year: new Date().getFullYear(),
    },
    opts,
  )
  return res.ok ? res.data.stcs : null
}

/**
 * Import (or re-import) one Pylon design for a tenant. Never throws —
 * returns a result object the route maps straight to a response.
 */
export async function importPylonDesign(
  supabase: SupabaseClient,
  args: { tenantId: string; designId: string },
  opts: PylonClientOpts = {},
): Promise<PylonImportResult> {
  const designRes = await fetchPylonSolarDesign(args.designId, opts)
  if (!designRes.ok) {
    const status = designRes.code === 'http_error' && /404/.test(designRes.detail) ? 404 : 502
    return { ok: false, status, error: `Pylon design fetch failed: ${designRes.detail}` }
  }

  const design = normalizePylonDesign(designRes.data)
  if (!design.pylon_design_id) {
    return { ok: false, status: 502, error: 'Pylon design payload carried no id.' }
  }

  // Customer + site come from the project relationship (best-effort —
  // a missing project still imports; the proposal just lacks the name).
  let customer: PylonProposalCustomer | null = null
  let site: PylonProposalSite | null = null
  let projectId: string | null = designProjectId(designRes.data)
  if (projectId) {
    const projectRes = await fetchPylonSolarProject(projectId, opts)
    if (projectRes.ok) {
      const normalized = normalizePylonProject(projectRes.data)
      customer = normalized.customer
      site = normalized.site
    } else {
      console.warn(`[pylon/import] project fetch failed (${projectRes.code}): ${projectRes.detail}`)
      projectId = projectId ?? null
    }
  }

  // Datasheets + STC check + assets are all best-effort enrichment.
  await enrichComponents(design, opts)
  const stcs = await calculatedStcs(design, site, opts)
  const flags = validatePylonProposal(design, stcs)
  const assets = await cacheAssets(
    supabase,
    { tenantId: args.tenantId, designId: design.pylon_design_id, design },
    opts,
  )

  // Upsert keyed on (tenant_id, pylon_design_id) — re-import refreshes the
  // same row, keeps its public token, and resets the confirm gate.
  const { data: existing } = await supabase
    .from('pylon_proposals')
    .select('id, public_token')
    .eq('tenant_id', args.tenantId)
    .eq('pylon_design_id', design.pylon_design_id)
    .maybeSingle()

  const token = (existing?.public_token as string | undefined) ?? generatePylonToken()
  const row = {
    tenant_id: args.tenantId,
    public_token: token,
    pylon_design_id: design.pylon_design_id,
    pylon_project_id: projectId,
    title: design.label ?? design.title,
    address_text: site?.address_text ?? null,
    customer,
    site,
    design,
    assets,
    flags,
    status: flags.length > 0 ? 'flagged' : 'awaiting_confirmation',
    confirmed_at: null,
    pdf_path: null,
    updated_at: new Date().toISOString(),
  }

  const result = existing
    ? await supabase.from('pylon_proposals').update(row).eq('id', existing.id)
    : await supabase.from('pylon_proposals').insert(row)
  if (result.error) {
    return { ok: false, status: 500, error: `Proposal save failed: ${result.error.message}` }
  }

  return { ok: true, token, flags, design }
}
