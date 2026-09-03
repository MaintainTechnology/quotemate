# EV charger estimate template — Spec

> Source documents: `Estimate-EST-0534.pdf`, `Estimate-EST-0541.pdf`, `Proposal-EST-0565.pdf`
> (Electrical3, Cromer NSW — ABN 73 167 930 994, Lic 270174C). Verbatim content is
> transcribed in **Appendix A**. Companions: `specs/ev-charger-job-quoter.md` (dashboard,
> shipped) and `specs/ev-charger-sms-auto-quote.md` (SMS auto-quote fix, **in flight** — see
> *Collision control*).

## Objective

Give EV charger customers a proper **estimate document** — the sections, subsections and
ordering of the three Electrical3 samples — rendered in the QuoteMax design system and
delivered by the existing SMS AI receptionist without changing how that receptionist behaves.

Today an EV charger quote renders through the generic electrical/plumbing report
(`lib/quote/report-html.ts` `buildDefaultQuoteBody`): Scope of works, Job details, Your
tradie, one tier table, Assumptions. It has no estimate number, no Prepared For block, no
Site Address, no Valid Until, no Inclusions, no Exclusions, no Optional Upgrades, no phased
line-item groups, no Subtotal/GST/Total footer and no Terms & Conditions. This spec adds an
EV-only document that has all of them, keyed on `job_type = 'ev_charger'` and
`trade = 'electrical'`, leaving every other trade and job type byte-identical.

## Context — what already exists (verified at HEAD, 2026-09-02)

**Two PDF renderers exist for one quote.** (1) `buildQuoteReportHtml`
([lib/quote/report-html.ts:206](lib/quote/report-html.ts:206)) → `renderPdfFromHtml` →
cached at `quotes.pdf_path`, served by `GET /api/q/[token]/pdf` — **this is the PDF the SMS
links** and the dashboard viewer iframes (via `/api/q/[token]/html`). (2)
`GET /api/q/download?path=/q/<token>` prints the **live React page** through Gotenberg's URL
route. Renderer (1) is this spec's deliverable; renderer (2) follows the page (see R11).

**The seam.** `renderQuoteDocumentHtml(input, reportDoc)`
([lib/quote/pdf.ts:535](lib/quote/pdf.ts:535)) is the single switch both the cached PDF
(`ensureQuotePdf` :676) and the dashboard HTML preview (`renderQuoteReportHtml` :576) pass
through. `ctx.intake.job_type` and `ctx.intakeTrade` are already loaded
([lib/quote/pdf.ts:331](lib/quote/pdf.ts:331), :339) and `job_type` already flows in as
`QuoteReportInput.jobType` (:498). There is **zero** job_type branching anywhere in the PDF
path today; per-trade branching is `tradeRendersOwnQuotePdf` (commercial painting only) and
roofing's `layoutOverlay` / `propertyVisuals`.

**The chrome is reusable and already carries the letterhead.**
`renderReportDocument` ([lib/pdf/report-chrome.ts:211](lib/pdf/report-chrome.ts:211)) renders
the white-label header from `TenantBranding` — `businessName`, `logoSrc`, `tagline`,
`legalLine` (`ABN …`), `contactLine` (`Tel … · email`), `website`, `address`, `licenceLine`
(`<type> Lic. <n> · ABN <abn>`), built by `loadTenantBranding`
([lib/pdf/branding.ts:53](lib/pdf/branding.ts:53)) from `tenants` + `tenant_licences`. **That
is exactly the samples' header block** (business name, ABN, Lic, address, phone). The chrome
also exposes `renderPart` (marker tile + title + note + bullets + price lines),
`renderBullets`, `renderFigure`, `renderTradieBlock`, `esc`, `aud0`, `aud2`. Two gaps: the
visible title is the hard-coded string `Quotation` (:379 — `docTitle` only reaches `<title>`),
and the intro meta is one flat line `Name · Address · Date · Contact` (:380-382), not the
samples' two-column Prepared For / Date block.

**Design register for print is LIGHT warm paper, not the dark command centre.**
`report-chrome.ts:241-245`: `--paper #FAF8F4`, `--card #FFFFFF`, `--line #E9E3DC`,
`--accent #FFC400` (fills only, never text), `--accent-ink #2B2422`, `--pri #241E1B`,
`--sec #5E544E`, `--dim #837870`. Manrope 400/600/700/800 + JetBrains Mono 400/600 via a
Google Fonts `<link>` (:236-238). Square corners, no grain, no shadows. Body pinned to
`PDF_CONTENT_WIDTH_IN` 7.27in; Gotenberg renders `singlePage: true` — one continuous A4-width
page, not paginated.

**Money and grounding constraints that bound the copy.**
- Electrical takes the **flat $99 refundable site visit and nothing else** (`docs/strategy.md`
  v20; `SITE_VISIT_FIRST_TRADES` in [lib/quote/mint-tier.ts:37](lib/quote/mint-tier.ts:37)).
  Tier prices are visible as information. `/r/<token>/good|better|best` 302s to
  `/r/<token>/inspection`. The 50% deposit in the samples' Terms is **not** the live model —
  the only 50% EV deposit is `specs/post-visit-money-sequence.md`, which is unbuilt and
  applies to a separate post-visit quote row.
- Currency is stored ex-GST and displayed inc-GST through the one module
  [lib/quote/money.ts](lib/quote/money.ts); GST is applied only when
  `pricing_book.gst_registered` (default true). A hard-coded "GST (10%)" row and "all prices
  include GST" are wrong for a non-registered tenant.
- Every printed dollar must derive from a candidate row
  ([lib/estimate/validate.ts](lib/estimate/validate.ts)). A repo-wide grep finds **no row and
  no code mentioning surge protection anywhere** — so the samples' `$360 + GST` /
  `$580 + GST` / `$150–$400` figures are ungroundable. The in-flight
  `lib/estimate/upsell-guard.ts` and the 2026-09-01 `electrical-prompt.ts` HARD RULE already
  force upsells to be unpriced unless a catalogue row backs them.

**Line items have no phase field and cannot gain one.** `DraftLineItem`
([lib/estimate/merge-recipes.ts:57](lib/estimate/merge-recipes.ts:57)) is loose, but the
tradie edit route's `LineItemSchema`
([app/api/quote/[id]/edit/route.ts:63](app/api/quote/[id]/edit/route.ts:63)) is a Zod object
that strips unknown keys and the rebuild re-emits exactly six keys
(`description, quantity, unit, unit_price_ex_gst, total_ex_gst, source`). **Any `phase` key
Opus emitted would be destroyed the first time the tradie saves.** Phases must therefore be
derived at render time (R4).

**Inspection-routed rows have no document.** `loadQuoteReportContext` returns null when
`needs_inspection` ([lib/quote/pdf.ts:326](lib/quote/pdf.ts:326)), `/api/q/[token]/pdf` 404s
and `/api/q/[token]/html` returns a placeholder. An explicit three-phase EV enquiry routes to
inspection and gets the $99 SMS with no PDF. That behaviour is correct and stays.

**The SMS path.** The customer quote SMS is composed only in
[app/api/estimate/draft/route.ts:919](app/api/estimate/draft/route.ts:919) inside `after()`:
`ensureQuotePdf` (:886, skipped when `needs_inspection`) → `pdf_url = quotePdfUrl(shareToken)`
→ `buildQuoteSms` → `dispatchQuoteWithPdf`. The body prints `View full quote: …/q/<token>`
then `PDF copy: …/api/q/<token>/pdf`. `ensureQuotePdf` never throws (it returns null and the
SMS simply drops the PDF line); a throw inside `buildQuoteSms` itself would fall through to
the route's outer catch and replace the quote with "we hit a snag".

**The fleet.** The live SMS receptionist is **not** the monolith — `app/api/sms/inbound` is
retired behind `SMS_RECEPTIONIST_ENABLED`. Tenant numbers point at `qm-front-desk`, which
forwards to `qm-electrical-receptionist` on Railway. That carve-out is **generated** by
`scripts/export-receptionist.mjs` (3 routes + a 189-file import closure copied
byte-identically; `lib/quote/pdf.ts`, `report-html.ts`, `lib/pdf/*` and `lib/sms/templates.ts`
are all in the closure). It renders the PDF itself at draft time and texts monolith URLs.
`qm-front-desk` is **not** generated by that script — it is a hand-maintained sibling repo
that routes by *trade* only and has no job_type, EV or quote-rendering code at all.

⚠ **A re-export wipes the carve-out.** `buildTrade` runs
`rmSync(join(outDir, 'src'), {recursive: true, force: true})` and rewrites `package.json`.
The electrical carve-out currently holds hand-written files that exist nowhere in the
monolith — `src/lib/sms/form-offer.ts`, three `*.check.ts` files, ~65 hand-edited lines in
`inbound.route.ts` (the form-offer step 5b), and a `check` npm script. All are destroyed by
the re-export this spec mandates (R12).

## Requirements

### The document

**R1 — A dedicated EV builder, selected by job type, leaving everything else untouched.**
Add `lib/quote/report-html-ev-charger.ts` exporting
`buildEvChargerEstimateHtml(input: EvChargerEstimateInput): string`. Select it in
`renderQuoteDocumentHtml` ([lib/quote/pdf.ts:535](lib/quote/pdf.ts:535)) when **both**
`input.jobType === 'ev_charger'` **and** the resolved `ctx.intakeTrade === 'electrical'`;
every other combination falls through to today's `buildQuoteReportHtml` with byte-identical
output. Gate on the exact strings — `job_type` may be null (it falls back to `'job'`) and
plumbing shares the generic branch. The builder must be **pure** (no I/O, no `Date.now()` —
the document date comes from `input.generatedAt`, itself `quote.created_at`) and must
`esc()` every user-influenced string.

**R2 — Reuse the shared chrome; add exactly two optional slots.** The EV body renders through
`renderReportDocument`, so the header block, fonts, palette, footer accent bar and licence
line come free. Two additive optional fields on `ReportDocument`
([lib/pdf/report-chrome.ts:66](lib/pdf/report-chrome.ts:66)), each defaulting to today's
behaviour so every existing caller's output is unchanged:
- `titleText?: string | null` — replaces the hard-coded `Quotation` at :379. EV passes
  `'ESTIMATE'`.
- `introMetaHtml?: string | null` — when present, replaces the flat
  `Name · Address · Date · Contact` `quote-sub` line (:380-382) with caller-supplied HTML.
  EV passes the two-column Prepared For / Proposal Details block (R3).

No new CSS file. Any EV-specific rules are a `<style>` block the builder contributes through
the existing body slot, using only the chrome's tokens (`--paper`, `--card`, `--line`,
`--accent`, `--accent-ink`, `--pri`, `--sec`, `--dim`), Manrope for prose and JetBrains Mono
for eyebrows, table headers and every figure, with `font-variant-numeric: tabular-nums` on
money. Square corners. Yellow is a fill behind dark ink, never text on cream.

**R3 — Section order and content, matching the samples exactly.** In this order:

| # | Section | Source |
|---|---|---|
| 1 | Header block: logo/wordmark, business name, ABN, Lic, address, phone | `TenantBranding` (existing) |
| 2 | Title `ESTIMATE` + estimate number (`EST-0534` style) | R2 `titleText` + R5 |
| 3 | **Prepared For:** name, email, phone; **Site Address**; **Date** and **Valid Until** | R6, R7 |
| 4 | **Scope of Work** — lead paragraph | `quotes.scope_of_works` |
| 5 | **Description of Works** (bulleted) | R8 |
| 6 | **Assumptions** (bulleted) | `quotes.assumptions[]` |
| 7 | **Inclusions** (bulleted) | R9 |
| 8 | **Exclusions** (bulleted) | R9 |
| 9 | **Optional Upgrades & Recommendations** | R10 |
| 10 | Phased line-item tables — Description / Qty / Rate / Amount + **Group Total** | R4 |
| 11 | **Subtotal (ex GST)** / **GST (10%)** / **Total** | R13 |
| 12 | **Images** | R14 |
| 13 | **Terms & Conditions** | R13 |

Sections 6 through 9, 12 and the Optional Upgrades prices are each omitted entirely — heading
included — when they have no content. An empty section beats a padded one
(`electrical-prompt.ts:47-49`); a heading with nothing under it is a defect.

Column headers are exactly `Description`, `Qty`, `Rate`, `Amount` (the samples' words), not
the generic report's `Item / Qty / Unit (ex GST) / Total (ex GST)`. `Qty` prints quantity and
unit as one cell in the samples' style (`10 METRE`, `1.5 HOUR`, `1 EACH`, `3 LENGTH`,
`1 LOT`, `1 SET`), upper-cased from `line_items[].unit`; a missing unit prints the bare
quantity.

**R4 — Phases are derived at render, never stored.** A pure exported helper
`evChargerPhase(line): 1 | 2` in the same module assigns each visible tier's line items to
**Phase 1 — Switchboard and rough-in** or **Phase 2 — Fit-off and commissioning**:
- Phase 2 when the description matches mount / terminat / commission / test / verif /
  clean-up / hand-over, **or** the line is the charger unit itself (source
  `material:<uuid>` resolving to a `tenant_material_catalogue` row in category `ev_charger`,
  or `scope.chosen_product`).
- Phase 1 otherwise (protection devices, cable, conduit, fittings, sundries, rough-in labour).

Each populated phase renders as one table with its own **Group Total** (sum of that phase's
`total_ex_gst`). When only one phase has lines, render a single table titled
`Phase 1 — <phase 1 name>` (matching EST-0541, which has exactly one phase). The two Group
Totals must sum to the tier subtotal; assert it in a test. This survives tradie edits because
nothing is persisted — the classifier re-runs on whatever six keys the edit route wrote.

**R5 — Estimate number.** Add nullable `quotes.estimate_number int` plus a Postgres sequence
(migration **194**, with `194_down.sql` and `scripts/run-migration-194.mjs`, numbered after
the in-flight 193). It is assigned **lazily and idempotently** inside the EV render path — a
single `update quotes set estimate_number = nextval('quote_estimate_number_seq') where id = $1
and estimate_number is null returning estimate_number` — never in the draft route (which the
other session is editing). Rendered as `EST-` + the number zero-padded to 4 digits. The write
is best-effort: check `error` on the response and, if it fails or returns nothing, fall back
to the existing reference `quote.id.slice(0,8).toUpperCase()` and render the document anyway.
Assigning a number must never be able to block a PDF or an SMS. Gaps in the sequence across
tenants are acceptable — the samples themselves run 0534, 0541, 0565.

**R6 — Prepared For, from this job's own data only.** Name from `intakes.caller.name`; email
from `intakes.caller.email`; phone from the customer's own number on
`sms_conversations.from_number` joined by `intake_id` (the same join the draft route already
does at :244-251) — **never** from a remembered `customers` row. `intakes.caller.phone` is
not populated by the SMS path and must not be trusted. There is no company field anywhere on
`intakes.caller`, `customers` or `quotes`, so the samples' company line is omitted. Any line
with no value is omitted; the customer's name prints in full (**amended 2026-09-03**: this
first said "first name alone" for the case where no email or phone is known — the full name is
what the source estimates print and what belongs on a formal document, and the greeting
elsewhere already carries the first name); when no name, email or phone is known at all, the
whole block is omitted. Loading these fields
means extending `QuoteReportContext` / `loadQuoteReportContext`
([lib/quote/pdf.ts:317](lib/quote/pdf.ts:317)) — add them as a **second, best-effort select**
so a failure degrades the block rather than the document.

**R7 — Site Address, Date and Valid Until.**
- **Site Address** = `intakes.address` when present, else `intakes.suburb` alone. Honouring
  `specs/ev-charger-sms-auto-quote.md` R5: a street address that came from customer memory
  rather than this thread must not be printed as this job's address — when the in-flight spec
  lands its `address_source` signal, suburb-only rows print the suburb. Until then, print
  whatever `intakes.address` holds and add nothing of your own. Omit the block when both are
  null.
- **Date** = `input.generatedAt` (`quote.created_at`) formatted `13 Aug 2026`, en-AU.
- **Valid Until** = `generatedAt + 30 days`, same format, **presentational only**. It is
  derived at render, not stored, and it gates nothing. It is deliberately not
  `quotes.price_hold_until` (7 days, and suppressed for electrical since v20). The Terms line
  in R13 must say the same 30 days.

**R8 — Description of Works.** Bullets, in priority order:
1. `intakes.scope.description` split into sentences, when it reads as a works description.
2. Otherwise the authored EV method already in the repo — `jobMethod('electrical',
   'ev_charger')` ([lib/quote/job-method.ts:138](lib/quote/job-method.ts:138)) gives steps,
   tools and compliance text that today render on the page but not in the PDF. Use its
   `steps`.
3. Otherwise the Phase 1 and Phase 2 labour line descriptions.

Never invent work. Every bullet must trace to intake or quote content or to the authored
method text; the model is not asked for a new field.

**R9 — Inclusions and Exclusions, from the assemblies already priced.** Both are derived, not
new model output — adding a field would mean editing the oracle prompt, the bundled template
`prompt-templates/electrical-estimator.ts` and the `trade_prompts` DB row, all of which the
other session is touching.
- **Inclusions**: one bullet per distinct visible line item, grouped and de-duplicated by
  description, phrased from the line description itself. The charger unit appears here only
  when the tenant supplies it.
- **Exclusions**: `shared_assemblies.default_exclusions` / `tenant_custom_assemblies` for
  every assembly UUID referenced by the tier's `source` fields, split on sentence boundaries
  and de-duplicated. The seeded `Install EV charger` row already carries "Excludes switchboard
  upgrades, load-balancing, and supply of the charger unit itself"
  ([sql/migrations/021_services_catalogue_extras.sql:61](sql/migrations/021_services_catalogue_extras.sql:61)).
  Load them in the same best-effort select as R6. When `supplied_by = 'customer'`, prepend
  "Supply of the EV charger unit itself." When the assembly UUID is absent (a tradie edit
  stripped it, or the line is `tradie_manual`), that assembly contributes no exclusions —
  render what survives and omit the section if nothing does.

**R10 — Optional Upgrades & Recommendations carries no invented price.** Two content sources,
both optional:
- The **advisory copy** from the samples, held as constants in the EV module, rendered with
  **no dollar figures**: the surge-protection recommendation and the switchboard-capacity
  note, each ending "confirmed at your site visit". The samples' `$360 + GST`, `$580 + GST`
  and `$150 to $400` are not printed — no catalogue row backs them, `+ GST` contradicts
  inc-GST display, and a range contradicts the no-indicative-figures rule.
- `quotes.optional_upsells[]` (today stored by the draft route and rendered on **no** surface).
  Render each entry; print a price **only** when the entry carries a finite `price_ex_gst`,
  displayed inc-GST through `lib/quote/money.ts`. Entries with a null price — which is what
  the in-flight `upsell-guard.ts` writes — print "quoted on site".

If Jon later wants real surge-protection prices, they arrive as tenant catalogue rows and flow
through the second bullet automatically. No template change, no seeded prices. See open
question 2.

**R11 — The customer page must not contradict the document.** `/q/[token]` and
`/api/q/[token]/pdf` are both linked in the same SMS, so they must agree. Extend the existing
electrical five-section branch ([app/q/[token]/page.tsx:1127](app/q/[token]/page.tsx:1127))
for `job_type === 'ev_charger'` with the estimate number, Valid Until, Inclusions, Exclusions,
Optional Upgrades and the Terms wording from R13, composed from the **same pure helpers** the
document uses (`evChargerPhase`, the inclusions/exclusions derivation, the terms constant) so
the two surfaces cannot drift. This is an addition to the existing sections using existing
`app/q/_chrome/parts.tsx` primitives — **not** a page redesign, not a new layout, and not a
change to the five-section structure, the `$99` CTA, the sticky bar or `AcceptBlock`. Because
`/api/q/download` prints the live page, this also keeps the page's own PDF button honest.

### Delivery and safety

**R12 — Ship to the surface that serves the number.** The monolith is the source of truth;
the carve-out is an export; never hand-edit the carve-out. Sequence, in order:
1. Land and commit every change in the monolith.
2. **Upstream the carve-out's hand-written files first** — `src/lib/sms/form-offer.ts`, the
   ~65 form-offer lines in `inbound.route.ts`, and a decision on the three `*.check.ts` files
   and the `check` npm script — or accept in writing that the re-export deletes them.
   `export-receptionist.mjs` `rmSync`es `src/` and rewrites `package.json`. This step is not
   optional: skipping it silently removes a feature that has been live since 2026-08-07.
3. `node scripts/check-receptionist-env.mjs` (confirm `CRON_SECRET` and `GOTENBERG_URL`).
4. `node scripts/export-receptionist.mjs electrical`, review the diff for R1–R10 and for
   the unrelated monolith changes the resync also pulls in, then `npm run typecheck` in the
   carve-out.
5. Deploy the monolith **and** `node scripts/railway-deploy-receptionists.mjs electrical` in
   the same window — the carve-out renders and caches the send-time PDF while the monolith
   regenerates on download, so a version skew serves two different documents for one quote.
6. `qm-front-desk` needs **no code change** — verified while writing this spec, not assumed.
   Its 26 TypeScript files were grepped for `ev charger|wallbox|tesla|charger` (zero hits) and
   for `report-html|ensureQuotePdf|buildQuoteSms|lib/quote|lib/pdf` (zero hits). It routes by
   *trade* only, holds no job_type or EV vocabulary, and never renders or sends a quote — an
   EV enquiry reaches it as ordinary text and falls to the electrical default exactly as
   today. Re-run both greps at build time and record the result in the PR. Redeploying it is
   optional; modifying it is out of scope.

**R13 — Terms and totals that match what the funnel actually does.** The Terms & Conditions
block is a constant in the EV module (no new tenant column, no editing surface). Three sample
lines survive verbatim; two are replaced because they describe a model QuoteMax does not run:

| Sample line | Verdict |
|---|---|
| This is an estimate, not a contract. | keep verbatim |
| Prices are valid for 30 days from the date of this estimate. | keep verbatim (matches R7) |
| Final price may vary based on actual work performed. | keep verbatim |
| A 50% deposit is required to commence work. | **replace** — "A $99 refundable site visit fee confirms your booking and is credited toward your final quote." |
| All prices are in AUD and include GST. | **replace** — "All prices are in Australian dollars. Line items are shown ex GST; the total includes 10% GST." |

The totals block uses `lib/quote/money.ts` only: `Subtotal (ex GST)` from the visible tier's
`subtotal_ex_gst`, and `Total` from **`totalIncGstCents(..., { gstRegistered })`** rendered at
two decimal places, with `GST (10%)` as the difference between the two so the three rows
always reconcile. When `pricing_book.gst_registered` is false the GST row is **omitted**,
`Total` equals the subtotal, and the last Terms line and the chrome's `footerPriceNote` both
drop the GST sentence. Never print a fixed 10% row for a non-registered tenant.

> **Amended 2026-09-03 (build review).** This first said `displayIncGst`, which returns
> **whole dollars**. That is right for a tier headline but wrong here: this document prints
> 2dp line items, and a whole-dollar total sitting under them would not add up on the page.
> `totalIncGstCents` is the same module and the same single-rounding — `displayIncGst` is
> literally `dollars(totalIncGstCents(...))` — so the money path is unchanged, and the output
> now matches the source estimates exactly ($976.30 + $97.63 = $1,073.93).

Tier arity is unchanged: whichever tiers `resolveVisibleTiers` returns are rendered, each with
its own phased tables and totals, under the existing tier labels. Do not collapse, add or null
tiers.

**R14 — Images, capped.** Render an `Images` section only from images the pipeline already
has: `scope.chosen_product.image_path` (the tenant's own charger product shot) and, when
present, customer intake photos. Inline through `prepareImage`
([lib/pdf/image.ts](lib/pdf/image.ts), never throws), max edge 640px per
`specs/quote-visual-parity.md`, **at most 3 images**. A fetch failure omits that image and
must route through the existing `embeddedImageMissing` NULL-signature retry
([lib/quote/pdf-signature.ts:94](lib/quote/pdf-signature.ts:94)) rather than caching a
permanently image-less PDF. Never trigger a billable AI render from a PDF or page load. If the
document would exceed the 5 MB MMS cap, images are dropped before the document is.

**R15 — Cache the new template without regenerating every other PDF.** Do **not** bump
`REPORT_TEMPLATE_VERSION` — it is pinned `toBe(8)` in
[lib/quote/report-html.test.ts:326](lib/quote/report-html.test.ts:326) and a bump lazily
regenerates every cached electrical and plumbing PDF. Instead add an optional
`templateKey?: string | null` argument to `quotePdfSignature`
([lib/quote/pdf-signature.ts:20](lib/quote/pdf-signature.ts:20)) that appends `|tpl=<key>`
only when set — the same back-compat trick `disc`, `g` and `p` already use, so every non-EV
signature stays byte-identical. EV rows pass `tpl=ev1`; bump to `ev2` on any later EV template
change. Fold the R14 image set into the key (or the existing photo-hash segment) so a changed
product image invalidates the cache.

**R16 — The SMS receptionist keeps working, unchanged.** The receptionist is not modified.
Explicitly:
- `buildQuoteSms` output is **not** changed. `templates-site-visit.test.ts`,
  `templates-pdf.test.ts`, `templates-tier-mode.test.ts` and `price-parity.test.ts` must pass
  untouched. The customer keeps getting `View full quote:` and `PDF copy:` — the PDF behind
  that second link is simply the EV document now.
- No new environment variable, no new required config, no new external call. Gotenberg,
  `CRON_SECRET` and `APP_URL` requirements are unchanged.
- The EV builder is wrapped so that **any throw falls back to `buildQuoteReportHtml`** and
  logs — a template bug must degrade to the generic report, never to a failed send. The
  `ensureQuotePdf` try/catch stays the outer net (a null PDF drops only the `PDF copy:` line).
- The R5 write and the R6/R9 selects are best-effort with `error` checked on every Supabase
  response (`supabase-js` resolves `{data, error}`, it does not throw). None of them may
  block, delay past the route's budget, or fail a send.
- Inspection-routed EV rows are untouched: no PDF, no estimate number, `buildInspectionQuoteSms`
  as today.
- One optional copy correction, called out because it has a side effect. `ELECTRICAL_JOB_TYPES`
  ([lib/sms/templates.ts:741](lib/sms/templates.ts:741)) is the "easy 5" set
  (`downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting`) and omits
  `ev_charger`, so an EV job's SMS says "tradie" instead of "sparky" (`tradieNoun` :748) and
  "5 items" instead of "5 fittings" (`tierComponents` :1019). Adding `ev_charger` to the set
  fixes the first and changes the second — and "fittings" reads worse than "items" for a
  charger, an RCBO and a conduit run. Preferred fix: split the two uses so `tradieNoun`
  recognises `ev_charger` while the component noun stays "items". If that is more churn than
  it is worth, leave the line alone entirely — this is cosmetic and must not put the pinned
  SMS template tests at risk.

**R17 — Tests.** Following the house pattern (vitest, node env, `toContain` / index-ordering
assertions, no golden files):
- `lib/quote/report-html-ev-charger.test.ts` — section presence and order; `Description / Qty
  / Rate / Amount` headers; two phase tables whose Group Totals sum to the tier subtotal;
  single-phase collapse; HTML escaping; determinism (two renders with a fixed `generatedAt`
  are identical); estimate-number fallback when the column is null; GST row omitted when
  `gstRegistered: false`; no `$` figure appears in Optional Upgrades for an unpriced upsell;
  the five Terms lines including both replacements.
- `evChargerPhase` unit tests over the EST-0534 and EST-0565 line sets (Appendix A) —
  RCBO / cable / conduit / fittings / rough-in labour → Phase 1; mount, terminate, test,
  commission, clean-up and the charger unit → Phase 2.
- A `renderQuoteDocumentHtml` selection test: `ev_charger` + `electrical` → EV document;
  `ev_charger` + any other trade, and every other job type on electrical → generic output
  unchanged.
- `quotePdfSignature` test: no `templateKey` → byte-identical to today; `tpl=ev1` appended
  when set.
- A migration test mirroring `tests/ev-charger-migration.test.ts` (PGlite, up twice, down,
  `init.sql` representative, runner text).
- `report-chrome.test.ts` additions: `titleText` and `introMetaHtml` absent → existing output
  unchanged; present → used.

## Non-goals

- Any change to the receptionist's conversation, slots, readiness gate, WP9 product offer or
  dialog prompts. That is `specs/ev-charger-sms-auto-quote.md`.
- Any change to the money model: no deposit, no change to the $99 site visit, no new Stripe
  path, no change to auto-send or hold-for-review policy.
- Seeding surge-protection, switchboard-capacity or charger-unit prices. Those stay
  Jon-supplied tenant data.
- A new `phase` field on line items, a new model output field, or any edit to
  `electrical-prompt.ts` / `prompt-templates/electrical-estimator.ts` / `trade_prompts`.
- Paginated A4 with "Page 1 of 2" footers. The document stays `singlePage` like every other
  QuoteMax PDF (open question 4).
- A tenant-editable terms or validity field, and an Account-tab surface for either.
- Redesigning `/q/[token]`, changing the five-section structure, or touching roofing,
  painting, solar, commercial painting, aircon or signage.
- Any change to `qm-front-desk` beyond verifying it needs none.
- Applying the template to non-EV electrical jobs or to plumbing.

## Constraints

- **Collision control.** `specs/ev-charger-sms-auto-quote.md` is in flight and uncommitted in
  `lib/estimate/{run,validate,electrical-prompt}.ts`, `lib/estimate/upsell-guard.ts`,
  `lib/quote/review-policy.ts`, `app/api/estimate/draft/route.ts`,
  `app/api/sms/inbound/route.ts`, `lib/sms/{assumptions,extract-slots,product-options,
  quote-readiness}.ts` and migration 193. **This spec must not edit any of those files.** Its
  writes are confined to: a new `lib/quote/report-html-ev-charger.ts`; additive changes in
  `lib/quote/pdf.ts`, `lib/quote/pdf-signature.ts`, `lib/pdf/report-chrome.ts`; the EV branch
  in `app/q/[token]/page.tsx`; one copy line in `lib/sms/templates.ts`; migration 194; tests.
  Sequence after 193 lands, or rebase.
- ⚠ **A latent bug in that in-flight work** will surface first: `run.ts` sets
  `pricing_path: 'grounding_review'`, which violates `quotes_pricing_path_check` (migration
  127 allows only `deterministic | opus_fallback | inspection`); `supabase-js` returns
  `{error}` rather than throwing, so the subsequent `quote!.id` dereference crashes the draft
  route. Not this spec's fix, but it blocks any live EV verification — raise it with that
  session.
- Money stays deterministic: every figure comes from `lib/quote/money.ts` or a grounded line
  item. The template renders; it never computes a new price.
- Australian English, no emoji, no exclamation marks, no em-dashes in customer-visible copy,
  WCAG AA contrast, prices in mono with tabular numerals.
- Any DB change is a numbered migration plus `_down` plus a runner script, applied to prod,
  with `sql/init.sql` kept representative.
- New `lib/` modules must be reachable from the three exported routes' import graph or they
  are silently omitted from the carve-out. `lib/quote/pdf.ts` is already in the closure, so a
  module it imports is carried automatically.
- Existing suites must stay green: `pnpm test` (`--testTimeout=20000`), `pnpm typecheck`,
  `node --import tsx scripts/test-sms-parity.mjs`, no new lint errors on touched lines.
- Gotenberg fetches fonts from Google at render time; use only Manrope 400/600/700/800 and
  JetBrains Mono 400/600 or the weights are synthesised.

## Edge cases to handle

- `needs_inspection = true` (explicit three-phase, sanity bounds, supply fence) → no document
  at all; `/api/q/[token]/pdf` 404s and the customer gets the $99 SMS. Unchanged.
- `job_type = 'ev_charger'` on a non-electrical trade, or a null `job_type` → generic report,
  byte-identical to today.
- `FULL_QUOTE_DOC='true'` (set in the fleet `.env`) with a non-null `quotes.report_doc` → the
  serializer path wins over the EV template, by design. SMS-origin quotes never carry a
  `report_doc`, so this only affects a quote a tradie edited in the document editor; the EV
  branch must sit **after** that check, not before it.
- Tradie edited the quote and the edit route stripped `source` → phases still classify from
  the description, exclusions contribute nothing for that assembly, and the section is omitted
  if empty. No crash, no blank heading.
- `estimate_number` write fails or the column is missing (migration not yet applied) → render
  with `quote.id.slice(0,8).toUpperCase()`; document still produced; SMS still sent.
- No street address in the thread → Site Address prints the suburb; if neither exists the
  block is omitted. Never print a remembered address as this job's address.
- Customer refused or never gave an email or phone → those Prepared For lines are omitted, not
  rendered blank.
- `gst_registered = false` → no GST row, `Total` equals the subtotal, both GST sentences drop.
- Tenant has no logo, no ABN and no licence (orphan `tenant_id IS NULL` rows) →
  `loadTenantBranding` returns the fallback business name and the header block prints only
  what exists; the document must still render.
- Only one tier visible (the platform default `single`) → one set of phased tables and one
  totals block.
- Zero `ev_charger` catalogue rows and `supplied_by = 'tradie'` → install-only document; the
  charger unit appears under Exclusions, not Inclusions, and Phase 2 holds only the mount and
  commissioning labour.
- Tier has exactly one line item that classifies as Phase 2 → render a single table, still
  labelled Phase 1, per R4's single-phase rule.
- Document exceeds the 5 MB MMS cap → images drop first (R14); the SMS falls back to
  link-only, which `dispatchQuoteWithPdf` already handles.
- Gotenberg unreachable → `ensureQuotePdf` returns null, the SMS omits `PDF copy:`, and
  `/api/q/[token]/pdf` returns 503 with no cached copy. Unchanged.

## Definition of done

- [ ] `lib/quote/report-html-ev-charger.ts` exists, is pure, and its unit test asserts every
      section in the R3 order with the exact `Description / Qty / Rate / Amount` headers.
- [ ] Selection test: `ev_charger` + `electrical` renders the EV document; every other
      job_type and trade combination produces output byte-identical to HEAD.
- [ ] `evChargerPhase` test green over the EST-0534 and EST-0565 line sets; Group Totals sum
      to the tier subtotal; the single-phase case renders one table.
- [ ] `report-chrome.test.ts` proves output is unchanged without `titleText` /
      `introMetaHtml`, and uses them when supplied.
- [ ] `quotePdfSignature` without `templateKey` is byte-identical to HEAD; `|tpl=ev1` appended
      when set. No `REPORT_TEMPLATE_VERSION` bump; `report-html.test.ts:326` untouched.
- [ ] Migration 194 applied to prod with `194_down.sql` and a runner; PGlite migration test
      green; `sql/init.sql` updated.
- [ ] Estimate-number test: null column renders the 8-character fallback and still produces a
      document; a failed write does not throw.
- [ ] Terms test: all five lines present, with the $99 line and the ex-GST line replacing the
      deposit and include-GST lines; no `$360`, `$580` or `$150` appears anywhere in the
      rendered output.
- [ ] GST test: `gstRegistered: false` omits the GST row and both GST sentences.
- [ ] `/q/[token]` for an EV quote shows the same estimate number, Valid Until, Inclusions,
      Exclusions, Optional Upgrades and Terms as the PDF, from the shared helpers.
- [ ] `pnpm test` green, `pnpm typecheck` clean, `node --import tsx scripts/test-sms-parity.mjs`
      green, zero new lint errors on touched lines.
- [ ] Visual check: one rendered EV PDF placed beside `Proposal-EST-0565.pdf` — every section
      present in the same order, in QuoteMax warm-paper light register with Manrope and
      JetBrains Mono, square corners, yellow as fill only.
- [ ] Carve-out hand-written files upstreamed or their loss explicitly signed off (R12.2),
      recorded in the PR body.
- [ ] `scripts/check-receptionist-env.mjs` clean, `export-receptionist.mjs electrical` diff
      reviewed and containing R1–R10, carve-out `npm run typecheck` clean.
- [ ] Monolith and `qm-electrical-receptionist` deployed in the same window;
      `/api/health/deep` reports `missing: []`.
- [ ] `qm-front-desk` verified to need no change (grep result for EV / quote / PDF references
      recorded in the PR); no file in it modified.
- [ ] End-to-end replay on a test tenant and number: an EV enquiry produces a priced quote
      whose `PDF copy:` link opens the new estimate document and whose `/q/<token>` page
      agrees with it.
- [ ] `/code-review` pass on the diff before merge.

## Open questions

1. **Jon — estimate numbering.** A single platform-wide sequence gives every tenant gaps
   (EST-0534 then EST-0537). Acceptable, or does each tenant need its own run starting at a
   number they choose? Per-tenant numbering is a counter table rather than a sequence.
2. **Jon — surge protection and switchboard capacity.** The samples quote
   `$360 + GST` single phase, `$580 + GST` three phase and a `$150–$400` switchboard
   allowance. Nothing in QuoteMax can print those today. Add them as tenant catalogue rows so
   they price and ground properly, or leave them as unpriced "confirmed at your site visit"
   advisory text? R10 ships the second until answered.
3. **Jon — the 50% deposit line.** The samples promise it; the live funnel takes only the $99
   site visit and 302s every deposit link. R13 replaces the line. Confirm that is right, or
   sequence this behind `specs/post-visit-money-sequence.md`.
4. **Product — pagination.** The samples are multi-page A4 with "Page 1 of 2". QuoteMax
   renders every trade PDF as one continuous page. Keep the house behaviour (R-non-goal), or
   add a paginated Gotenberg path for this document?
5. **Product — "ESTIMATE" versus "Quote".** Every other QuoteMax surface says quote; the SMS
   says "Your QuoteMax quote for EV charger". The document will say ESTIMATE. Acceptable
   mismatch, or align the SMS wording for EV as well?
6. **Ops — the carve-out's hand-written files.** `form-offer.ts`, the three `*.check.ts` files
   and the `check` script exist only in the fleet and die on re-export. Upstream them into the
   monolith first, or accept their removal? R12 blocks on this answer.

---

## Appendix A — verbatim source content

Transcribed from the three PDFs so the build has the exact wording without re-reading them.

### Common header block (all three)
`Electrical3` · `ABN: 73 167 930 994` · `Lic: 270174C` ·
`5/93-95 South Creek Road Cromer 2099` · `0417297285`.
EST-0565 additionally carries the electrical³ logo top-left and a `Page 1 of 2` footer.

### Titles
- EST-0534 / EST-0541: large `ESTIMATE` with the number beneath, header block right.
- EST-0565: `EST-0565 • Tesla Gen 3 EV Charger Installation` as a single heading, and the
  date block is labelled `Proposal Details:` rather than sitting beside `Prepared For:`.

### Prepared For / Site Address / Date
- EST-0534: `No client selected`.
- EST-0541: `White House R E` / `Whitehouse Real Estate (Freshwater)` /
  `Shop2 6/ 8 Lawrence Street, Freshwater NSW 2096` / `sean@whre.com.au`;
  **Site Address** `68 Brighton Street, Freshwater NSW 2096`.
- EST-0565: `Carlos Silva Junior` / `carsilvajunior@gmail.com` / `0467 420 321` /
  `Frenchs Forest NSW 2086`.
- All three: `Date:` (13 Aug 2026 / 17 Aug 2026 / 30 Aug 2026), `Valid Until: 30 days`.

### EST-0534 — Standard 3-phase EV charger, client-supplied

**Description of Works**
- Installation of the Standard 3-Phase EV charger.
- The project involves the installation of a dedicated 3-phase circuit from the existing main
  switchboard to the designated charger location. This includes the installation of a 40A
  3-pole RCBO within the switchboard to provide necessary circuit protection.
- We will run 10 metres of 6mm 4-core and earth standard cable, surface-mounted using
  medium-duty conduit and secure fixings to ensure a neat and durable finish. The charger unit
  will be securely mounted to the wall and all electrical terminations will be completed.
- Following installation, the system will undergo comprehensive testing to ensure correct
  phase rotation and safety functionality before commissioning the unit for use.

**Assumptions**
- The existing switchboard has sufficient physical space and electrical capacity for the new
  3-phase RCBO.
- The installation path is clear of obstructions and provides easy surface-mount access.
- The client-supplied charger is in good working order and compatible with the site's
  electrical supply.

**Inclusions**
- Installation of 10 metres of 3-phase cabling and medium-duty conduit.
- Supply and installation of a 40A 3-pole RCBO.
- Wall mounting and electrical termination of the client-supplied EV charger.
- Testing and commissioning of the charger.

**Exclusions**
- Supply of the EV charger unit itself.
- Switchboard upgrades or remedial work to existing wiring.
- Underground trenching or complex containment systems.
- Patching or painting of surfaces.

**Line items**

*Phase 1 - Switchboard and Rough-in*

| Description | Qty | Rate | Amount |
|---|---|---|---|
| 40A 3-Pole RCBO 6kA | 1 EACH | $195.00 | $195.00 |
| 6mm 4 Core + Earth Orange Circular standard cable | 10 METRE | $11.34 | $113.40 |
| 25mm Medium-duty conduit - 4m lengths | 3 LENGTH | $16.80 | $50.40 |
| Conduit fittings, saddles, and fixings | 1 LOT | $67.50 | $67.50 |
| Install 3-phase RCBO and rough-in 10m cable run | 3 HOUR | $100.00 | $300.00 |

Group Total: $726.30

*Phase 2 - Fit-off and Commissioning*

| Description | Qty | Rate | Amount |
|---|---|---|---|
| Mount and terminate client-supplied EV charger | 1.5 HOUR | $100.00 | $150.00 |
| Testing, commissioning, and site cleanup | 1 HOUR | $100.00 | $100.00 |

Group Total: $250.00

Subtotal (ex GST): $976.30 · GST (10%): $97.63 · Total: $1,073.93

### EST-0541 — switchboard RCBO conversion

Not an EV job. Included only as layout evidence: it carries the **Site Address** block, has
**one** phase table (`Phase 1 - Switchboard RCBO Conversion`, 6 rows, units HOUR / EACH / SET),
and has **no** Optional Upgrades section. Its Assumptions include the visual-assessment
caveat: "Please note that our switchboard pricing is based on a visual assessment only. Final
pricing is subject to a site inspection by our licensed electrician. If additional work is
identified on site that was not visible in the photo assessment, we will discuss any variation
with you before proceeding." Subtotal $835.25 · GST $83.53 · Total $918.78.

### EST-0565 — Tesla Wall Connector Gen 3, tradie-supplied, single-phase

**Scope of Work** (lead paragraph, above Description of Works)
- Installation of the Tesla Wall Connector Gen 3 EV charger.
- We will supply and install a dedicated single-phase circuit from your main switchboard to
  the new charging location, running 6mm standard cable within 25mm medium-duty
  surface-mounted conduit over an estimated 6-metre run.
- The installation includes mounting the Tesla Wall Connector, fitting a 40A RCBO safety
  switch in the switchboard, and conducting full commissioning, verification, and testing of
  the charger.

**Description of Works**
- Isolate power and install 40A single-pole RCBO into existing switchboard
- Supply and install 25mm medium-duty PVC surface conduit route (approx. 6 metres)
- Draw 6mm 2 Core + Earth standard cable through conduit
- Securely mount and terminate Tesla Wall Connector Gen 3 unit
- Commission EV charger, perform initial operational testing, and clean up work area

**Assumptions**
- Existing switchboard has adequate physical space and electrical capacity for a new 40A RCBO
- Standard single-storey ground access with direct surface run
- Wall construction allows standard masonry or timber fixings for mounting the charger

**Inclusions**
- Supply of Tesla Wall Connector Gen 3 unit
- 40A RCBO circuit protection device
- All necessary 6mm standard cable, medium-duty conduit, saddles, fittings, and fixings
- Labour for electrical installation, termination, testing, and commissioning
- Site clean-up and packaging disposal

**Exclusions**
- Trenching, civil works, or underground conduit runs
- Repairs to existing damaged sub-mains or switchboard components
- Plaster patching, painting, or decorative wall repairs
- Repairs or modifications to client's vehicle charging port or internal hardware

**Optional Upgrades & Recommendations** (boxed, page 2)

> SURGE PROTECTION OPTION
> We highly recommend installing a Surge Protection Device (SPD) to safeguard your new
> electric vehicle, EV charger, and valuable household electronics against sudden voltage
> spikes. Power surges can occur from lightning strikes or grid fluctuations and can cause
> thousands of dollars in damage to sensitive electronics. Please note: These prices are
> strictly based on there being sufficient physical room available in your existing
> switchboard to fit the device.
> Single Phase Install: $360.00 + GST
> Three Phase Install: $580.00 + GST
>
> SWITCHBOARD CAPACITY NOTE
> If your switchboard does not have a spare circuit position available, an additional charge
> of $150 to $400 will apply to create space or upgrade the board. This will be confirmed at
> the time of installation.

**Images**: one product photo (Tesla Wall Connector).

**Totals** (this proposal shows no line-item table): Subtotal $1,536.09 · GST (10%) $153.61 ·
Total $1,689.70.

### Terms & Conditions (identical on all three)

Nested under `Estimate Terms:` on EST-0534 and EST-0541.

- This is an estimate, not a contract.
- Prices are valid for 30 days from the date of this estimate.
- Final price may vary based on actual work performed.
- A 50% deposit is required to commence work.
- All prices are in AUD and include GST.
