# Full-Quote Editing v2 — living document, three protection tiers — Design

> Date: 2026-07-06 · Status: approved design (brainstorm w/ product owner) · Supersedes the un-built document-field parts of [`2026-07-02-full-quote-editing-design.md`](2026-07-02-full-quote-editing-design.md)
> Prior art still valid: the chat-edit primitive (`lib/quote/chat-edit.ts`), the manual editor (`app/q/[token]/TradieEditor.tsx`), the grounded save (`app/api/quote/[id]/edit/route.ts`), the shell+adapter viewer (`app/dashboard/quote/[token]`), and the Gotenberg pipeline (`lib/quote/report-html.ts` → `lib/pdf/gotenberg.ts`).

## 0. Terminology

"Full-code / full-quote editing" = editing the **generated customer quote document** (the `/q/[token]` page + its Gotenberg PDF), not source code. The artifact is the quote. Nothing in this repo generates per-customer code.

## 1. Overview

Today the quote is edited through two **modal** surfaces — `TradieEditor` (line-item form) and `QuoteEditChat` (AI propose-only) — over a **read-only** preview. Only tier line items are editable. Title, scope, assumptions, fonts, colours and logo are not editable at all.

This design turns the quote into a **living document** with three levels of protection:

1. **De-modaled layout.** The customer-facing Full Quote *is* the editor. Tradies type and style directly into it (title, body text, fonts, colours, logo — this quote only). Beneath the live preview sit three always-present edit sections (Pricing · Edit with AI · Manually edit report) and one sticky **Save & Apply Edits** bar. No pop-up modals.
2. **Three protection tiers.** Every edit — manual or AI — is classified: **Tier 1 Free** (content & look), **Tier 2 Guarded** (pricing, must stay grounded), **Tier 3 Owner-only** (legal & identity, owner + confirm). The tier decides what it takes to change the field, so essential information is never altered carelessly.
3. **One commit.** Typing is live on screen; the *customer's* quote and PDF change only when the tradie presses **Save & Apply Edits**.

**The invariant that never moves (unchanged from all prior money-safety work): a price is never free-typed.** `good/better/best` jsonb stays the single source of truth for money. The document editor restyles everything *around* the pricing block, but the numbers themselves only change through the existing grounded Pricing path (`validateQuoteGrounding` + `detectCrossTierDuplicates` on save; off-catalogue → explicit override; ungrounded quotes still fall back to the $99 inspection route). Stripe re-issue, SMS templates, publish gates, and the PDF cache continue to read the same structured row.

## 2. Current-state analysis

| Concern | Today | Change |
|---|---|---|
| Layout | `QuoteReportViewerClient` shows a read-only iframe; `TradieEditor` + `QuoteEditChat` open as full-screen modals | Inline: live editor + three stacked sections + one Save bar; modals removed |
| Editable | Tier line items only (label, description, qty, unit price) | + document content (title/scope/notes/terms as rich text), + per-quote branding (logo/colour/font), pricing unchanged |
| Preview | Read-only; `data-section` not present; refreshes only after save (`reloadKey`) | The preview *is* the editor for content; PDF still regenerates on save |
| Document fields | `report_title` proposed in the 2026-07-02 spec but **never built**; heading is the hard-coded "Quotation" (`lib/pdf/report-chrome.ts`); scope/assumptions render but aren't editable | New `report_doc` document model carries title + all prose |
| Branding | Tenant-global only (tenants row + tenant_licences); no per-quote override | New per-quote `report_style` override, allow-listed |
| Money path | `POST /api/quote/[id]/edit` recomputes totals, re-runs grounding, re-issues Stripe, invalidates PDF | **Reused unchanged** for the Pricing section |
| Sensitive fields | licence/GST on pricing_book + tenant_licences; business identity on tenants; not editable in the quote flow | Tier-3: shown read-only in the editor; changed via a separate owner-gated + confirmed action |

Confirmed at spec time (2026-07-06): highest migration is **160** (next = **161**); `report_doc`/`report_style`/`report_title` do **not** exist in code or SQL; no rich-text editor or HTML sanitizer is in `package.json` yet.

## 3. Data model (migration 161)

```sql
-- 161_full_quote_document.sql
alter table quotes add column report_doc   jsonb null;  -- block document (ProseMirror/TipTap JSON): title, prose, headings, lists, images. NO prices.
alter table quotes add column report_style jsonb null;  -- per-quote branding override: { logoPath?, accentColor?, fontFamily?, headingStyle? }. Null → tenant global brand.
comment on column quotes.report_doc is
  'Tradie-authored quote document (content + structure). Prices are NOT stored here; the pricing block is a locked node that renders from good/better/best.';
comment on column quotes.report_style is
  'Per-quote branding override (allow-listed). Null falls back to the tenant global brand. Never affects other quotes.';
```

- `good/better/best` (money), `scope_of_works`/`assumptions` (kept as plain-text mirrors for SMS/back-compat), `selected_tier`, `pdf_path`, `pdf_signature` — **unchanged columns**.
- **No new per-user "full-code" table** (rejected in the 2026-07-02 spec, still rejected): wrong tenancy axis, forks the source of truth, IDOR-shaped.
- `report_doc` is seeded lazily: on first open of a quote without one, the server converts the current template output (title + scope + assumptions + one pricing node + notes) into blocks. No bulk backfill required.

### 3.1 `report_style` allow-list (not arbitrary CSS)

`fontFamily ∈` a fixed set (e.g. `system | serif | Aptos-like | mono`); `accentColor` matched against a hex allow-list or a bounded palette; `headingStyle ∈ {plain, underline, bar}`; `logoPath` must be a storage object path in the tenant's own bucket prefix. Validated with Zod on write; anything off-list is rejected, never stored.

## 4. The three tiers (field classification)

| Tier | Fields | Who / how | Enforcement |
|---|---|---|---|
| **1 · Free** | document title, headings, scope, intro, notes, terms; fonts, colours, highlight, lists; **logo + layout — this quote only** | anyone with edit access, typed directly into the document | sanitize on write; `report_style` allow-list; per-quote only |
| **2 · Guarded** | line item description/qty/price, tier subtotals, recommended tier / headline | edit allowed but **must stay grounded** | existing `/edit` grounding gate; off-catalogue → 422 → explicit override |
| **3 · Owner-only** | licence number, GST status, business name, ABN, deposit % / payment terms, anything feeding a Stripe amount | account **owner + confirm** | owner-gated endpoint + confirm step; staff/AI cannot touch |

The scope selector on the AI and Manual sections maps 1:1 to these tiers. **Contents** = free; **Pricing** = grounded; **Sensitive** = owner-only.

**Tier-3 split (owner-approved refinement):** deposit % is editable per-quote (owner + confirm). Licence / GST / ABN / business name are **global identity** edited once in owner settings and shown **read-only** on the quote — a single quote must never claim a different licence.

## 5. UI / layout

Maintain design system (ink-navy panels, `#FF5F00` accent, mono uppercase micro-labels). See the approved mockup artifact.

```
┌ dashboard/quote/[token] · edit ─────────────────────────────┐
│  FULL QUOTE · live document editor                          │
│  ┌ toolbar: font · size · B I U · colour · highlight · logo┐│
│  │  <editable title>                                       ││
│  │  <editable scope / prose>                               ││
│  │  ┌ LOCKED pricing node (Good/Better/Best) ────────────┐ ││
│  │  │  grounded prices — edit in Pricing section below   │ ││
│  │  └────────────────────────────────────────────────────┘ ││
│  │  <editable notes / terms>                               ││
│  └──────────────────────────────────────────────────────────┘│
│  [1] Pricing            (Guarded · grounded)      ▾         │
│  [2] Edit with AI       (Contents|Pricing|Sensitive) ▾     │
│  [3] Manually edit report (Contents|Pricing|Sensitive) ▾  │
│  ── sticky ──────────────────────────────────────────────  │
│  ● Unsaved changes      [Download PDF] [Discard] [Save & Apply Edits] │
└─────────────────────────────────────────────────────────────┘
```

- **One shared working draft** (client state) feeds the live editor, the three sections, and drives Save. Editing in the doc and applying an AI proposal mutate the *same* draft.
- **Live in-editor; committed on Save.** Content edits render instantly in the editor; the customer's quote + PDF change only on **Save & Apply Edits**.
- **Locked pricing node** is `contenteditable=false`. Double-click / the Pricing section opens the existing grounded editor. No keystroke can alter a price.
- **Unsaved-work safety:** the working draft is mirrored to `sessionStorage` keyed by quote id so a refresh doesn't lose a half-written scope; nothing reaches the customer until Save.
- **Mobile:** the editor and the three sections stack; the Save bar is always visible.

## 6. Editing model & save flow

### 6.1 Manual
- **Contents:** typed directly into the document (primary), and/or a structured field view for precise edits.
- **Pricing:** the existing line-item form (reused verbatim) → `POST /api/quote/[id]/edit`.
- **Sensitive:** read-only unless owner; deposit % editable via owner-confirm; identity fields deep-link to owner settings.

### 6.2 AI (`/api/quote/[id]/chat-edit`, extended)
- **Contents scope:** a prose-editing mode with **no price tools** — it rewrites title/scope/notes and returns a document diff; it can never emit a price.
- **Pricing scope:** the existing grounded propose-only flow, unchanged (catalogue lookup tools, grounded flag, reviewable diff).
- **Sensitive scope:** disabled unless owner; even then routes through the owner-confirm path, never a raw write.
- Propose-only preserved: the AI never persists; the tradie Applies into the working draft, then Saves.

### 6.3 `Save & Apply Edits` — one commit
1. **Draft** — collect doc + style + pricing + any confirmed Tier-3 change.
2. **Guard** — re-run grounding on pricing (off-catalogue blocked unless overridden); validate `report_style` allow-list; sanitize `report_doc` prose.
3. **Money** — persist `good/better/best`; re-issue Stripe **only** for tiers whose subtotal moved (unchanged logic in `/edit`).
4. **Render** — extend `pdf_signature` to include a content hash of `report_doc` + `report_style`, null `pdf_path`, regenerate the PDF from the document.
- **Tiered save:** content/style-only saves are **quiet** (no Stripe, no auto-notify; optional "Notify customer"). Price changes keep the existing confirm/notify/re-issue flow.

## 7. Rendering — deterministic doc → HTML → PDF

- New `lib/quote/report-doc/serialize.ts`: a **pure, deterministic** serializer from `report_doc` JSON → HTML. Every text node passes through the existing `esc()`; only allow-listed node/mark types emit markup; `report_style` maps to allow-listed inline styles. **The pricing node serializes via the existing `tierSection()` from `report-html.ts`**, reading `good/better/best` — so prices come from structured data, PDF == editor, and `tier-visibility.ts` still gates which tiers the customer sees.
- We do **not** ship ProseMirror to the server bundle: the serializer walks the JSON ourselves (mirrors the determinism/unit-test posture of `report-chrome.ts`). Gotenberg (`lib/pdf/gotenberg.ts`) is unchanged.
- `renderQuoteReportHtml` and `ensureQuotePdf` keep sharing one input builder so screen and PDF never drift.

## 8. Editor technology

- **TipTap v2 (ProseMirror)** for the block editor: React-friendly, JSON document (= `report_doc`), custom `NodeView` for the locked `pricingTable` node. Client-only (`'use client'`), SSR the initial content read-only per Next 16 App Router (read `node_modules/next/dist/docs/` before writing — see `AGENTS.md`).
- **Sanitizer** for defence-in-depth on any stored prose before it reaches Gotenberg's Chromium. Primary control remains `esc()` in the deterministic serializer (§7); the sanitizer is belt-and-braces on the JSON prose.
- New dependencies (`@tiptap/*`, sanitizer) added in Phase 1; Phase 0 needs none.

## 9. Security & permissions

- **Identity from Bearer only.** Every write performs the existing quote→tenant→owner chain. Tier-3 edits additionally require `tenant.owner_user_id === userId` + a confirm step; route tests cover non-owner-403 and cross-tenant-403.
- **XSS / Gotenberg SSRF is the real threat** (Chromium executes JS server-side with network access, per the 2026-07-02 §7 analysis). Therefore: **every prose text node and every `report_style` value routes through `esc()` / the allow-list in the deterministic serializer**, exactly like today's `esc(scopeOfWorks)`. Unit test: `<script>`/`onerror` payloads in title, scope, notes, and a crafted `logoPath` render escaped/rejected.
- `report_style.logoPath` must resolve inside the tenant's own storage prefix (no arbitrary URLs, no SSRF via a remote logo).
- Money-safety carries over verbatim: paid → 409 immutable; inspection → 409; grounding 422 → override for catalogue trades; tradie-authored trades keep diff-review.

## 10. Guardrails that must hold (regression risks)

1. **Money never becomes text** — `good/better/best` stays canonical; all price changes go through the unchanged `/edit` grounding gate. The pricing node stores a pointer, not prices.
2. **PDF staleness** — `pdf_signature` currently hashes only template version + tier mode + visible tiers. It **must** be extended to hash `report_doc` + `report_style`, or content/brand edits silently won't reach the PDF (the exact bug mig 146 fixed for tier-mode).
3. **Tier-visibility leakage** — `resolveVisibleTiers()` hides tiers per `pricing_book.quote_tier_mode`, computed fresh each render. The serializer must re-apply visibility at render time so a hidden tier/price never leaks into the customer PDF.
4. **Per-trade adapters** — solar/roofing/painting render from their own measurement tables, not `good/better/best`. Phase 1 targets the shared `report-html.ts` template (electrical/plumbing + the quotes-row trades); dedicated-builder trades adopt `report_doc` only when their adapters do. Registry gains an `editorKind: 'block-doc'` variant.
5. **Sanitization** — all rich content allow-listed on write; fonts/colours are tokens, not raw CSS.
6. **PDF == editor** — the doc→HTML serializer (esp. the pricing path via `tierSection()`) must be pure and unit-tested like `report-chrome.ts`.
7. **Stripe correctness** — re-issue keeps deriving amounts from recomputed structured subtotals, never from document text; `/edit` stays the single money write path.

## 11. Delivery phases (each gated on `pnpm typecheck` + `vitest run`; route tests mirror existing patterns)

- **Phase 0 — foundations (backend-only, invisible, no new deps).**
  Migration 161 (`report_doc`, `report_style`); `report_style` Zod allow-list + validator; `lib/quote/report-doc/serialize.ts` deterministic serializer (+ `esc()` XSS tests) rendering title/prose/notes + the pricing node via `tierSection()`; extend `lib/quote/pdf-signature.ts` to hash `report_doc`+`report_style`; a `report_doc` seed/converter from the current template. All behind a `FULL_QUOTE_DOC` flag; live rendering path unchanged until Phase 1. **Prod migration applied only on explicit go-ahead.**
- **Phase 1 — de-modaled editor + content editing + per-quote branding.**
  Replace the modal viewer with the inline layout (live TipTap editor + stacked sections + Save & Apply bar); locked `pricingTable` NodeView opening the existing Pricing form; branding toolbar → `report_style`; content-only quiet-save path; wire the serializer into the live render behind the flag, then flip. Add `@tiptap/*` + sanitizer deps. `data-section` anchors for change highlighting.
- **Phase 2 — scope selectors + AI content mode + Tier-3 owner-confirm + audit.**
  `Contents|Pricing|Sensitive` selector on both tools; prose-only AI mode (no price tools); Tier-3 owner-gated confirm flow (deposit % per-quote; identity via settings); `quote_revisions`-style audit for content edits.

## 12. Drift logged (per CLAUDE.md convention)

This **overrides** the 2026-07-02 spec's "Preview ≠ Word — the preview is not contentEditable" decision (§5.1 there). That rule existed to stop ungrounded prices and iframe-sandbox issues. The **locked-price-node** design removes the money risk (prices are a non-editable node rendered from structured data), so `contenteditable` is now safe **for content only**. Money-safety is unchanged; only the *content* becomes free-form. Recorded here as the superseding decision.

## 13. Open questions / assumptions

1. **Editor lib** assumed TipTap v2; confirm before Phase 1 (alternatives: Plate, Lexical). Chosen for the custom-node + JSON-document fit.
2. **Tier-3 identity edit location** — assumed owner-settings (global) for licence/GST/ABN, per-quote confirm only for deposit %. Confirm.
3. **Concurrency** — two tabs on one quote is last-write-wins today; acceptable for a single-owner tool. Add an `updated_at` optimistic check to `/edit` if it bites.
4. **Dedicated-builder trades** (roofing/solar/painting) get `report_doc` only when their adapters adopt it; electrical/plumbing + quotes-row trades first.
