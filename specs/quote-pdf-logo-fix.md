# Quote-PDF Tenant Logo Fix — Spec

## Objective
The tenant business logo renders on the **roofing** quote PDF but is missing on the
**electrical**, **plumbing**, and **painting** quote PDFs — including the PDF attached
to the customer SMS/MMS, where the header shows a business-name text wordmark instead
of the logo image. This spec fixes that so the logo appears on every trade's quote PDF
and its SMS/MMS copy. The fix is **investigate-then-fix**: the PDF rendering chrome is
already correct and shared by all trades, so the work is to find and repair why
`branding.logoSrc` is arriving `null` upstream — not to add logo-rendering code.

## Context / background

### The rendering is already shared and correct (do not touch it)
Every trade's quote PDF is built by one shared chrome. These builders all call
`renderReportDocument(branding, …)`:
- electrical + plumbing — `buildQuoteReportHtml` in `lib/quote/report-html.ts` (calls `renderReportDocument` ~line 141)
- painting — `buildPaintingQuoteReportHtml` in `lib/painting/report-html.ts:126`
- roofing (the working reference) — `buildRoofQuoteReportHtml` in `lib/roofing/report-html.ts:225`
- solar — `buildSolarQuoteReportHtml` in `lib/solar/report-html.ts:439`

`renderReportDocument` (`lib/pdf/report-chrome.ts:149-317`) renders the logo via the
private `wordmark()` helper (`lib/pdf/report-chrome.ts:83-91`):
- if `branding.logoSrc` is truthy → `<img class="logo" src="…" alt="…">` (header markup at line 284; CSS cap `.brand .logo{ max-height:60px; max-width:230px }` at line 197)
- else → `<div class="wordmark">businessName</div>` text fallback

This path is byte-identical for roofing and every other trade. The audit this session
confirmed `rendersLogo: yes` for all four builders.

### There is no separate "SMS PDF"
`ensureQuotePdf` renders the PDF once and stores it; the SMS path
(`dispatchQuoteWithPdf` in `lib/sms/send-quote-pdf.ts:22-53`) signs **that same file**
as MMS media. Attach call sites:
`app/api/estimate/draft/route.ts:853`, `app/api/quote/[id]/approve/route.ts:206`,
`app/api/quote/[id]/edit/route.ts:723`. **Fixing the PDF fixes the SMS copy.**

### Therefore the bug is upstream: `branding.logoSrc` is null
`loadTenantBranding` (`lib/pdf/branding.ts:53-107`) yields no `logoSrc` in exactly
three cases:
- **(a) `tenantId` is null** → it short-circuits to `{ businessName: FALLBACK_BUSINESS_NAME }` with no logo (`lib/pdf/branding.ts:58`).
- **(b) `tenants.logo_url` is empty** → `prepareLogo(null)` returns null (`lib/pdf/branding.ts:92`).
- **(c) `prepareLogo` fails silently** → fetch 404/timeout/unreachable, or encode error; it catches everything and returns null (`lib/pdf/image.ts:54-62`). Failures are currently invisible.

Note: `loadTenantBranding` reads `logo_url` from `tenants` by id; the `trade` argument
only affects the licence line. **Trade is not the differentiator — `tenant_id` /
`logo_url` is.**

### The causes split cleanly by channel (verified against insert sites)
- **Authenticated/portal insert paths already stamp a real `tenant_id`:** painting
  `app/api/painting/save/route.ts:83` (`auth.tenantId`), roofing
  `app/api/roofing/save-as-quote/route.ts:187` (`ctx.tenant.id`), commercial-painting
  `app/api/tenant/commercial-painting/save-quote/route.ts` (`tenant.id`), solar
  `app/api/solar/[tenantSlug]/estimate/route.ts`, and `app/api/t/[slug]/lead/route.ts:178`.
  **→ Painting can never be a NULL-`tenant_id` case.**
- **Only the SMS/voice inbound path can produce NULL `tenant_id`:**
  `app/api/intake/structure/route.ts:486` (`tenant_id: tenantId`) and
  `app/api/estimate/draft/route.ts:485` (`tenant_id: intakeTenantId`, propagated from
  the intake) — and only when the destination number does not resolve to a tenant
  (the dev shared number `+61481613464`).

So:
- **Electrical/plumbing via SMS** → most likely **cause (a)**, because tests run on the
  unprovisioned shared dev number.
- **Painting** → cannot be (a); must be **(b)** or **(c)**.
- **Any trade** → (b)/(c) still possible for any tenant.

## Requirements

### Investigation (must precede any fix)
1. Reproduce by generating, for the **same logo-configured tenant**, one electrical (or
   plumbing) PDF and one roofing PDF. Record whether each shows the logo. If both show
   it, the earlier failures were tenant/data-specific (a/b), not a rendering regression.
2. For each failing artifact, determine which of causes (a)/(b)/(c) applies, per channel,
   using a read-only diagnostic script (`node --env-file=.env.local scripts/<name>.mjs`,
   service-role key) that:
   - reports whether the failing `quotes` / `intakes` / `painting_measurements` row has a
     non-null `tenant_id`;
   - for the resolved `tenant_id`, reports whether `tenants.logo_url` is non-empty and
     whether fetching it returns HTTP 200 with an image content-type;
   - calls `loadTenantBranding(client, <tenantId>, '<trade>')` and logs whether `logoSrc`
     is populated and its byte length.
3. State the confirmed cause(s) per channel before editing code.

### Cause (a) — NULL `tenant_id` on the SMS/voice inbound path
4. Audit the SMS/voice inbound chain so a quote/intake created for a **provisioned**
   tenant number always carries that tenant's `tenant_id`: verify number→tenant
   resolution upstream of `app/api/intake/structure/route.ts:486` and the propagation to
   `app/api/estimate/draft/route.ts:485`. Fix any point where a resolvable tenant is
   dropped to null.
5. When a destination number resolves to **no** tenant (e.g. the dev shared number),
   emit a single clear warning log at the resolution point (include the destination
   number) and proceed; this is expected for unprovisioned numbers and must not throw or
   block the SMS.
6. Add a warning log in `loadTenantBranding` (`lib/pdf/branding.ts:58`) when it is called
   with a null `tenantId`, so a logo-less PDF is traceable to "no tenant" vs "no logo".

### Cause (b) — unset / invalid `tenants.logo_url`
7. Confirm whether the relevant tenant has a non-empty, fetchable `logo_url`. If unset,
   this is a data/product condition (the tradie uploads via the dashboard Account tab →
   `/api/tenant/logo`); no change to the PDF rendering path. Document the finding.
8. The wordmark text fallback must remain the behaviour when a tenant genuinely has no
   logo — do not change it.

### Cause (c) — `prepareLogo` failing silently
9. Make the silent failures in `lib/pdf/image.ts` observable: add a `console.warn` in
   both catch branches (the `sharp`-unavailable fallback at `image.ts:54-59` and the
   outer `catch` at `image.ts:60-62`) recording the source URL and the failure reason.
   Keep the existing null-safe, never-throw behaviour.
10. If the diagnostic shows `prepareLogo` failing on a valid logo, fix the underlying
    cause (e.g. make the storage object public, correct the stored URL, or handle the
    specific image format) — without removing the graceful fallback.

### Cross-cutting
11. All logo rendering continues to flow through the shared `renderReportDocument` /
    `wordmark()` chrome. No trade builder gains its own logo markup.
12. The SMS/MMS copy inherits the fix automatically (same stored PDF); no SMS-specific
    logo code is added.
13. Every change that repairs a silent failure must leave a log line behind so the next
    occurrence is debuggable.

## Non-goals
- **No backfill / regeneration of existing PDFs.** Fix-forward only. Already-cached
  `pdf_path` PDFs keep their current header until they are regenerated naturally (on
  edit / `regenerate`). Do not add a bulk re-render.
- **No changes to the shared chrome rendering** (`renderReportDocument` / `wordmark()` /
  the `.brand .logo` CSS).
- **No second / SMS-specific PDF or logo code path.**
- **No platform/generic fallback logo** for unprovisioned-number traffic — a no-tenant
  PDF keeps the wordmark fallback.
- **No removal of the inspection-route guard** — inspection-routed quotes intentionally
  produce no PDF at all (`ensureQuotePdf`/`ensure*` return null); that is not a logo bug.
- **No broad orphan-row cleanup** of historical NULL-`tenant_id` rows (documented,
  unrecoverable test traffic).

## Constraints
- Next.js 16 App Router. Read `quotemate-automation/AGENTS.md` and the relevant
  `node_modules/next/dist/docs/` guide before writing any Next.js code.
- PDF generation is gated by `gotenbergConfigured()`; when Gotenberg is unconfigured
  (common in dev) no PDF is produced at all. Logo rendering can only be verified where
  Gotenberg is configured.
- Diagnostic/ops scripts run as `node --env-file=.env.local scripts/<name>.mjs` and use
  `SUPABASE_SERVICE_ROLE_KEY`. Never commit `.env.local` or paste its secrets.
- Multi-tenant scoping is app-layer `tenant_id` filtering (service role bypasses RLS).
- Keep the diff minimal and scoped to the confirmed root cause(s); no opportunistic
  refactors.
- Logo handling is best-effort and must never throw or block the quote SMS.

## Edge cases to handle
- Destination number resolves to no tenant (dev shared number) → `tenant_id` stays null,
  one warning logged, PDF renders with wordmark fallback, SMS still sends.
- Tenant has no `logo_url` → wordmark fallback, no error (unchanged behaviour).
- `logo_url` set but fetch 404 / times out / not public → `prepareLogo` returns null
  **and logs the URL + reason**; wordmark fallback.
- SVG logo or `sharp` native dep unavailable → original bytes embedded as a data URI
  (existing fallback); verify the resulting data URI renders in the Gotenberg PDF.
- Logo present but PDF exceeds the 5 MB MMS cap → existing strip-images fallback in
  `renderQuotePdfCapped` may drop the logo for that send; acceptable, but log it.
- Quote already has a cached `pdf_path` → fix-forward means the old (logo-less) PDF
  persists until regenerated; document, do not bulk-regenerate.
- Inspection-routed quote → no PDF produced; out of scope, not a regression.

## Definition of done
- [ ] The confirmed root cause(s) per channel (electrical/plumbing, painting) are
      documented in the PR description, backed by the diagnostic script output.
- [ ] For a **provisioned, logo-configured** tenant, a newly generated **electrical**
      quote PDF renders the logo image in the header.
- [ ] Same verified for a new **plumbing** quote PDF.
- [ ] Same verified for a new **painting** quote PDF.
- [ ] The SMS/MMS-attached PDF for one such quote (open the attachment) shows the same
      logo — confirming no separate code path was needed.
- [ ] A new SMS/voice quote for a **provisioned** tenant number persists a non-null
      `tenant_id` on its `intakes` and `quotes` rows.
- [ ] A quote for an **unprovisioned** number (e.g. the dev shared number) logs exactly
      one "no tenant for destination number" warning and still sends the SMS with the
      wordmark-fallback PDF.
- [ ] `prepareLogo` failures now emit a `console.warn` with the source URL and reason
      (verified by pointing it at an unreachable URL).
- [ ] A tenant with no `logo_url` still produces a PDF with the business-name wordmark
      and no thrown error (no regression).
- [ ] No trade builder contains its own logo markup; all still call
      `renderReportDocument`. (`git grep` shows logo `<img>` only in
      `lib/pdf/report-chrome.ts`.)
- [ ] No existing PDFs were bulk-regenerated (fix-forward respected).

## Open questions
- Is a Gotenberg instance available for local/CI verification, or must the logo render be
  verified against the deployed environment?
- Is there a known **provisioned** tenant with a valid `logo_url` to use as the test
  subject, or does one need to be configured first?
- For electrical/plumbing specifically: is the live cause confirmed to be (a) NULL
  `tenant_id` from the shared dev number, or could a provisioned tenant also be hitting
  (b)/(c)? (Resolve via the investigation step before coding.)
