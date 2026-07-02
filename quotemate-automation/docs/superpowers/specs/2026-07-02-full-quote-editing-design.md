# Full-Quote Editing (AI + manual, live preview, audit) — Design

> Date: 2026-07-02 · Status: reviewed design (3-lens adversarial pass + same-day source-verification pass, see §11) · Author: senior-eng design pass
> Extends: [`2026-06-25-pdf-quote-viewer-edit-design.md`](2026-06-25-pdf-quote-viewer-edit-design.md) (shell+adapter viewer, implemented) and the chat-edit primitive (`lib/quote/chat-edit.ts`).
> Related fix: `/api/quote/[id]/edit` now invalidates `quotes.pdf_path`/`pdf_signature` on every save (2026-07-01), so a saved edit always reaches the next PDF render.

## 0. Terminology assumption (confirm before build)

The brief said "full-code editing in CodeMax". This design reads that as **full-QUOTE editing in QuoteMax** (speech-to-text artifact): the artifact being edited is the generated quote document — the `/q/[token]` page and the Gotenberg PDF — not source code. Nothing in this repo generates per-customer code. If "code" genuinely meant something else, stop and re-scope.

## 1. Overview

Today the "Edit Quote Pricing" surface (TradieEditor + QuoteEditChat) edits **tier line items only**, and the AI chat is **stateless** (each message is sent with zero conversation history — `proposeQuoteEdit` builds exactly one system + one user message). The observed failures follow directly:

- "yes please" / "all items, and a $9000 fee" → *"I'm not sure what change you'd like to make"* — the model asked a clarifying question, but the follow-up answer arrives with no memory of the question (`lib/quote/chat-edit.ts` `proposeQuoteEdit`, single-turn `messages`).
- "change the title" → impossible: the proposal schema only carries `tiers.{good,better,best}`; `scope_of_works`, `assumptions`, `estimated_timeframe`, and the report title are not editable by chat or by the manual editor.
- No live sense of "what will the customer's document look like" while editing — the dashboard viewer shows the *last rendered PDF*, refreshed only after Save.

This design upgrades that surface into **full-quote editing**:

1. **Chat with memory** — multi-turn conversation so clarifying flows work.
2. **Document-level edits** — title, scope of works, assumptions, timeframe, recommended tier — via both chat and manual fields.
3. **Live preview** — a side-by-side rendered document that updates (debounced) from the *unsaved* working draft, with changed sections highlighted.
4. **Audit trail** — an append-only `quote_revisions` table + a history drawer.

**The one invariant everything hangs off (already codified in the 2026-06-25 design's non-goals): the document is a pure projection of structured data.** PDF = `f(quotes row, pricing_book, branding, template)`. We never store edited HTML/PDF, and we never let free-form text become a price. All existing money-safety machinery (tool-calling-only prices, grounding validator, Stripe re-issue, publish gates, PDF cache invalidation) continues to operate on the same single source of truth.

**Two nuances the review pass surfaced (both folded in below):**
- `scope_of_works`/`assumptions` are **grounding inputs**, not inert prose — they feed `detectCrossTierDuplicates`' framing check (§4.2.3).
- `selected_tier` **moves money** — it picks the headline price (and under `single` tier mode, the only price the customer sees). It is treated as a pricing field, not a document field (§4.2.2).

## 2. Current state analysis

| Concern | Today | Gap |
|---|---|---|
| Manual edit | `TradieEditor` → `POST /api/quote/[id]/edit` (tier labels/timeframes/line items; recompute totals; Stripe re-issue for changed tiers; grounding gate for catalogue trades; PDF cache invalidated on save) | No document-level fields; body with no tier edits is rejected `400 no_changes` (route.ts:139-141); `timeframe` is held in editor state and POSTed but has **no visible input** in the modal — label + line items are the only fields a tradie can actually edit today |
| AI edit | `QuoteEditChat` → `POST /api/quote/[id]/chat-edit` (propose-only; diff; "Apply to editor"; grounding pre-check mirrors save gate) | Stateless (no history); tier-only schema; thread state lives inside the modal and dies when it closes |
| Viewer | `/dashboard/quote/[token]` (`QuoteReportViewerClient`): inline PDF iframe, `reloadKey` cache-bust after save | Preview only reflects *saved* state; whole-PDF reload; no change highlighting |
| **Entry surface** | The tradie-review SMS link points at **`/q/[token]?edit=1`** (`app/api/estimate/draft/route.ts` ~1035), opening the TradieEditor modal on the customer page — *not* the dashboard viewer | The phone-first persona never reaches the dashboard viewer unaided (§5.0 decision) |
| Document title | The rendered heading is the **hard-coded `Quotation`** (`lib/pdf/report-chrome.ts` `renderReportDocument`); `prettyJobType(intake.job_type)` appears only inside the intro sentence; HTML `<title>` is `Quote — ${businessName}` | **No editable title element exists** — adding one is new template work, not an override of an existing slot |
| Audit | `risk_flags` append-only strings (`tradie_manual_line:*`, `tradie_edit_ungrounded:*`) | No who/when/what history; no UI |
| Adapters | `lib/quote/report-adapters/registry.ts` — every quotes-row trade (incl. roofing/solar/painting) uses the same editor + `/api/q/[token]/pdf`; catalogue vs tradie-authored grounding per trade | Design below stays trade-agnostic at the shell, per-trade only in grounding — same split as today |

## 3. Data model

### 3.1 `quotes.report_title` (new nullable column) — **a new template element**

```sql
-- migration 160+ (159_conversation_followup_2h is the highest as of 2026-07-02)
alter table quotes add column report_title text null;
comment on column quotes.report_title is
  'Tradie-set customer-facing document heading. Null → the static "Quotation" heading (legacy).';
```

Render placement (this is **new visible chrome**, shared by every trade using `report-chrome.ts` — bump `REPORT_TEMPLATE_VERSION`):
- `renderReportDocument` heading becomes `report_title ?? 'Quotation'` (escaped — §7).
- The intro sentence keeps deriving from `intake.job_type` (unchanged; changing what the customer *asked for* is not in scope).
- SMS templates keep deriving from `job_type` — the title changes the document heading only.

Editing the *intake* to change a title is rejected: intakes are source-of-record for what the customer asked for.

### 3.2 `quote_revisions` (new append-only audit table)

```sql
create table quote_revisions (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references quotes(id) on delete cascade,
  tenant_id     uuid not null,      -- always available on the single write path; NOT NULL so
                                    -- Phase-2 tenant-scoped RLS covers every row (no orphan class)
  actor_user_id uuid null,          -- auth.users id of the tradie who saved
  source        text not null check (source in ('manual','ai_chat')),  -- 'system' added only when a system writer exists
  instruction   text null,          -- the chat prompt(s) behind an ai_chat save
  changes       jsonb not null,     -- compact field-level before/after (see below)
  created_at    timestamptz not null default now()
);
create index on quote_revisions (quote_id, created_at desc);
alter table quote_revisions enable row level security;  -- no anon policy (Phase-1 RLS posture)
```

`changes` shape (compact, render-ready, not a generic JSON-patch):

```jsonc
{
  "document": { "scope_of_works": { "from": "…", "to": "…" } },
  "tiers": {
    "better": {
      "subtotal_ex_gst": { "from": 110352, "to": 119352 },
      "lines": [ { "op": "add", "description": "Scaffold supply and setup.", "quantity": 1, "unit_price_ex_gst": 9000 } ]
    }
  }
}
```

Written **only** from `/api/quote/[id]/edit` (the single persist path), service-role, after the `quotes` update succeeds. Insert failure is logged, never blocks the save (audit is best-effort in v1; flip to transactional if it ever matters legally). **Scope disclosure:** the history drawer shows *tradie content edits* only — system-driven mutations (draft creation, approve/release, booking, webhook stamps) are intentionally outside this audit; the drawer copy must say so ("Edits by you").

**PII note:** `changes`/`instruction` can contain customer-adjacent free text. Retained indefinitely for now; when a data-retention policy lands, this table is in scope for redaction, and the Phase-2 tenant-scoped RLS policy must be written for it at the same time reads move off pure service-role.

**Explicitly rejected: a per-user "full code" content table.** Reasons: (a) wrong tenancy axis — quotes belong to *tenants* (`tenant_id`), not users; (b) a second copy of the document diverges from the row that SMS templates, Stripe re-issue, the grounding validator, and all four PDF generators read; (c) a `/:userId` keyed endpoint invites IDOR — identity must come from the Bearer token, never the path.

## 4. API specification

Extend the two existing endpoints; add two small read/preview endpoints. **No new `/api/fullcode/*` family** — the quote is the resource and it already has routes.

**Fetch leg (the "GET" in the original recommendation):** no new read endpoint is needed. The dashboard page server component already loads the full quote row (service-role, by share token) and hands it to the editor as initial props; `/api/quote/[id]/check-owner` gates the edit affordances. Note `app/api/quote/[id]/route.ts` now exports a tradie-only `DELETE` (owner-gated, paid-quotes 409, expires live Stripe sessions) — a future GET would co-locate there, but this design does not require one.

**"Owner-gated" is defined once, here, and means the full `/edit` chain** — Bearer → `supabase.auth.getUser` → load quote by `[id]` → read `quote.tenant_id` → load tenant → require `tenant.owner_user_id === userId`; 403 otherwise (route.ts:189-196). A valid Bearer token alone is NOT authorization: without the quote→tenant→owner check, `/preview` and `/revisions` would be IDOR (any authenticated tradie reading another tenant's held draft prices or edit history). Route tests must cover non-owner-403 and cross-tenant-`[id]`-403.

### 4.1 `POST /api/quote/[id]/chat-edit` (extended)

```jsonc
// request (new fields marked ★)
{
  "instruction": "make the scope mention the second structure",
  "currentTiers": { "good": …, "better": …, "best": … },
  "currentDocument": {                        // ★ working-draft document fields
    "report_title": "Re-roof — 12 Smith St",
    "scope_of_works": "…", "assumptions": ["…"],
    "estimated_timeframe": "2-3 days", "selected_tier": "better"
  },
  "history": [                                // ★ last ≤12 turns, text only
    { "role": "user", "text": "add a line item for edge protection" },
    { "role": "assistant", "text": "Happy to — which tier(s), and what price?" }
  ]
}
// response (new fields ★)
{
  "ok": true,
  "assistantMessage": "Added a $9,000 scaffold line to all three tiers.",
  "proposedTiers": { … },                     // unchanged
  "proposedDocument": { "scope_of_works": "…" },  // ★ only fields the AI changed
  "diff": [ … ],                              // unchanged line-item diff
  "documentDiff": [                            // ★
    { "field": "scope_of_works", "from": "…", "to": "…" }
  ],
  "anyUngrounded": false
}
```

Server-side changes in `lib/quote/chat-edit.ts`:
- `proposeQuoteEdit` accepts `history` and maps it into the `messages` array (system, …history, current user turn). Cap: 12 turns / ~6k chars, oldest dropped first; history is **text-only** (proposals stripped client-side) so token cost stays bounded and no stale tier JSON contradicts `currentTiers`.
- Output schema gains an optional `"document"` object beside `"tiers"`; `parseProposal` extends accordingly. Document fields are length-clamped (Zod, mirroring `/edit`'s limits).
- **Framing threading:** the route passes `currentDocument.scope_of_works`/`assumptions` (the working draft) into `proposeQuoteEdit`'s grounding pre-check instead of the DB row values — otherwise the `grounded` flags are computed against stale framing and the "pre-check mirrors save gate" invariant breaks (§4.2.3).
- System prompt additions: the document-field vocabulary; "when the tradie's message answers your previous clarifying question, act on the combined intent"; **out-of-schema requests** ("lump sum", hide breakdowns, display format): say plainly it can't be done here, name where it can (tenant tier-mode / display settings), and still propose the representable part (e.g. the $9,000 price change) as a normal proposal; keep the existing money rules verbatim.
- Clarifying questions must **quote their best guess** ("Did you mean: add a $9,000 scaffold line to all three tiers?") so the client can render a one-tap **Yes chip** (§5.3).

Auth, guards (paid / inspection / owner / pricing-book), and propose-only semantics are unchanged. The route stays **read-only** (its route test's write-tripwire keeps enforcing that).

### 4.2 `POST /api/quote/[id]/edit` (extended)

Body gains an optional `document` object (fields optional, Zod-clamped: title ≤120, scope ≤4000, each assumption ≤300, ≤20 assumptions, timeframe ≤60, `selected_tier ∈ {good,better,best}` and must reference a non-null tier).

**4.2.1 Guard relaxation.** The `no_changes` 400 becomes: reject only when there are **no tier edits AND no document fields**. Route test: a document-only body persists and returns 200 (today it would 400 — route.ts:138-140).

**4.2.2 `selected_tier` is a pricing field, not prose.** The headline pick currently reads `quote.selected_tier` from the *loaded row* (route.ts:462-465); with an incoming `document.selected_tier` the route MUST use the incoming value for the headline pick and recompute/persist `total_inc_gst` even when no line items changed. Because it changes the customer-visible headline price (and under `single` tier mode, *the* price), a `selected_tier` change: counts as a changed-price save (status bump rule, notify-default ON, confirm modal shown). It does NOT re-issue Stripe sessions (per-tier session amounts derive from tier subtotals, which didn't move). **Label rule (closes a §5.1 contradiction):** the Save button reads "Save · Re-issue links" ONLY when a tier *subtotal* changed — i.e. when a re-issue actually happens. A `selected_tier`-only save shows "Save changes", and its confirm-modal copy says "This changes the headline price — existing payment links are unchanged."

**4.2.3 Framing-aware grounding.** `scope_of_works`/`assumptions` feed `detectCrossTierDuplicates`' framing check (the R8 machinery), so:
- `fullDraft` uses the **incoming** `document.scope_of_works`/`assumptions` when provided (falling back to the row) — otherwise a combined scope+tier save validates against the OLD scope and spuriously 422s.
- The cross-tier gate runs on **any save that changes framing text, including document-only saves** — a scope edit can un-suppress or newly-suppress a duplicate flag, so skipping grounding "because no subtotal changed" is unsound.
- **Framing-override audit:** run `detectCrossTierDuplicates` twice — against the OLD framing and the NEW framing. If a duplicate flagged under the old framing is suppressed under the new framing, the save proceeds (framing quantity differences legitimately) but stamps `tradie_framing_override:<anchor>` into `risk_flags`. This closes the two-save attack (save framing text first, then add the differing-quantity duplicate clean) without blocking legitimate framing — the money-safety audit records it either way.

**4.2.4 Persistence + audit.** Document fields persist in the same `quotes` update as tiers (single write; the existing `pdf_path`/`pdf_signature` nulling covers them automatically). Prose-only edits (title/scope/assumptions/timeframe) do not bump `status` (mirrors M-3) and skip the confirm modal client-side (§5.1). Every successful save writes the `quote_revisions` row (source `manual` or `ai_chat` + accumulated instructions).

### 4.3 `POST /api/quote/[id]/preview` (new)

Owner-gated (§4 definition — **not** share-token-gated: a held quote's draft prices must never render for anyone but the owner). Body = the full working draft (tiers + document). Returns `{ html }`: the exact output of `buildQuoteReportHtml` composed with the tenant's real branding — i.e. **the same builder the PDF uses**, minus Gotenberg. No persistence, no storage writes.

- **Tier-mode resolution copies `ensureQuotePdf`, not `/edit`:** the pricing_book lookup must be trade-scoped (`.eq('tenant_id', …).eq('trade', intakeTrade)`, lib/quote/pdf.ts:224-231). `/edit`'s `.limit(1)` no-trade-filter pattern gives a cross-trade tenant (one exists in prod) a nondeterministic tier mode — the exact preview/PDF drift this endpoint exists to prevent.
- Client behaviour (normative, cheap-hardware reality): debounce ~500ms; **out-of-order guard** (monotonic sequence number / AbortController — only the latest response renders); **scroll preservation** across `srcdoc` swaps (capture/restore via the same-origin access §5.1 grants); on mobile, fetch **lazily on Preview-tab activation**, not continuously while the tab is hidden.
- Gotenberg is *never* in the interactive loop; the PDF renders on save/download as today.

### 4.4 `GET /api/quote/[id]/revisions` (new)

Owner-gated (§4 definition). Returns the last 50 `quote_revisions` newest-first — **no pagination in v1** (quotes accumulate a handful of edits, not hundreds). Read-only in v1 (no restore — see Open issues).

## 5. UI/UX design

Maintain design system throughout: ink-navy panels (`#0f1722`/`#16202b`), `#FF5F00` accent, mono uppercase micro-labels.

### 5.0 Surface decision (review blocker — resolved)

The tradie-review SMS link currently lands on **`/q/[token]?edit=1`** (customer page + modal), not the dashboard viewer this design extends. **Decision: when Phase 2 ships, repoint the SMS `editUrl` (`buildTradieReviewNotification`) to `/dashboard/quote/[token]?edit=1`** so the phone-first persona lands on the surface with the live preview. Auth cost is unchanged — the modal already requires a session via `/check-owner` and shows a sign-in CTA. The `/q/[token]` modal remains functional (Phase 1 document fields work there too) but stops being the promoted entry point. Two more surfaces reference the old entry and must move in the same change: the approve page's edit link (`app/q/[token]/approve/page.tsx:133`) and the documented flow in `specs/tradie-manual-line-items.md`.

### 5.1 Layout (desktop ≥1024px)

```
┌──────────────────────────────────────────────────────────────────┐
│ EDIT QUOTE · <title>       [Unsaved changes ●] [History] [Save]  │
├───────────────────────────┬──────────────────────────────────────┤
│ LEFT RAIL (420px, sticky) │ LIVE PREVIEW (fills)                 │
│ ┌───────────────────────┐ │ ┌──────────────────────────────────┐ │
│ │ ● Edit with AI (chat) │ │ │ rendered report HTML (srcdoc     │ │
│ │   thread + input      │ │ │ iframe) — updates ~500ms after   │ │
│ └───────────────────────┘ │ │ each draft change; changed       │ │
│ ┌───────────────────────┐ │ │ sections carry a persistent      │ │
│ │ ▸ Document            │ │ │ accent tint until save           │ │
│ │   title · scope ·     │ │ │                                  │ │
│ │   assumptions ·       │ │ │ toggle: [Preview] [PDF*]         │ │
│ │   timeframe · rec tier│ │ │ *disabled while draft is dirty:  │ │
│ │ ▸ Good / Better / Best│ │ │  "PDF updates after save"        │ │
│ │   (existing editor)   │ │ └──────────────────────────────────┘ │
│ └───────────────────────┘ │                                      │
└───────────────────────────┴──────────────────────────────────────┘
```

- **One shared working draft** (client state) feeds the chat's `currentTiers`/`currentDocument`, the manual fields, and the preview. Chat "Apply to editor" and manual typing mutate the *same* draft — there is **no AI/manual mode toggle**; both are always live. (A modal toggle was considered and rejected: it forces context switches and implies the surfaces edit different things.)
- **Chat thread survives the surface.** Messages state is lifted to the viewer level (not inside the modal's `{open && …}` mount) and the text-only history mirrors to `sessionStorage` keyed by `quoteId` — so closing the panel or saving (router.refresh) does NOT wipe the conversation the memory feature depends on. (Survival across a mobile tab discard is best-effort — sessionStorage restore after eviction is browser-dependent.)
- **Preview ≠ Word.** The preview is not contentEditable. Free-form document typing is how ungrounded prices sneak into a legally binding document; the structured fields are the contract. ~~Click-a-section-to-focus-field~~ — **cut from v1** (review: undiscoverable without affordances, impossible on mobile tabs, and it drags sandbox complications in; the *highlight* is what closes the "did my change land" loop, not the click). May return later as a desktop-only progressive enhancement with an explicit hover affordance.
- **Iframe sandbox (explicit):** `sandbox="allow-same-origin"` — **without** `allow-scripts`. Same-origin access is needed by the parent for scroll capture/restore (§4.3); script execution stays blocked (the dangerous sandbox escape requires both flags together, and the srcdoc HTML is our own template with escaped tenant strings — §7). Highlights are injected by the client into the HTML string (a small `<style>` block keyed on `data-section` attrs) *before* assigning `srcdoc` — no in-iframe scripting needed.
- **Change highlighting**: `report-html.ts`/`report-chrome.ts` gain stable `data-section` attributes (`doc-title | doc-scope | doc-assumptions | doc-timeframe | doc-rectier | tier-good | tier-better | tier-best` — `doc-timeframe` and `doc-rectier` (the recommended-tier badge/headline block) included so **every** §4.2-editable field has a highlight anchor) — markup-only, bump `REPORT_TEMPLATE_VERSION`. Changed sections keep a **persistent subtle tint until save resets the baseline** (review: a fading pulse is missed by a phone user looking at the keyboard).
- **Save flow, tiered by what changed:**
  - *Prose-only* (title/scope/assumptions/timeframe): **no confirm modal** — save quietly immediately, toast with an optional "Notify customer" action.
  - *Money moved* (line items or `selected_tier`): existing confirm modal (notify / save quietly), 422-grounding → force path, Stripe re-issue for changed tiers.
  - *Mixed*: modal appears with a third copy branch — "Document text changed — prices are unchanged" vs the price-change copy.
  - The primary button label is **dynamic**: "Save changes" when no money moved; "Save · Re-issue links" only when it did (today's static label promises re-issue on a scope typo fix).
- **History drawer** (right overlay, desktop): revision list — timestamp, actor, source chip (AI/manual), instruction snippet, per-field change summary rendered from `changes`. Read-only v1. Header: "Edits by you" (system mutations are out of scope — §3.2).

### 5.2 Mobile (<1024px)

Segmented tabs: **Chat · Edit · Preview** (History moves behind a kebab/overflow — read-only audit has near-zero mid-job utility). **The sticky Save bar + dirty indicator renders on ALL tabs, including Chat** — the save affordance must never be a tab away. The chat keeps `defaultOpen` behaviour when arriving via `?edit=1`.

### 5.3 Chat UX corrections (directly from the observed transcripts)

- History is sent → clarifying flows resolve ("yes please" now lands on the pending question).
- **Best-guess clarifying questions + one-tap Yes chip** (Phase 1, explicitly): when intent is ambiguous even with history, the model's question quotes its best guess ("Did you mean: add a $9,000 scaffold line to all three tiers?") and the client renders a **"Yes" quick-reply chip**. This converts the observed failure loop into a two-tap recovery.
- **Compress the chat→customer chain**: the applied-proposal card gains an inline **"Save now"** button that jumps straight to the save step (quiet-save outright for prose-only proposals) — today's chain (type → wait → Apply → find Save → modal) is four interactions after the sentence.
- Applied-state copy is honest and tab-aware: desktop "✓ Applied — highlighted in the preview. Not sent yet."; mobile "✓ Applied — not sent yet. Save to update the customer's quote." (never point at a tab the user isn't on).
- Empty-state suggestions gain document examples ("Tighten the scope of works", "Rename the quote title").

## 6. Logging & auditing

- Every successful save = one `quote_revisions` row (schema §3.2). The AI path stamps `source:'ai_chat'` + the concatenated instructions of the applied proposals in this draft session; pure manual saves stamp `source:'manual'`.
- Existing `risk_flags` (`tradie_manual_line`, `tradie_edit_ungrounded`, **new: `tradie_framing_override`** §4.2.3) stay — they're the *money-safety* audit; revisions are the *content* audit. No merge.
- Retention: keep indefinitely for now (rows are small); this table is explicitly in scope for any future PII-retention/redaction policy (§3.2).
- Out of scope v1: restore/rollback (see Open issues — restoring an old price without re-issuing Stripe sessions would resurrect stale checkout amounts).

## 7. Security & permissions

- **Identity from Bearer only**; every new/extended endpoint performs the full quote→tenant→owner chain defined in §4. No user-id or tenant-id in request bodies/paths for authz. Route tests: non-owner 403, cross-tenant-`[id]` 403.
- **`esc()` is the primary injection control — the authoritative sink is Gotenberg's Chromium, not the preview iframe.** The same `buildQuoteReportHtml` output goes to `/forms/chromium/convert/html` (lib/pdf/gotenberg.ts), where Chromium executes JS with no sandbox and outbound network access; an unescaped `report_title` like `<img src=x onerror="fetch('http://169.254.169.254/…')">` would execute **server-side in the PDF render worker** (SSRF) and land in the customer's PDF. Therefore: **every new document field (`report_title`, scope, each assumption, timeframe) MUST route through `esc()`** exactly like the existing `esc(job)`/`esc(scopeOfWorks)` paths. Unit test: `<script>`/`onerror` payloads in title + scope render escaped. The preview iframe's `sandbox="allow-same-origin"` (no scripts) is defence-in-depth, not the mitigation.
- **Preview endpoint is owner-gated**, never share-token-gated: it renders draft (possibly held/unreleased) prices.
- Existing guards carry over verbatim: paid → 409 immutable; inspection → 409; grounding 422→force for catalogue trades; tradie-authored trades (roofing/solar/painting) skip catalogue grounding but keep diff-review + Save (registry unchanged). Framing edits get the §4.2.3 dual-run + risk-flag treatment.
- **Prompt-injection posture (history threading):** a forged/poisoned conversation history still cannot make a fabricated price ground — the grounding re-check runs on both propose and Save, and `reconcileLineSource` keeps rewriting `tradie_manual`→`tradie_edit` so the model can't mint grounding-exempt lines. History is text-only and length-capped.
- `quote_revisions` under RLS with no anon policy; `tenant_id NOT NULL` so Phase-2 tenant-scoped policies cover every row; service-role writes only.
- Rate-limit note: chat-edit is an Opus call per message; the route already sits behind auth — add a soft per-quote cap (e.g. 30 proposals/hour) only if abuse appears.

## 8. Evaluation of the original recommendations

| # | Recommendation | Verdict | Disposition |
|---|---|---|---|
| 1 | Live preview pane beside the chatbot | **Accept, amended** | Yes — but render the *report HTML* via `/preview` (same builder as the PDF), debounced with an out-of-order guard; never per-keystroke Gotenberg PDFs. Fidelity by construction, zero render-farm cost. |
| 2 | Toggle AI vs manual (Word-style editor) | **Amend** | No mode toggle: both surfaces stay live over one shared draft. Word-style contentEditable **rejected** — the document is a projection of structured data (settled invariant); free-typed content can't pass the grounding gate and would fork the source of truth. |
| 3 | Persist full code in a user-specific table | **Reject → redirect** | The content already lives on the `quotes` row that SMS/Stripe/PDF all read. A per-user copy is the wrong tenancy axis and a divergence machine. Only additions: `quotes.report_title` column + `quote_revisions` audit table. |
| 4 | Log all changes with review history | **Accept, concretized** | `quote_revisions` append-only table (§3.2) written from the single persist path; history drawer UI. |
| 5 | Architect-defined endpoints for fetch/update/save | **Accept, remapped** | The quote *is* the resource: extend `/chat-edit` + `/edit`, add `/preview` + `/revisions`. No `/api/fullcode/:userId` family (IDOR-shaped; duplicates existing routes). |
| + | *(unrequested but required)* Conversation memory | **Add** | The screenshots' failure loop is the stateless chat. `history` threading is the single highest-value change in this design. |
| + | *(unrequested but required)* Document-level fields | **Add** | "Change the title" is impossible today; §3.1/§4 make title/scope/assumptions/timeframe first-class (and correctly classify `selected_tier` as pricing). |

## 9. Delivery phases (each gated on `pnpm typecheck` + `vitest run`; route tests mirror existing patterns)

1. **Phase 1 — chat memory + document fields + audit (backend-weighted, no layout change).**
   `history` threading + `currentDocument`/`proposedDocument` in chat-edit (incl. framing threading §4.1); **best-guess clarifying questions + Yes quick-reply chip**; `document` in `/edit` (guard relaxation §4.2.1, `selected_tier` headline recompute §4.2.2, framing-aware grounding + `tradie_framing_override` flag §4.2.3); `report_title` migration + template heading slot (+`esc()` + version bump); `quote_revisions` migration + write; chat thread lifted to surface level + sessionStorage; TradieEditor grows a "Document" section; tiered save flow (prose-only = quiet save, dynamic button label). *This alone fixes both observed failures.* Revision *writes* start here, so the audit trail is complete retroactively even though the read UI lands in Phase 3 — if "review history before finalizing" is a launch requirement, pull `/revisions` + a minimal read-only list forward into this phase (cheap: one owner-gated select + a list component).
2. **Phase 2 — live preview.**
   `/preview` endpoint (trade-scoped tier-mode lookup); split-pane viewer; `data-section` markers; dirty-draft model; persistent section tints; Preview/PDF toggle (PDF disabled while dirty); mobile tabs (History behind kebab, Save bar on all tabs); scroll preservation + out-of-order guard + lazy mobile fetch; **repoint the tradie-review SMS `editUrl` to `/dashboard/quote/[token]?edit=1`** (§5.0).
3. **Phase 3 — history surface + polish.**
   `/revisions` endpoint + drawer; per-line highlights; restore-to-revision (only with Stripe re-issue semantics resolved — restore = "apply an old draft through the full `/edit` pipeline", never a raw row overwrite).

Test plan highlights: chat-edit history threading (pure `buildMessages` unit test); document-field Zod clamps; `/edit` document-only save returns 200 + persists + writes revision + still nulls `pdf_path`; `selected_tier` save recomputes `total_inc_gst`; R8-style framing test (draft-edited scope validates against the INCOMING framing); dual-run framing-override flag test; preview auth (owner 200 / non-owner 403 / cross-tenant 403 / share-token 401); `esc()` XSS test on title+scope; template `data-section` presence; revisions capped at 50.

## 10. Open issues / assumptions

1. **Naming confirmation** (§0): "full code" = full quote document. Confirm.
2. **Title semantics**: `report_title` replaces the static "Quotation" heading only; the intro sentence and SMS templates keep deriving from `job_type`.
3. **Trade scope**: Phases 1-2 target the quotes-row template (`report-html.ts` + `report-chrome.ts`) — every trade the dashboard editor already serves. The dedicated roofing/solar/painting PDF builders (separate templates + tokens) adopt document fields only when their adapters do. Note: those flows' PDF caches still need the invalidate-on-edit fix (separately flagged task).
4. **Concurrency**: two tabs editing the same quote is last-write-wins today; acceptable for a single-owner tool. If it bites, add an `updated_at` optimistic-lock check to `/edit` (409 `stale_draft`).
5. **Restore semantics** (Phase 3): restoring a revision that changes tier subtotals MUST run the full `/edit` pipeline (grounding + Stripe re-issue + PDF invalidation).
6. **Costs**: history threading raises chat-edit input tokens (bounded ≤12 turns); preview endpoint is LLM-free. The Opus-per-message pattern is unchanged.

## 11. Review log

2026-07-02 — three-lens adversarial review (architecture/codebase-fit, security/money-safety, UX/product) run against source before finalization. All findings folded in:
- **Blocker**: entry-surface mismatch (SMS link → customer-page modal, not the dashboard viewer) → §5.0 decision.
- **Majors**: no existing title render slot (§2/§3.1); `no_changes` guard rejects document-only saves (§4.2.1); `selected_tier` moves the headline price (§4.2.2); scope/assumptions are grounding inputs — framing-edit attack closed with dual-run + risk flag (§4.2.3); XSS threat model re-aimed at the Gotenberg Chromium sink, `esc()` primary (§7); chat thread died with the modal (§5.1); click-to-focus vs sandbox contradiction (resolved: cut click-to-focus, `allow-same-origin` only); chain-compression + save-flow tiering for terse mobile users (§5.1/§5.3).
- **Minors**: trade-scoped tier-mode lookup for `/preview`; `quote_revisions.tenant_id NOT NULL` + drop `'system'`; owner-gating spelled out (IDOR); no pagination on revisions; History behind kebab on mobile; PDF toggle disabled while dirty; persistent tint over fading pulse; out-of-schema ("lump sum") prompt rule; Yes-chip explicitly phased into Phase 1.

2026-07-02 (later) — source-verification pass: 6 parallel claim-checkers re-verified every §2 code claim against the working tree (post-mig-159) — **all confirmed, zero code drift**; a completeness critic checked coverage against the original brief — all sections and both screenshot failures covered. Fixes folded in from that pass:
- Migration number pinned (160+; 159 is the current highest) — §3.1.
- §4.2.2/§5.1 label contradiction closed: "Save · Re-issue links" only when a tier subtotal changed; `selected_tier`-only saves say "Save changes" with links-unchanged copy.
- `data-section` anchors added for `doc-timeframe` + `doc-rectier` so every editable field can highlight — §5.1.
- Fetch leg of the original GET/PATCH/POST recommendation made explicit (dashboard server component + `/check-owner`; no new GET) — §4. Noted the new tradie-only `DELETE` at `app/api/quote/[id]/route.ts` as the co-location point if a GET ever lands.
- "M-3" defined in place (§4.2.4: only price changes bump `draft`→`sent`).
- sessionStorage mobile-eviction claim softened to best-effort — §5.1.
- §5.0 repoint now lists the other two `?edit=1` surfaces (approve page link, `specs/tradie-manual-line-items.md`).
- Phase-1 option to pull the history read forward if "review before finalizing" is a launch requirement — §9.
- New current-state fact: TradieEditor's `timeframe` is POSTed but has no visible input today — §2.
