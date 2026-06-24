# Quote PDF Format & White-Label Branding — Spec

## Objective
Redesign the customer-facing quote **PDF** for every trade into a single, premium,
white-label document that reads as the *tradie's own* quote and is styled in
QuoteMate's live "Caterpillar" (Maintain) design system. It must match the
structure and polish of the reference Jon supplied — branded header with logo,
thank-you intro, bulleted scope, lettered Parts, per-section images, a "Please
Note" disclaimer block, and a footer — improved to look more modern and clean.
Every trade (roofing, electrical, plumbing, solar, residential + commercial
painting, signage, aircon) shares one premium "chrome" while keeping its own
natural body. The work is a **redesign of the existing PDF templates**, not a new
pipeline.

Reference (the visual + structural target):
`C:\Users\dalig\Downloads\Quotation for Jon Pepper 670 London Rd, Chandler  .pdf`
(Roo Roofing — a fully tenant-branded, light-background, Part A–E roofing quote).

## Context / background

**The PDF pipeline already exists** — this spec re-skins it, it does not replace it:

- **Render path:** `lib/pdf/gotenberg.ts` → `renderPdfFromHtml(html)` posts a single
  `index.html` to a self-hosted Gotenberg Chromium instance and returns the PDF
  buffer. Page geometry is set there: **A4 portrait** (`paperWidth 8.27`,
  `paperHeight 11.7`), `0.5"` margins. `gotenbergConfigured()` gates on
  `GOTENBERG_URL`.
- **Orchestration:** `lib/quote/pdf.ts` exposes per-trade `ensure*Pdf()` functions
  (`ensureQuotePdf` for electrical/plumbing, `ensureRoofQuotePdf`,
  `ensureSolarQuotePdf`, `ensurePaintingPdf`). Each loads the persisted quote row,
  resolves the tenant business name, calls the trade's HTML builder, renders,
  stores, and stamps `pdf_path`. **Every path is best-effort and never throws** — a
  PDF failure must not block the quote SMS. Inspection-routed quotes return `null`
  (no committable price → no PDF). This guard stays.
- **HTML builders (what this spec rewrites):** one `report-html.ts` per trade —
  `lib/quote/report-html.ts`, `lib/roofing/report-html.ts`,
  `lib/solar/report-html.ts`, `lib/painting/report-html.ts`,
  `lib/commercial-painting/report-html.ts`, `lib/signage/report-html.ts`,
  `lib/aircon/report-html.ts`, `lib/estimation/report-html.ts`.
- **Storage / delivery:** private `quote-pdfs` bucket (`quotes/<id>.pdf`,
  `roofs/<token>.pdf`, `solar/<token>.pdf`, `paint/<token>.pdf`); customers download
  via stable token routes (`/api/q/[token]/pdf`, `/api/q/roof/[token]/pdf`, …) that
  lazy-generate on first hit; MMS attach uses a short-lived signed URL. **Unchanged
  by this spec.**

**Tenant branding data already exists** (no new columns required):
- `tenants`: `business_name`, `contact_name`, `logo_url`, `logo_path`,
  `business_address`, `website_url`, `abn`, `tagline`, `brand_color`
  (default `#FF5A1F`), `licence_type`, `licence_number`, `licence_state`,
  `licence_expiry`.
- Per-trade licences in `tenant_licences (tenant_id, trade, licence_*)` — prefer the
  trade-scoped licence, fall back to the `tenants.licence_*` primary.
- Today `lib/quote/pdf.ts` only reads `business_name`; the redesign must load and pass
  the full branding set to the chrome.

**Live design tokens (source of truth: `app/globals.css`)** — the skill doc
`.claude/skills/maintain-design-system/SKILL.md` is **stale** (says navy/orange); the
running site is the warm-charcoal **Caterpillar** palette. Use the values below.

Dark (default app) theme:
`--ink-deep #16120F`, `--ink #1E1813`, `--ink-card #2B2422`, `--ink-line #3A322C`,
`--accent #FFC400` (Caterpillar yellow), `--accent-press #E6AC00`,
`--accent-ink #1C1812` (dark ink **on** yellow — yellow never takes white text),
`--text-pri #F6F1EA`, `--text-sec #C3B8AC`, `--text-dim #A2968A`.

Light "warm paper" theme (`[data-theme="light"]` / `prefers-color-scheme: light`):
`--ink-deep #FAF8F4`, `--ink/--ink-card #FFFFFF`, `--ink-line #E9E3DC`,
`--accent #FFC400`, `--accent-ink #2B2422`,
`--text-pri #241E1B`, `--text-sec #5E544E`, `--text-dim #837870`.

Fonts: **Manrope** (700/800/900) for display + body, **JetBrains Mono** (400/600) for
tags/eyebrows/metadata. Brand rules: ALL-CAPS left-aligned display headings, tight
tracking, square corners, **borders not shadows**, generous spacing, AU English.

**Design decision — render in the LIGHT "warm paper" variant** (Decision D3 below):
it is still 100% the live Caterpillar brand, but is the correct choice for a
printed / downloaded / MMS-attached document (legibility, ink, file size) and mirrors
the reference's light layout. Caterpillar yellow is used as **fills** (Part markers,
chips, the footer accent bar, price highlight) with dark ink on the yellow — never as
coloured text on white (yellow text fails WCAG).

**Related specs (read for alignment, avoid duplication):**
`specs/tradie-branding-onboarding.md`, `specs/per-trade-quote-formats.md`,
`specs/roofing-measurement-review.md`, `specs/roofing-roof-types.md`,
`specs/quote-tier-modes.md`.

## Settled decisions
- **D1 — Fully white-label.** The PDF shows only the tradie's identity (logo →
  business-name fallback, tagline, ABN, contact, licence). **No visible "QuoteMate"
  text or mark anywhere.**
- **D2 — Shared chrome, trade-native body.** A single chrome module wraps every
  trade. The body keeps each trade's natural structure (roofing → lettered Parts;
  electrical/plumbing → Good/Better/Best; solar/painting/etc. → their own). Parts are
  **not** force-mapped onto tier-based trades.
- **D3 — Light "warm paper" Caterpillar styling, LOCKED** (yellow `#FFC400` fills +
  dark ink, warm-near-black headings, Manrope/JetBrains Mono). The dark charcoal canvas
  is **out of scope** — the PDF always renders in the light variant. No theme toggle.
- **D4 — Use existing tenant columns only.** No new onboarding fields; null fields are
  gracefully omitted.
- **D5 — File size target < 1 MB, hard cap 5 MB**, achieved by downscaling embedded
  images (~1600px longest edge, JPEG ~80%). A4 portrait is fixed.

## Requirements

1. **Shared chrome module.** Create one reusable builder (e.g.
   `lib/pdf/report-chrome.ts`) that renders the common document shell —
   `<head>` (tokens, fonts, print CSS), branded header, thank-you/intro block, the
   per-section image treatment, the "Please Note" block, and the footer — and accepts
   the trade-specific body HTML as a slot. Every trade `report-html.ts` composes its
   body and delegates the shell to this module. No trade re-implements the chrome.

2. **White-label header (every page).** Top-left renders the tenant **logo**
   (`logo_url`, else a signed URL from `logo_path`). When neither resolves, fall back
   to the **business name** set in the brand display type — never an empty header.
   Header also shows, when present (omit each if null): `tagline`, legal
   `business_name` + `ABN`, a contact line (phone/`contact_name`/`website_url`),
   and postal/`business_address`. Logo is constrained to a max box (e.g. height
   ≤ ~64px / width ≤ ~220px) so oversized uploads don't blow out the layout.

3. **Intake / thank-you block.** Below the header: the word **"Quotation"** + date;
   the customer name and **site address**; the customer's contact (email/phone) when
   known; then a thank-you paragraph naming the work and inviting the customer to
   contact the tradie (using the tenant's contact details), modelled on the
   reference's opening paragraph.

4. **Trade-native body, wrapped.** Each trade renders its existing quote content
   inside the chrome:
   - **Roofing = the reference exemplar:** lettered **Parts** (Part A, Part B, …),
     each with a bold uppercase heading + a scope note, a **bulleted scope of works**,
     and numbered **priced line items** showing `= $X including GST` with parenthetical
     caveats. Compulsory vs optional parts are visually distinguished.
   - **Electrical / plumbing:** Good/Better/Best tiers, honouring the existing
     `quote_tier_mode` / `resolveVisibleTiers` visibility logic (single vs multi-tier),
     re-skinned to the new system.
   - **Solar / residential painting / commercial painting / signage / aircon /
     estimation:** their existing section content, re-skinned. No data-model changes.

5. **Roofing measurement detail as bullet points.** The roofing body presents the
   measurement detail as descriptive, informative bullets modelled on the reference
   (e.g. roof areas and what's in/out of scope, pitch/section notes, sheet material &
   thickness, flashings, battens, tie-downs, warranty) — detailed but not a verbatim
   copy. Sourced from the persisted `roofing_measurements` row / `MultiRoofQuote`; do
   not invent figures not present in the data.

6. **Per-section images.** Where a trade has imagery (roofing aerial/outline map,
   solar static map + flux heatmap, electrical/solar Gemini preview/sample images),
   render it within its section with an italic caption, matching the reference's
   captioned aerial. Images are downscaled/compressed before embedding (R11). Missing
   images are simply omitted — never a broken `<img>` or 404 reference.

7. **"Please Note" block.** Near the document end, a "Please Note" heading followed by
   a bulleted disclaimer list. Composed from a **per-trade default disclaimer set**
   (a constant the build defines per trade) merged with any quote-specific
   `assumptions`/notes already on the row. De-duplicate; render nothing visually broken
   when both are empty (omit the block).

8. **Footer (every page).** A closing line, the **Caterpillar-yellow accent bar** as
   the visual full-stop, and the tradie's regulatory line — `licence_type` +
   `licence_number` (trade-scoped from `tenant_licences`, else primary) and `ABN` —
   shown only when present. No QuoteMate branding.

9. **Caterpillar design system applied (light warm-paper variant).** Use the exact
   light-theme tokens above. Yellow `#FFC400` only as fills with `#2B2422` ink on it;
   headings `#241E1B` ALL-CAPS Manrope 800, left-aligned, tight tracking; body
   `#5E544E` Manrope 400; tags/eyebrows/prices-labels JetBrains Mono uppercase tracked
   `#837870`; cards/panels white with `#E9E3DC` borders; **square corners, borders not
   shadows**; Part markers use the signature big-mono-number-in-a-yellow-tile pattern.
   A subtle topographic/grain texture is optional and must stay print-light.

10. **Fonts available to Gotenberg.** Manrope + JetBrains Mono must render in the PDF
    (embed as base64 `@font-face`, self-host, or a `<link>` Gotenberg can fetch), with
    a `system-ui` fallback so a font-load failure degrades gracefully rather than
    breaking layout.

11. **File-size control.** Before embedding, raster images are resized to ~1600px
    longest edge and re-encoded (JPEG quality ~80, or kept PNG only when transparency
    is needed). Target output **< 1 MB**; the generator must never emit a PDF over the
    **5 MB** MMS hard cap (if an edge case approaches it, compress harder / drop the
    largest optional image and log it). Logos are likewise size-capped.

12. **A4 portrait** geometry is preserved (the existing Gotenberg settings); content
    paginates cleanly with the repeating header/footer treatment.

13. **Applies to all existing trade templates** named in Context. Roofing is built and
    verified first as the exemplar; the remaining trades adopt the same chrome.

14. **No visible QuoteMate branding** in any rendered PDF (header, body, footer,
    metadata title where feasible).

15. **Graceful degradation** end-to-end: any missing branding field, image, licence,
    or measurement value is omitted cleanly; generation stays best-effort and never
    throws into the SMS path.

## Non-goals
- No new pipeline: Gotenberg, the `quote-pdfs` bucket, the `ensure*Pdf` orchestration,
  and the `/api/q/.../pdf` routes are reused as-is.
- No new tenant/onboarding columns (D4). Capturing extra branding (e.g. a footer
  "services" list, postal PO box) is out of scope and tracked separately.
- No changes to pricing, estimation, routing, tier logic, or quote data models —
  only presentation.
- Do not force lettered Parts onto tier-based trades (D2).
- Do not build the missing `/q/paint/[token]` customer page (painting PDF keeps its
  current "no live link" behaviour).
- No client-side / browser PDF generation and no separate PDF-compression library —
  image sizing happens in the HTML-build step.
- Inspection-routed quotes still produce **no** PDF (existing guard kept).

## Constraints
- Next.js 16 App Router server code; **read `quotemate-automation/AGENTS.md` + the
  relevant `node_modules/next/dist/docs/` guide before writing Next code.**
- Rendering is HTML → Gotenberg Chromium; CSS must be print-safe (A4, repeating
  header/footer via print CSS, no reliance on JS).
- Visual tokens come from `app/globals.css` light theme (single source of truth);
  if tokens are duplicated into a print stylesheet, keep them in sync with a comment
  pointer, mirroring the existing globals.css ↔ skill convention.
- AU English throughout; currency stored ex-GST, displayed inc-GST "including GST"
  as in the reference.
- Yellow `#FFC400` must never be used as text colour on a light background (contrast).
- All generation remains best-effort/non-throwing (mirrors current `ensure*Pdf`).

## Edge cases to handle
- Tenant has no logo (`logo_url` and `logo_path` both null) → render business name as
  the brand wordmark instead.
- Tenant has neither logo nor business name → render a neutral "Quotation" wordmark;
  never an empty/blank header.
- `logo_url` 404s / fails to load at render time → fall back to business-name wordmark
  (don't ship a broken image box).
- Oversized or non-A4-ratio logo upload → constrained to the max logo box, aspect
  preserved.
- Null `tagline` / `abn` / `website_url` / `business_address` / contact → that line is
  omitted, layout still balanced.
- No trade-scoped licence in `tenant_licences` → use `tenants.licence_*`; if that's
  also empty → omit the footer licence line.
- Trade has no images for the quote → image section omitted, no broken refs.
- A single very large customer/aerial image → downscaled to fit R11 before embed.
- Quote with no `assumptions` and no per-trade default disclaimers → "Please Note"
  block omitted.
- Very long scope/disclaimer lists → paginate cleanly across A4 pages; header/footer
  repeat; no clipped content.
- Inspection-routed quote (roof `routing = inspection_required`, quote
  `needs_inspection`, etc.) → no PDF generated (unchanged).
- Gotenberg unconfigured/down → `ensure*Pdf` returns null; the quote SMS is unaffected.
- Font fetch/embed fails → falls back to `system-ui`; document still renders.
- Resulting PDF would exceed 5 MB → compress harder / drop largest optional image and
  log a warning; never emit > 5 MB.

## Definition of done
- [ ] A shared chrome module exists and is used by **every** trade `report-html.ts`;
      no trade re-implements the header/intro/please-note/footer.
- [ ] A roofing quote PDF visually matches the reference's structure — branded header
      with logo, "Quotation"+date+site-address+contact, thank-you paragraph, lettered
      Parts with bulleted scope + numbered "= $X including GST" line items, captioned
      aerial image, "Please Note" block, accent-bar footer — re-skinned in the
      light Caterpillar palette.
- [ ] Roofing measurement detail renders as descriptive bullet points sourced from the
      persisted measurement/quote (no invented figures).
- [ ] With a tenant logo set, the logo renders top-left; with the logo removed, the
      business name renders in its place (verified both ways).
- [ ] Header/footer omit every null branding field with no layout gaps, on a tenant
      missing tagline/ABN/website/address/licence.
- [ ] Electrical/plumbing, solar, residential + commercial painting, signage, aircon,
      and estimation PDFs all render through the new chrome without errors and keep
      their native body (tiers / sections intact; tier-visibility logic unchanged).
- [ ] No string "QuoteMate"/"QuoteMax" or QuoteMate mark appears in any generated PDF.
- [ ] A representative roofing PDF (with the aerial image) is **< 1 MB**; no generated
      PDF exceeds 5 MB; output is A4 portrait.
- [ ] Manrope + JetBrains Mono render in the PDF (not a fallback) under normal config;
      with fonts unreachable, the PDF still renders via system-ui fallback.
- [ ] Inspection-routed quotes still produce no PDF; Gotenberg-down still returns null
      and never breaks the SMS send.
- [ ] `npm run build` / existing PDF tests pass; no regression in the `ensure*Pdf`
      best-effort contract.

## Open questions
- **Footer "services" list.** The reference lists the tradie's service lines
  (Re-Roofing, New Roofs, …). There's no column for this; spec omits it. Capture later
  via `specs/tradie-branding-onboarding.md` if desired.
- **Per-trade "Please Note" copy.** Who owns the canonical default disclaimer text per
  trade (legal/Jon vs build-time placeholder)? Spec assumes build defines sensible
  defaults now, refined later.
- **Tenant `brand_color`.** Spec fixes the accent to Caterpillar yellow for brand
  consistency and ignores per-tenant `brand_color`. Confirm that's desired, or whether
  the tenant accent should tint a secondary element.
