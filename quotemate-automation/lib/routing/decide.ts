// Three-branch confidence router (wireframe stage 06).
//
// v1 only emits 'tradie_review' or 'inspection_required'. 'auto_send' is
// gated behind V3_AUTOSEND_ENABLED env (default: false) and only fires
// when intake.confidence === 'HIGH' AND no inspection trigger.
//
// In v1 mode the dispatch path doesn't actually gate on this value yet —
// every drafted quote auto-sends today (Path B per current product mode).
// Recording the decision means: when the v1 "tradie reviews → approves"
// gate ships in S07, this column drives the gate. No re-architecture.

export type RoutingDecision =
  | 'auto_send'           // v3 only — high-confidence, no inspection, flag enabled
  | 'tradie_review'       // v1 default — quote held until tradie clicks "Approve & Send"
  | 'inspection_required' // any inspection trigger — paid site visit instead of quote

export type RoutingInput = {
  intake: {
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
    inspection_required: boolean
  }
  quote: {
    needs_inspection: boolean
  }
  /** Override the env-driven default. Useful in tests. */
  v3AutoSendEnabled?: boolean
}

export function decideRouting(input: RoutingInput): RoutingDecision {
  const { intake, quote } = input
  const v3AutoSendEnabled =
    input.v3AutoSendEnabled ?? process.env.V3_AUTOSEND_ENABLED === 'true'

  // Strongest signal wins: anything Stage 04 (intake) or Stage 05 (estimate)
  // marks as inspection-required goes through the paid-site-visit path,
  // regardless of confidence level. Asbestos in pre-1970 ceilings, mains
  // work, switchboard-adjacent jobs, EV chargers, fault finding, renovations.
  if (intake.inspection_required || quote.needs_inspection) {
    return 'inspection_required'
  }

  // HIGH confidence + clean scope = auto-send candidate IF v3 flag is on.
  // In v1 (default V3_AUTOSEND_ENABLED=false) this branch never fires —
  // every non-inspection quote falls through to tradie_review. The
  // confidence field is read here so flipping the flag in v3 is a
  // one-line change rather than a routing rewrite.
  if (intake.confidence === 'HIGH' && v3AutoSendEnabled) {
    return 'auto_send'
  }

  // v1 default: tradie reviews every quote before customer sees it.
  // The "human-in-loop liability shield" from the strategy doc.
  return 'tradie_review'
}
