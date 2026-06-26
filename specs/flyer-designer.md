# Spec: Flyer Designer (dashboard)

> Build-ready spec. Implement EXACTLY this — no extra scope, no unrelated refactors.
> Paths are relative to the repo root; the app lives in `quotemate-automation/`.
> Read `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide before writing Next.js code (Next 16 has breaking changes).

## Objective

Add an in-app **Flyer Designer** to the tradie dashboard so a tradie can create a printable marketing flyer without leaving QuoteMate (today they go to Canva). It is a **template-based** interactive editor: the tradie picks a ready-made template that is auto-filled with their brand data, then edits text, fonts, colours, and images on an interactive canvas. Finished flyers are **saved to their account for re-editing** and can be **downloaded as PNG and print-ready PDF**. If the tradie has no QR code yet, they can generate one from inside the editor (reusing the existing QR builder) and drop it onto the flyer.

## Background — what to reuse (do NOT rebuild)

- **QR builder ("Feature 1")** — `quotemate-automation/lib/marketing/qr.ts` (`generateShortCode`, `renderQrPngBuffer`, `renderQrSvg`, `resolveDestination`), API at `quotemate-automation/app/api/dashboard/marketing/qr/route.ts` (`GET` list / `POST` create) and `.../qr/[id]/image/route.ts` (PNG/SVG image). QRs are stored in the `marketing_qrs` table keyed by `tenant_id`. The dashboard UI for it is `quotemate-automation/app/dashboard/invites/page.tsx` ("01 · QR Codes"). **Reuse this — do not create a second QR generator.**
- **Dashboard shell** — `quotemate-automation/app/dashboard/page.tsx` is a tabbed client SPA. New tabs register in the `Tab` union, `buildNav()`, `SIDEBAR_GROUPS`, `TAB_META`, and the conditional tab-render switch. The Marketing (`invites`) tab is added unconditionally; add Flyer the same way (no trade gate).
- **Tenant data** — fetched via `GET /api/tenant/me` with `Authorization: Bearer <token>`; the tenant record exposes `id`, `business_name`, `logo_url`, `owner_email`, `owner_mobile`, `trade`, `slug`. Use `getBrowserSupabase()` (`@/lib/supabase/client`) for the session token, matching the Solar/Signage tab pattern.
- **Marketing auth** — `quotemate-automation/lib/marketing/auth.ts` (`userFromBearer`, `tenantForUser`, `marketingSupabase`). New flyer API routes must authenticate the same way (Bearer token → tenant) and scope every query by `tenant_id`.
- **Migrations** — a DB change is a new `quotemate-automation/sql/migrations/NNN_*.sql` **plus** a `quotemate-automation/scripts/run-migration-NNN.mjs` runner, following the existing pattern. Next number is **150**.
- **Existing deps** — `qrcode`, `@supabase/supabase-js`, `zod`. Add `konva` + `react-konva` (interactive canvas) and `jspdf` (PDF export). No other new runtime deps.

## In scope

1. A **Flyer** dashboard tab + a self-contained editor.
2. **Templates**: at least 3 ready-made flyer template layouts, defined as data, each auto-filled from tenant brand fields (logo, business name, trade/headline, email, phone) plus a placeholder for a QR code.
3. **Interactive canvas editing**: select an element; edit text content; change font family, font size, and text colour; change element/background fill colour; move and resize elements; upload an image and place/swap it; delete an element.
4. **In-editor QR integration** (the conditional flow):
   - On open, detect whether the tenant already has a customer-facing QR code (any non-`signup` row in `marketing_qrs` for this tenant).
   - **If none exists**: show a "Generate QR code" button inside the editor that creates one via the existing `POST /api/dashboard/marketing/qr` (`destination_type: 'landing'`), then loads its image and adds it as an image element on the canvas. The new QR also appears in Feature 1's list automatically (same `marketing_qrs` table — single source of truth).
   - **If one or more already exist**: instead of the generate button, let the tradie insert an existing QR (its image) onto the canvas.
5. **Save & re-edit**: persist the flyer *document* (template id + element overrides) to a new `flyers` table so it can be reopened and edited later. List, open, rename, and delete saved flyers.
6. **Export**: download the current flyer as **PNG** and as **print-ready PDF**. Persist the latest exported PNG/PDF to Supabase Storage and record their paths on the `flyers` row.

## Out of scope (do NOT build)

- Freehand drawing/painting, arbitrary shape tools, layers panel, multi-page flyers (a later phase).
- Social-media auto-posting, scheduling, or sending flyers to customers.
- Rebuilding QR generation, CRM, calendar, or invoicing.
- Editing the customer quote PDF or the existing Gotenberg quote pipeline.

## Data model — migration 150

New table `flyers`:

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `tenant_id` | `uuid` not null → `tenants(id)` on delete cascade | every query scoped by this |
| `name` | `text` not null | user-visible flyer name; default e.g. "Untitled flyer" |
| `template_id` | `text` not null | which template the document is based on |
| `document` | `jsonb` not null default `'{}'` | the editable state: element overrides (text, fonts, colours, positions, image refs) |
| `png_path` | `text` | Supabase Storage path of the latest PNG export (nullable) |
| `pdf_path` | `text` | Supabase Storage path of the latest PDF export (nullable) |
| `created_by` | `uuid` → `auth.users(id)` (nullable) | |
| `created_at` | `timestamptz` not null default `now()` | |
| `updated_at` | `timestamptz` not null default `now()` | |

- Index on `tenant_id`. Enable RLS on the table (consistent with migration 040 Phase 1; service-role routes bypass it). No positive policies required (app-layer `tenant_id` filtering, like the rest of the app).
- A Supabase Storage bucket `flyer-assets` for uploaded images and exported PNG/PDF, namespaced by `tenant_id`. If buckets are created in SQL/migration elsewhere in this repo, follow that pattern; otherwise create it idempotently in the runner script.
- Provide `quotemate-automation/scripts/run-migration-150.mjs` following the existing runner pattern (`node --env-file=.env.local`). Keep `sql/init.sql` representative if that is the repo convention.

## Templates

- Define templates as **pure data** in `quotemate-automation/lib/flyer/templates.ts` — an array of template definitions. Each template is a fixed canvas size (e.g. A5/A4 portrait at a sensible pixel resolution) and an ordered list of elements. Element kinds: `text`, `image`, `rect` (background/blocks), and a reserved `qr` placeholder slot.
- Each `text` element has a `binding` to a tenant field (`business_name`, `headline`/trade, `email`, `phone`) or static copy, plus default font family, size, colour, and position.
- Provide a pure function in `quotemate-automation/lib/flyer/document.ts`:
  - `buildInitialDocument(template, tenant)` → produces the starting editable document by resolving bindings against tenant data (missing fields fall back to empty/placeholder, never crash).
  - `applyOverrides(template, document)` → merges saved overrides onto the template to produce the render model.
  - Validation via `zod` for the persisted `document` shape.
- At least **3** distinct templates (e.g. "Bold promo", "Clean services", "Contact card").

## Editor UI

- New route/component under `quotemate-automation/app/dashboard/flyer/` (a self-contained sub-feature like `signage/`), with a `_components/` folder. Register a `flyer` tab in `app/dashboard/page.tsx` that links to / renders it, added unconditionally next to Marketing.
- The interactive canvas uses `react-konva`. The canvas component must be **dynamically imported with `{ ssr: false }`** (Konva needs the browser). Selecting an element shows a properties panel to edit: text content (for text), font family (from a small curated list), font size, text colour, fill colour, and a delete control. Support drag-move and resize (Konva `Transformer`).
- A template picker (gallery of the 3+ templates) starts a new flyer. A "My flyers" list shows saved flyers to reopen/rename/delete.
- Image upload: a file input (reuse the logo-upload validation constraints from `app/dashboard/page.tsx` — allowed mime png/jpeg/webp, ~2 MB cap) → upload to the server → receive a URL → add as an image element.
- Styling: Tailwind + Maintain tokens, consistent with existing dashboard tabs (`app/dashboard/_components/quote-ui.tsx` helpers, deep-ink canvas, orange accent, borders-not-shadows, square corners). Do not introduce a new visual language.

## API routes (auth = Bearer → tenant, scope by tenant_id)

- `quotemate-automation/app/api/dashboard/flyer/route.ts`
  - `GET` → list this tenant's flyers (`id, name, template_id, png_path, pdf_path, updated_at`).
  - `POST` → create a flyer `{ name?, template_id }`; returns `{ ok, id }`.
- `quotemate-automation/app/api/dashboard/flyer/[id]/route.ts`
  - `GET` → one flyer (incl. `document`), ownership-checked.
  - `PATCH` → update `{ name?, document? }`, ownership-checked, bumps `updated_at`.
  - `DELETE` → delete, ownership-checked.
- `quotemate-automation/app/api/dashboard/flyer/[id]/export/route.ts`
  - `POST` `{ png: <dataUrl> }` → store the PNG in `flyer-assets/<tenant_id>/...`, generate the PDF (embed the PNG at flyer dimensions), store it, update `png_path`/`pdf_path`, return download URLs. PDF generation must not depend on a live external service in tests (do it from the PNG; jsPDF on the client is acceptable for producing the PDF bytes, with the server persisting them).
- `quotemate-automation/app/api/dashboard/flyer/upload/route.ts`
  - `POST` multipart image → validate mime/size → store under `flyer-assets/<tenant_id>/uploads/...` → return `{ url }`.
- Follow the repo convention of testing API routes by exporting pure handler-logic functions and unit-testing those (see `app/api/solar/confirm/[token]/route.test.ts`).

## Requirements (checkable)

- **R1** A `flyer` tab appears in the dashboard for every tenant (no trade gate) and opens the Flyer Designer.
- **R2** The template picker shows ≥3 templates; choosing one creates a flyer auto-filled with the tenant's `business_name`, `logo_url`, trade-derived headline, `owner_email`, and `owner_mobile`.
- **R3** The tradie can select an element and change: text content, font family, font size, text colour, and fill/background colour; changes render live on the canvas.
- **R4** The tradie can upload an image (mime/size validated) and place or swap it on the canvas; the image persists in the saved document.
- **R5** The tradie can move and resize elements.
- **R6** On open, the editor detects whether the tenant has a non-`signup` QR in `marketing_qrs`. If **none**, a "Generate QR code" button creates one via the existing `POST /api/dashboard/marketing/qr` (`landing`) and places its image on the canvas. If **one+ exists**, the generate button is hidden and an "Insert existing QR" path is offered instead.
- **R7** A QR generated from the editor is written to `marketing_qrs` (it shows up in Feature 1's "01 · QR Codes" list) — confirmed by reusing the existing endpoint, not a new table.
- **R8** Saving persists the flyer document to the `flyers` table; reopening restores the exact editable state (templates, text, fonts, colours, images, positions).
- **R9** The tradie can list, rename, and delete saved flyers; all flyer queries are scoped to the caller's `tenant_id`.
- **R10** The tradie can download the flyer as PNG and as PDF; the latest PNG/PDF are stored in `flyer-assets` and their paths recorded on the `flyers` row.
- **R11** Migration 150 (`flyers` table + `flyer-assets` bucket) and `run-migration-150.mjs` exist and follow the repo's migration conventions.
- **R12** All money/QR/tenant logic is `tenant_id`-scoped and Bearer-authenticated; no route leaks another tenant's flyers or QR codes.

## Edge cases

- **E1** Missing tenant brand fields (no logo, no phone, no email) → templates render with empty/placeholder slots, never crash.
- **E2** Tenant already has multiple QR codes → no duplicate auto-generation; the "Insert existing QR" path lists them.
- **E3** QR generation fails (e.g. `no_sms_number` / `slug_failed`) → surface a clear inline error; the editor stays usable.
- **E4** Oversized or wrong-type image upload → rejected with a clear message (match logo-upload limits).
- **E5** Unauthoranged/cross-tenant access to a flyer id → `401`/`403`/`404` as appropriate; never returns another tenant's data.
- **E6** Re-export overwrites/refreshes `png_path`/`pdf_path` without creating orphan rows.
- **E7** Konva/SSR: the canvas must not break the server build (dynamic `ssr:false` import); `pnpm build` and `pnpm typecheck` succeed.

## Constraints

- Reuse the existing QR builder and marketing auth; do not duplicate QR generation.
- Next 16 App Router conventions; read `AGENTS.md` + `node_modules/next/dist/docs/` first.
- Tailwind + Maintain design tokens only; no new design system.
- Add only `konva`, `react-konva`, `jspdf` as new runtime deps.
- DB change = migration 150 + runner; scope everything by `tenant_id`; enable RLS on `flyers`.
- Do not commit secrets; scripts run with `node --env-file=.env.local`.

## Definition of done

- **D1** `pnpm typecheck` passes (no TS errors).
- **D2** `pnpm lint` passes.
- **D3** `pnpm test` passes — the full vitest suite, including new unit tests for: template definitions, `buildInitialDocument`/`applyOverrides`, the `document` zod schema, QR-presence detection, image-upload validation, the flyer API handler-logic functions, and the PDF page-sizing helper. **No existing test may regress.**
- **D4** `pnpm build` succeeds (Konva dynamic import does not break SSR).
- **D5** Every R# and E# above is implemented and covered by a test or a clear manual-verification note where UI-only.

## Test plan (what "All tests pass" gates on)

Add colocated `*.test.ts` (Node env, import from `vitest`) covering at minimum:
- `lib/flyer/templates.test.ts` — ≥3 templates, each well-formed (valid element kinds, has a QR slot, bindings reference real tenant fields).
- `lib/flyer/document.test.ts` — `buildInitialDocument` fills bindings and tolerates missing fields (E1); `applyOverrides` merges correctly; zod schema rejects malformed documents.
- `lib/flyer/qr-presence.test.ts` (or equivalent) — given a `marketing_qrs` result set, correctly decides generate-vs-insert (R6, E2).
- `lib/flyer/upload.test.ts` — mime/size validation accepts/rejects per limits (R4, E4).
- `lib/flyer/pdf.test.ts` — page-size/orientation derived from flyer dimensions (R10).
- `app/api/dashboard/flyer/route.test.ts` and `[id]/route.test.ts` — handler-logic unit tests for create/list/get/patch/delete ownership + validation (R8, R9, R12, E5), following the repo's route-test convention.

Run order for the loop: `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm build`. Loop until all pass with no regressions.
