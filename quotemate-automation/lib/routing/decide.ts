// Three-branch confidence router (wireframe stage 06).
//
// Emits 'auto_send', 'tradie_review', or 'inspection_required'. Auto-send is
// gated, in order, by: (1) no inspection trigger, (2) HIGH intake confidence,
// (3) the job_type being on the AUTO_SEND_JOBTYPES allowlist (R2 — empty by
// default, which is also the R21 kill switch), and (4) the per-tenant /
// per-job-type deploy gate passing (R23). Absent any of these, the quote falls
// through to 'tradie_review' — the human-in-loop liability shield. This means
// auto-send is OFF by default and earned job-type by job-type, never global.

export type RoutingDecision =
  | 'auto_send'           // allowlisted + deploy-gate-passing + HIGH-confidence + no inspection
  | 'tradie_review'       // default — quote held until tradie clicks "Approve & Send"
  | 'inspection_required' // any inspection trigger — paid site visit instead of quote

/**
 * R23 — the per-tenant / per-job-type deploy gate. A job-type may auto-send
 * only when EVERY condition holds. Supplied by the dispatch path from measured
 * state; when omitted, auto-send cannot fire (fail-closed).
 */
export type DeployGate = {
  /** determinism diff = 0 on the replay set for this job-type. */
  determinismDiffZero: boolean
  /** ≥80% of this trade's eval pairs land in band. */
  evalInBand: boolean
  /** grounding validator fired 0 times on the replay set. */
  validatorFireZero: boolean
  /** sanity-bounds pass for this job-type. */
  sanityBoundsPass: boolean
  /** the tenant has confirmed its rates + catalogue (tenants.pricing_confirmed_at set). */
  pricingConfirmed: boolean
}

export type RoutingInput = {
  intake: {
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
    inspection_required: boolean
    /** job_type drives the R2 allowlist check. */
    job_type?: string | null
  }
  quote: {
    needs_inspection: boolean
  }
  /** R2 — the auto-send allowlist. Defaults to parsing AUTO_SEND_JOBTYPES from
   *  the env (CSV). An empty list disables auto-send entirely (kill switch). */
  autoSendJobTypes?: string[]
  /** R23 — deploy-gate state for this tenant+job-type. Omitted ⇒ auto-send
   *  cannot fire (fail-closed). */
  deployGate?: DeployGate
  /** R7 — the quote's pricing_path. Auto-send requires 'deterministic'; an
   *  'opus_fallback' (or absent) price is never auto-sent. */
  pricingPath?: string | null
  /** Emergency hard-off override (test/ops). When explicitly false, never
   *  auto-send regardless of the allowlist. */
  v3AutoSendEnabled?: boolean
}

/** Parse the AUTO_SEND_JOBTYPES CSV env into a normalised allowlist. */
export function parseAutoSendJobTypes(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return String(env.AUTO_SEND_JOBTYPES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/** R23 — every gate condition must hold. Returns the list of failed gates (empty = pass). */
export function failedDeployGates(gate: DeployGate | undefined): string[] {
  if (!gate) return ['deploy_gate_absent']
  const failed: string[] = []
  if (!gate.determinismDiffZero) failed.push('determinism_diff_nonzero')
  if (!gate.evalInBand) failed.push('eval_below_band')
  if (!gate.validatorFireZero) failed.push('validator_fired')
  if (!gate.sanityBoundsPass) failed.push('sanity_bounds_failed')
  if (!gate.pricingConfirmed) failed.push('pricing_unconfirmed')
  return failed
}

export type RoutingResult = {
  decision: RoutingDecision
  /** Why auto-send was withheld (allowlist miss, failed gate names, etc.). */
  reasons: string[]
}

/** Full decision + reasons (for observability — R27). */
export function decideRoutingDetailed(input: RoutingInput): RoutingResult {
  const { intake, quote } = input

  // Strongest signal wins: any inspection trigger goes through the paid
  // site-visit path regardless of confidence.
  if (intake.inspection_required || quote.needs_inspection) {
    return { decision: 'inspection_required', reasons: ['inspection_trigger'] }
  }

  const reasons: string[] = []
  const allowlist = input.autoSendJobTypes ?? parseAutoSendJobTypes()
  const jobType = (intake.job_type ?? '').trim().toLowerCase()
  const jobAllowed = jobType.length > 0 && allowlist.includes(jobType)

  if (input.v3AutoSendEnabled === false) reasons.push('auto_send_hard_off')
  if (intake.confidence !== 'HIGH') reasons.push('confidence_not_high')
  if (!jobAllowed) reasons.push(jobType ? 'job_type_not_allowlisted' : 'job_type_missing')
  // R7 — only a deterministically-priced quote may auto-send (an Opus-priced or
  // unknown-path quote is held for tradie review even if everything else passes).
  if (input.pricingPath !== 'deterministic') reasons.push('pricing_path_not_deterministic')
  const gateFails = failedDeployGates(input.deployGate)
  reasons.push(...gateFails)

  if (reasons.length === 0) return { decision: 'auto_send', reasons: [] }
  return { decision: 'tradie_review', reasons }
}

export function decideRouting(input: RoutingInput): RoutingDecision {
  return decideRoutingDetailed(input).decision
}
