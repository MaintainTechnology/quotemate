// Per-quote branding override, allow-listed (spec 2026-07-06 §3.1, §9). A tradie
// may restyle THIS quote's look, but only within a bounded token set — never
// arbitrary CSS, never a remote logo URL (Gotenberg's Chromium would fetch it →
// SSRF). validateReportStyle returns the sanitised subset, or null if any
// provided value is off-list (caller then falls back to the tenant global brand).

import { z } from 'zod'

/** Bounded accent palette (Maintain-compatible). Extend deliberately, not freely. */
export const ALLOWED_ACCENTS = ['#FF5F00', '#0F1722', '#2563EB', '#16A34A', '#9333EA'] as const

// z.object strips unknown keys by default in zod v4 (a forged/persisted style
// with extra keys is sanitised, not rejected).
const StyleSchema = z.object({
  fontFamily: z.enum(['system', 'serif', 'sans', 'mono']).optional(),
  accentColor: z.enum(ALLOWED_ACCENTS).optional(),
  headingStyle: z.enum(['plain', 'underline', 'bar']).optional(),
  // Storage object path inside the tenant branding prefix — no URLs, no traversal.
  logoPath: z
    .string()
    .regex(/^branding\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/)
    .optional(),
})

export type ReportStyle = z.infer<typeof StyleSchema>

export function validateReportStyle(input: unknown): ReportStyle | null {
  const parsed = StyleSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
