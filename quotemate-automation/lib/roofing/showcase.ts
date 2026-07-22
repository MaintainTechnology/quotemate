// ════════════════════════════════════════════════════════════════════
// Thank-you page 3D showcase — pure data + validation.
//
// Everything a customer can influence on the showcase arrives as a URL slug
// (their own tap, or a friend's forwarded link that may have been edited by
// hand). Nothing here trusts its input: every resolver falls back to a safe
// default rather than throwing or passing a raw string through to a shader,
// a storage path, or a render prompt.
//
// Pure — no DB, no three.js, no Supabase. Unit-tested in showcase.test.ts.
// ════════════════════════════════════════════════════════════════════

import type { RoofMaterial } from './types'

export type Swatch = {
  /** URL-safe identifier — what travels in the query string. */
  slug: string
  /** What the customer reads. Real AU market names, not invented ones. */
  name: string
  /** Tint applied to the three.js shader uniform. */
  hex: string
}

/**
 * Roof colours. Real COLORBOND names — the range a roofer actually quotes —
 * rather than a free `<input type="color">`. A customer picking #ff00ff for
 * their roof is not a useful outcome, and a named colour is something they can
 * repeat back to the tradie at the site visit.
 *
 * Monument leads: every re-roof render the system has produced was hardcoded
 * to "a clean charcoal finish" (roof-after-prompt.ts:12-15), so it is the
 * honest default state.
 */
export const ROOF_COLOUR_SWATCHES: readonly Swatch[] = [
  { slug: 'monument', name: 'Monument', hex: '#323233' },
  { slug: 'woodland-grey', name: 'Woodland Grey', hex: '#4b4c46' },
  { slug: 'basalt', name: 'Basalt', hex: '#6d6c6e' },
  { slug: 'shale-grey', name: 'Shale Grey', hex: '#b6b5ae' },
  { slug: 'surfmist', name: 'Surfmist', hex: '#e4e2d5' },
  { slug: 'ironstone', name: 'Ironstone', hex: '#3e434c' },
  { slug: 'manor-red', name: 'Manor Red', hex: '#5e1d18' },
  { slug: 'classic-cream', name: 'Classic Cream', hex: '#e6dcc0' },
] as const

/** Wall colours. The brief's "house colour" and "ceiling colour" are the same
 *  surface — the walls — so there is ONE wall control, on this palette.
 *  Lighter-led, because walls read lighter than roofs on an Australian house. */
export const WALL_COLOUR_SWATCHES: readonly Swatch[] = [
  { slug: 'surfmist', name: 'Surfmist', hex: '#e4e2d5' },
  { slug: 'classic-cream', name: 'Classic Cream', hex: '#e6dcc0' },
  { slug: 'shale-grey', name: 'Shale Grey', hex: '#b6b5ae' },
  { slug: 'dune', name: 'Dune', hex: '#b0aca4' },
  { slug: 'basalt', name: 'Basalt', hex: '#6d6c6e' },
  { slug: 'woodland-grey', name: 'Woodland Grey', hex: '#4b4c46' },
  { slug: 'monument', name: 'Monument', hex: '#323233' },
] as const

function resolveSwatch(palette: readonly Swatch[], raw: string | null | undefined): Swatch {
  if (typeof raw !== 'string' || raw === '') return palette[0]
  const wanted = raw.trim().toLowerCase()
  return palette.find((s) => s.slug === wanted) ?? palette[0]
}

/** Resolve a roof-colour slug. Unknown/absent/hostile input → the default. */
export function resolveRoofColour(raw: string | null | undefined): Swatch {
  return resolveSwatch(ROOF_COLOUR_SWATCHES, raw)
}

/** Resolve a wall-colour slug. Unknown/absent/hostile input → the default. */
export function resolveWallColour(raw: string | null | undefined): Swatch {
  return resolveSwatch(WALL_COLOUR_SWATCHES, raw)
}

/**
 * The roof materials a customer may switch between on the studio renders.
 *
 * The 7 selectable keys of RoofMaterial — 'unknown' is excluded, matching
 * EDITABLE_MATERIALS in rate-card-overlay.ts: it is never user-selected, has
 * no render, and reads as "existing material" which is meaningless as a choice.
 */
export const SHOWCASE_MATERIALS: readonly RoofMaterial[] = [
  'colorbond_corrugated',
  'colorbond_trimdek',
  'colorbond_spandek',
  'colorbond_kliplok',
  'concrete_tile',
  'terracotta_tile',
  'cement_sheet',
] as const

/**
 * Customer-facing labels for the selectable materials.
 *
 * Deliberately owned here rather than imported from quote-bullets.ts: these
 * are showcase copy for a picker, they must cover exactly SHOWCASE_MATERIALS,
 * and the repo already carries seven divergent label maps for these keys.
 * Short forms — they sit on 40px-tall buttons on a phone.
 */
export const SHOWCASE_MATERIAL_LABELS: Record<RoofMaterial, string> = {
  colorbond_corrugated: 'Corrugated',
  colorbond_trimdek: 'Trimdek',
  colorbond_spandek: 'Spandek',
  colorbond_kliplok: 'Klip-Lok',
  concrete_tile: 'Concrete tile',
  terracotta_tile: 'Terracotta tile',
  cement_sheet: 'Flat sheet',
  unknown: 'Existing roof',
}

/**
 * Resolve a requested material, falling back to the one actually quoted.
 *
 * Never returns 'unknown': a quote whose material was not confirmed still
 * needs a selectable starting point, so it falls to the first real material.
 */
export function resolveShowcaseMaterial(
  requested: string | null | undefined,
  quoted: RoofMaterial | null | undefined,
): RoofMaterial {
  const wanted = typeof requested === 'string' ? requested.trim().toLowerCase() : ''
  const match = SHOWCASE_MATERIALS.find((m) => m === wanted)
  if (match) return match
  if (quoted && SHOWCASE_MATERIALS.includes(quoted)) return quoted
  return SHOWCASE_MATERIALS[0]
}

// ── Customer payload ────────────────────────────────────────────────

export type ShowcaseStatus =
  /** Paid, scheduled, model ready — render the showcase. */
  | 'ready'
  /** Entitled to see it, but there is no model — hide the section entirely. */
  | 'unavailable'
  /** Not entitled. The caller must 404 rather than explain why. */
  | 'forbidden'

export type ShowcasePayload = {
  status: ShowcaseStatus
  /** Storage path to sign. NEVER populated unless status === 'ready'. */
  glbPath: string | null
  /** The quoted material — the showcase's starting state. Never 'unknown'. */
  material: RoofMaterial
}

/** The row fields the payload decision needs. Deliberately narrow: the route
 *  selects only these, so a tradie-only column cannot leak by accident. */
export type ShowcaseRow = {
  model3d_status?: string | null
  model3d_glb_path?: string | null
  paid_at?: string | null
  scheduled_at?: string | null
  quote?: unknown
}

/** The primary structure's declared material, mirroring roof-after.ts's
 *  primaryMaterial(): the structure marked primary, else the first. */
function quotedMaterial(quote: unknown): RoofMaterial | null {
  const structures = (quote as { structures?: unknown } | null)?.structures
  if (!Array.isArray(structures) || structures.length === 0) return null
  const s =
    structures.find((x) => (x as { role?: string })?.role === 'primary') ?? structures[0]
  const m = (s as { inputs?: { material?: unknown } })?.inputs?.material
  return typeof m === 'string' ? (m as RoofMaterial) : null
}

/**
 * What a customer may see, decided from their own row.
 *
 * ENTITLEMENT IS CHECKED FIRST, before model readiness — otherwise an unpaid
 * probe could distinguish "no model" from "model exists but you can't have it",
 * which is a small information leak and an invitation to keep polling. An
 * unentitled caller gets 'forbidden' with a null path and learns nothing.
 *
 * Entitlement matches thanksPageTarget: paid AND scheduled. The showcase is
 * part of the thank-you surface, so it lives behind the same gate.
 */
export function resolveShowcasePayload(row: ShowcaseRow): ShowcasePayload {
  const material = resolveShowcaseMaterial(null, quotedMaterial(row.quote))

  if (!row.paid_at || !row.scheduled_at) {
    return { status: 'forbidden', glbPath: null, material }
  }
  if (row.model3d_status !== 'ready' || !row.model3d_glb_path) {
    return { status: 'unavailable', glbPath: null, material }
  }
  return { status: 'ready', glbPath: row.model3d_glb_path, material }
}

// ── Sharing ─────────────────────────────────────────────────────────

export type ShareRecipientId = 'partner' | 'kids' | 'parents' | 'mate' | 'copy'

/**
 * Who the customer is sending it to. This personalises the MESSAGE only — the
 * link is identical either way. Deliberately warm and Australian; the point of
 * the feature is that showing off a new roof should feel good.
 */
export const SHARE_RECIPIENTS: readonly { id: ShareRecipientId; label: string }[] = [
  { id: 'partner', label: 'My partner' },
  { id: 'kids', label: 'The kids' },
  { id: 'parents', label: 'Mum & Dad' },
  { id: 'mate', label: 'A mate' },
  { id: 'copy', label: 'Just copy the link' },
] as const

// ASCII only — these go out over SMS, where a single smart quote or em dash
// drops the whole body from GSM-7 to UCS-2 and halves the segment length.
const MESSAGES: Record<ShareRecipientId, string> = {
  partner: "Have a look at what our roof's going to look like:",
  kids: 'Check out what our house is going to look like!',
  parents: "Here's the roof we've gone with:",
  mate: "Reckon this'll look alright?",
  copy: '',
}

/**
 * The text the customer sends. Carries the share URL and NOTHING else — no
 * price, no address, no tradie details. Anything private stays behind the
 * quote token; a forwarded message must not leak it.
 */
export function buildShareMessage(recipient: ShareRecipientId, url: string): string {
  const prefix = MESSAGES[recipient] ?? MESSAGES.mate
  return prefix ? `${prefix} ${url}` : url
}

/** The public share link, carrying the exact combination on screen so the
 *  friend opens what the customer was looking at. */
export function buildShareUrl(
  appUrl: string,
  token: string,
  choice: { roof: string; wall: string; material: RoofMaterial },
): string {
  const base = appUrl.replace(/\/+$/, '')
  const q = new URLSearchParams({
    roof: resolveRoofColour(choice.roof).slug,
    wall: resolveWallColour(choice.wall).slug,
    mat: resolveShowcaseMaterial(choice.material, null),
  })
  return `${base}/share/${token}?${q.toString()}`
}
