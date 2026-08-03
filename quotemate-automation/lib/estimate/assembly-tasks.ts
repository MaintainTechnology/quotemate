// Phase 4 R9, the task half — a step can depend on the product.
//
// Migration 184 created shared_assembly_tasks and tenant_assembly_tasks, gave
// them a CRUD API and a dashboard panel, and stopped. Nothing in lib/estimate
// ever read them, so a checklist a tradie curated never reached a quote, and
// R9's second acceptance scenario — "a smart product adds its dimmer part AND
// its pairing task" — had only the part half (185/186).
//
// Migration 188 added include_when to both tables. This module is the estimator
// side: pick the right list, then filter it against the product that actually
// landed on the tier.
//
// ONE EVALUATOR FOR PARTS AND STEPS. shouldIncludeLine is reused verbatim
// rather than reimplemented, so the unknown rule cannot drift between them: a
// REQUIRED step survives an unevaluable condition (never silently drop a step a
// job needs), an OPTIONAL one does not (never add a step nobody established).
// Two copies of that asymmetry would eventually disagree, and the disagreement
// would be invisible.
//
// Pure and I/O-free — the caller loads the rows.

import { shouldIncludeLine } from './catalogue'

export type AssemblyTask = {
  title: string
  notes?: string | null
  required?: boolean | null
  sort?: number | null
  include_when?: Record<string, unknown> | null
}

/** What lands on a tier. Deliberately narrow: a quote carries the step, not the
 *  row's id or timestamps. */
export type QuoteTask = {
  title: string
  notes?: string | null
  required: boolean
}

/**
 * The steps for this job, given the product that priced it.
 *
 * `tenantTasks` wins outright when non-empty — the same "the tradie's own beats
 * the shared baseline" precedence the recipe (tenant_assembly_bom over
 * shared_assembly_bom) and the catalogue already use. NOT merged: a tradie who
 * has written their own checklist has said what the job is, and silently
 * appending shared steps would put words in their mouth.
 *
 * `productProperties` is the HEADLINE product's attributes, matching the BOM
 * side — the smart thing is the downlight, not the dimmer.
 */
export function resolveAssemblyTasks(input: {
  tenantTasks?: readonly AssemblyTask[] | null
  sharedTasks?: readonly AssemblyTask[] | null
  productProperties?: Record<string, unknown> | null
}): QuoteTask[] {
  const tenant = (input.tenantTasks ?? []).filter((t) => String(t?.title ?? '').trim() !== '')
  const shared = (input.sharedTasks ?? []).filter((t) => String(t?.title ?? '').trim() !== '')
  const chosen = tenant.length > 0 ? tenant : shared
  if (chosen.length === 0) return []

  return [...chosen]
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
    .filter((t) =>
      shouldIncludeLine(t.include_when, input.productProperties, t.required ?? true),
    )
    .map((t) => ({
      title: String(t.title).trim(),
      ...(t.notes && String(t.notes).trim() !== '' ? { notes: String(t.notes).trim() } : {}),
      required: t.required ?? true,
    }))
}
