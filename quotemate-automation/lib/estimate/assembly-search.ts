// Query expansion for the estimator's assembly lookup (lookup_assembly).
//
// The bug this fixes: lookup_assembly was a single `name ILIKE '%query%'`
// substring match. That silently returned ZERO rows whenever the
// estimator searched with the CUSTOMER's wording while the assembly is
// named with TRADE wording. The headline case: the intake job_type is
// literally `power_points`, so the estimator searches "power point" — and
// `ILIKE '%power point%'` never matches the "Replace double GPO"
// assembly. With no candidate, the estimator followed its template rule
// ("no assembly match -> flag_inspection_needed") and escalated a routine
// 2-GPO job to a bogus $99 site visit.
//
// Fix: expand a raw query into a set of ILIKE terms — the full phrase
// (preserves today's exact-match behaviour) + bidirectional synonym-class
// expansion + significant tokens. A wider candidate pool only helps the
// cross-encoder reranker downstream: it scores every candidate against
// the full query and still picks the best one. The pool just has to
// CONTAIN the right assembly — which the old single substring did not.
//
// Pure — no DB, no Next. Unit-tested in assembly-search.test.ts.

/** Bidirectional synonym classes: customer wording <-> trade / catalogue
 *  wording. If ANY member appears in the query, EVERY member of the class
 *  becomes its own ILIKE search term. */
const SYNONYM_CLASSES: readonly (readonly string[])[] = [
  // Electrical
  ['gpo', 'power point', 'powerpoint', 'power-point', 'power outlet', 'wall socket', 'general power outlet'],
  ['downlight', 'down light', 'recessed light'],
  ['ceiling fan', 'exhaust fan', 'fan'],
  ['rcbo', 'safety switch', 'safety breaker'],
  ['switchboard', 'switch board', 'meter board', 'fuse box', 'distribution board'],
  ['smoke alarm', 'smoke detector'],
  ['light switch', 'wall switch'],
  ['ev charger', 'car charger', 'electric vehicle charger', 'wallbox'],
  // Plumbing
  ['hot water', 'hws', 'water heater', 'hot water system', 'hot water unit'],
  ['toilet', 'cistern', 'wc', 'loo'],
  ['tap', 'mixer', 'tapware', 'faucet'],
  ['drain', 'blocked drain', 'blockage'],
]

/** Generic verbs / filler that match too many assemblies to be useful as
 *  a standalone token (the synonym + full-phrase terms carry the signal). */
const STOPWORDS = new Set([
  'install', 'installation', 'installing', 'replace', 'replacement',
  'replacing', 'repair', 'repairing', 'new', 'existing', 'fit', 'fitting',
  'remove', 'removal', 'supply', 'and', 'with', 'for', 'the', 'our', 'my',
  'job', 'work', 'please', 'can', 'you', 'need', 'want', 'some', 'this',
  'that', 'into', 'from', 'have', 'are', 'old', 'has', 'get', 'got',
])

/** PostgREST `.or()` splits on commas / parentheses and treats `%` `*` as
 *  wildcards — strip them from a value so a term can't break the filter. */
function sanitise(term: string): string {
  return term.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Expand a raw lookup query into a deduped list of ILIKE search terms:
 * the full sanitised phrase, every member of any matched synonym class,
 * and each significant (length >= 3, non-stopword) token.
 */
export function expandAssemblyQuery(query: string): string[] {
  const q = (query ?? '').toLowerCase()
  const terms = new Set<string>()

  // The full phrase (lowercased — ILIKE is case-insensitive anyway, and
  // lowercasing keeps dedup consistent). Preserves the original
  // exact-substring behaviour.
  const raw = sanitise(q)
  if (raw) terms.add(raw)

  // Synonym-class expansion — the core fix (power point <-> GPO, etc.).
  for (const cls of SYNONYM_CLASSES) {
    if (cls.some((member) => q.includes(member))) {
      for (const member of cls) terms.add(member)
    }
  }

  // Significant single tokens — broadens recall for non-synonym jobs
  // (e.g. "smoke alarm" -> token "smoke" matches "Hardwired smoke alarm").
  for (const tok of q.split(/[^a-z0-9]+/)) {
    if (tok.length >= 3 && !STOPWORDS.has(tok)) terms.add(tok)
  }

  return [...terms].filter((t) => t.length > 0)
}

/**
 * Build the Supabase `.or()` argument for an assembly NAME search:
 * `name.ilike.%term%,name.ilike.%term%,...`. Falls back to a
 * match-anything clause for an empty query so the caller still returns a
 * pool rather than throwing.
 */
export function buildAssemblyOrFilter(query: string): string {
  const terms = expandAssemblyQuery(query)
  if (terms.length === 0) return 'name.ilike.%%'
  return terms.map((t) => `name.ilike.%${t}%`).join(',')
}

// ─── Phase 1 — job_type → the ONE assembly that owns it ─────────────────
//
// An explicit map, deliberately not an inferred score. Verified against all 26
// seeded electrical rows: name and category cannot pick correctly here.
//   · `downlights` matches `Install LED downlight` (no BOM) AND
//     `Install LED downlight (new install, single-storey)` (has the BOM), so a
//     "prefer the plain base row" rule loses the recipe on the headline job.
//   · `smoke_alarms` has that asymmetry REVERSED — base row holds the BOM.
//   · `power_points` has two BOM-bearing `gpo` rows with equal token overlap.
//   · Only 5 of 10 job types have a categoryForJobType mapping at all.
// Guessing produces a confidently wrong recipe, which is worse than today's
// no-recipe fallback. Each entry is chosen to land on a seeded recipe where one
// exists, and a wrong entry is a one-line fix.
//
// Unmapped on purpose: `switchboard`, `renovation`, `other` have no assembly in
// the catalogue at all and belong on the inspection route.
export const JOB_TYPE_ASSEMBLY: Record<string, string> = {
  downlights: 'Install LED downlight (new install, single-storey)',
  power_points: 'Replace double GPO',
  ceiling_fans: 'Supply + install AC ceiling fan',
  smoke_alarms: 'Hardwire 240V smoke alarm',
  outdoor_lighting: 'Install outdoor IP-rated LED light',
  oven_cooktop: 'Install oven (existing wiring)',
  ev_charger: 'Install EV charger',
  fault_finding: 'Diagnostic call-out (fault finding)',
}

/**
 * Pick the single assembly that owns this job type from a candidate pool.
 *
 * Pure, order-independent, and fails CLOSED: an unmapped job type or a mapped
 * name missing from the pool both return null so the caller falls back to the
 * Opus draft rather than pricing a near-miss.
 */
export function pickBestAssembly<T extends { name: string }>(
  jobType: string | null | undefined,
  rows: readonly T[],
): T | null {
  const wanted = JOB_TYPE_ASSEMBLY[(jobType ?? '').trim()]
  if (!wanted) return null
  const target = wanted.trim().toLowerCase()
  return rows.find((r) => (r.name ?? '').trim().toLowerCase() === target) ?? null
}
