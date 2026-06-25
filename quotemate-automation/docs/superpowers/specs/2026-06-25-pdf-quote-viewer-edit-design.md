# PDF Quote Viewer + Edit (manual & AI) — Design

> Date: 2026-06-25 · Status: approved design, pre-plan
> Builds on: [`specs/ai-chat-edit-quote.md`](../../../specs/ai-chat-edit-quote.md) (the electrical/plumbing AI chat-edit primitive, already implemented).

## Objective

Give a tradie a single place to **view a quote as its PDF report and edit it** — manually or by chatting with AI — reachable per-job from the dashboard, for **every trade**. From any job/quote in the dashboard the tradie clicks **View PDF**, lands on a report viewer with a toolbar (modelled on the supplied "Refine with AI" reference), and can **Edit**, **Download PDF**, or **Edit with AI**. The change regenerates the PDF and the customer-facing quote in place.

The design's job is to make this **uniform across trades without coupling the shell to any trade**: a shared viewer shell + a thin per-trade adapter. Every trade gets *View + Download* immediately; *Edit* and *Edit with AI* light up per trade as each adapter is built — electrical + plumbing first.

## Context / background (the per-trade reality)

The codebase has **no single quote shape**, which is why this must be a shell+adapter, not one monolith:

- **PDF generation is per-trade**: `ensureQuotePdf` (electrical/plumbing), `ensureRoofQuotePdf`, `ensureSolarQuotePdf`, `ensurePaintingPdf` (`lib/quote/pdf.ts`), each rendering trade-specific HTML (`lib/{quote,roofing,solar,painting,…}/report-html.ts`) via Gotenberg.
- **PDF routes are per-trade**: `/api/q/[token]/pdf`, `/api/q/roof/[token]/pdf`, `/api/q/solar/[token]/pdf`, `/api/q/paint/[token]/pdf`, `/api/q/plan/[token]/pdf`.
- **Editing is per-trade**: only electrical/plumbing have a structured line-item editor (`app/q/[token]/TradieEditor.tsx` → `/api/quote/[id]/edit`) and the new AI chat-edit (`QuoteEditChat` → `/api/quote/[id]/chat-edit`). Roofing is measurement-driven (`/api/roofing/{measure,save-as-quote}`); solar is input-driven (`/api/solar/{redraft,confirm}`). There is no line-item "quote" to edit for those trades.
- **Dashboard today**: each quote card links to `/q/[token]` (view) and `/api/q/[token]/pdf` (download). No editing on the dashboard.

So "edit the PDF for all trades" = **one shell + N adapters**, where the hard, trade-specific work is "what is editable for this trade, and how does an AI propose a grounded change to it."

## Architecture: shared shell + per-trade adapter

### The shell — `QuoteReportViewer`
A trade-agnostic viewer that renders:
1. a **toolbar**: `Edit` · `Download PDF` · `Edit with AI` (actions enabled/disabled from the adapter's `capabilities`);
2. the **report body**: the trade's report HTML when the adapter provides it, otherwise an embedded PDF (`<iframe src={pdfPath}>`) as a faithful "view" fallback;
3. an **edit surface** (panel/modal) and an **AI chat surface**, both supplied by the adapter, that mutate structured data and trigger a PDF + report refresh.

The shell never imports a trade module directly — it only talks to the adapter.

### The adapter — `QuoteReportAdapter`
One per trade, resolved from a registry by the quote's `trade`:

```ts
// lib/quote/report-adapters/types.ts
export interface QuoteReportAdapter {
  trade: string
  /** Report HTML shown in the viewer (same source the PDF is rendered from).
   *  Omit to fall back to embedding the PDF via pdfPath. */
  renderReportHtml?: (quote: QuoteViewerData) => Promise<string>
  /** This trade's PDF download/stream route. */
  pdfPath: (shareToken: string) => string
  /** Toolbar capability gates. */
  capabilities: { manualEdit: boolean; aiEdit: boolean }
  /** Identifiers the shell passes to the (client) edit + AI surfaces. */
  editorKind?: 'line-items' /* electrical/plumbing */ | null
}
// getReportAdapter(trade: string): QuoteReportAdapter  — registry with a safe default
```

`QuoteViewerData` carries `quoteId`, `shareToken`, `trade`, `gstRegistered`, and (for line-item trades) the `good/better/best` tiers.

### Why this satisfies "all trades"
- **Day one**: every trade resolves to *some* adapter. Trades without an editor get `capabilities { manualEdit:false, aiEdit:false }` and a PDF-embed view → **View + Download works for roofing/solar/paint/aircon/signage immediately**.
- **Adding a trade later** = write one adapter file + (the real work) that trade's editable model + AI-propose endpoint. **Zero changes to the shell, the dashboard button, or the toolbar.**

## Phase A scope (electrical + plumbing)

1. **Dashboard entry** — add a **"View PDF"** action to each job/quote card in the dashboard quotes list, linking to the viewer route.
2. **Viewer route** — `app/dashboard/quote/[token]/page.tsx`: resolves the quote + trade + adapter, renders the toolbar + report body, owner-gated.
3. **Report body** — electrical/plumbing adapter's `renderReportHtml` wraps `lib/quote/report-html.ts` (the exact HTML the PDF is made from), shown in the viewer.
4. **Edit (manual)** — reuse `TradieEditor`'s line-item editor, opened from the toolbar `Edit` button.
5. **Edit with AI** — reuse `QuoteEditChat` → `/api/quote/[id]/chat-edit`, opened from the toolbar `Edit with AI` button.
6. **Download PDF** — toolbar links to `/api/q/[token]/pdf`.
7. **Refresh on save** — after a save (`/api/quote/[id]/edit`, which already regenerates the PDF), the viewer re-renders the report and the PDF link is cache-busted.
8. **Adapter scaffolding** — `lib/quote/report-adapters/` with the interface, registry, the electrical/plumbing adapter, and **stub adapters** for roofing/solar/painting/aircon/signage (PDF-embed view, edit disabled).

### Reused as-is (no rebuild)
`TradieEditor`, `QuoteEditChat`, `/api/quote/[id]/chat-edit`, `/api/quote/[id]/edit`, `ensureQuotePdf`, `/api/q/[token]/pdf`, the grounding validator. The toolbar is wired to trigger the existing editor/chat (a small refactor of `TradieEditor` to expose open-edit / open-chat triggers instead of only its floating banner).

## Per-trade extension recipe (post-Phase-A)

For each new trade (roofing, solar, painting, …):
1. Add a `report-adapters/<trade>.ts` implementing `QuoteReportAdapter` (`renderReportHtml` from its `report-html.ts`, `pdfPath` to its route).
2. Decide **what's editable** for that trade and build its manual editor + an AI-propose endpoint mirroring `/api/quote/[id]/chat-edit` (with that trade's grounding rules — e.g. roofing measurement bounds).
3. Flip the adapter's `capabilities`. Register it. Done — the shell and dashboard are untouched.

## Data flow

`Dashboard "View PDF"` → `/dashboard/quote/[token]` → resolve adapter → render report + toolbar.
`Edit`/`Edit with AI` → existing line-item editor / chat → `/api/quote/[id]/{edit,chat-edit}` → grounding + Stripe re-issue + `ensureQuotePdf` → viewer refresh.
`Download PDF` → `/api/q/[token]/pdf` (Gotenberg, lazy-render).

## Error handling / edge cases

- **Non-owner / not signed in** → viewer shows the report read-only (or redirects to sign-in); Edit/AI hidden. Owner check reuses `/api/quote/[id]/check-owner`.
- **Trade with no adapter editor** → toolbar shows Edit/Edit-with-AI disabled with a "not yet available for <trade>" tooltip; View + Download still work.
- **Inspection / paid quote** → Edit/AI disabled (same 409 guards the endpoints already enforce), surfaced as a disabled-with-reason state.
- **PDF not yet generated** → embed/download lazily renders via the existing routes; show a "preparing…" state.
- **Ungrounded AI edit** → unchanged from the chat-edit primitive (flagged in the diff; 422-then-force on save).

## Testing

- **Unit**: adapter registry resolves the right adapter per trade and a safe default for unknown trades; capability gating; pdfPath per trade.
- **Component/integration**: viewer renders toolbar with correct enabled/disabled actions per `capabilities`; Edit/Edit-with-AI mount the existing surfaces for electrical/plumbing; a stubbed trade shows view+download only.
- **Reuse**: the existing `chat-edit` and `edit-grounding` test suites continue to pass (no changes to those endpoints).

## Non-goals (this phase)

- No editor or AI-propose for roofing/solar/painting/aircon/signage yet (stubs only — view+download).
- No "Share Report"/"Build Protocol" toolbar actions (dropped from the reference image as out of scope).
- No change to the customer-facing `/q/[token]` experience or to the per-trade PDF generators.
- No editing of the PDF *file* directly — editing is always of the underlying structured data; the PDF re-renders.

## Definition of done (Phase A)

- [ ] Every dashboard job/quote card has a **View PDF** action opening `/dashboard/quote/[token]`.
- [ ] The viewer renders the report + a toolbar (`Edit` · `Download PDF` · `Edit with AI`) with actions gated by the resolved adapter's `capabilities`.
- [ ] Electrical/plumbing: `Edit` opens the line-item editor; `Edit with AI` opens the chat; both save via the existing endpoints, regenerate the PDF, and refresh the viewer.
- [ ] Roofing/solar/painting/aircon/signage resolve to a stub adapter: **View + Download work; Edit/Edit-with-AI are disabled** with a clear reason.
- [ ] Owner-gating: non-owners never see Edit/AI; customer `/q/[token]` is unchanged.
- [ ] Adding a future trade requires only a new adapter file (+ its editor/AI endpoint) — no shell/dashboard/toolbar changes (verified by the adapter interface + registry).
- [ ] Unit + component tests pass; existing chat-edit/grounding suites still green.

## Open questions

- **Owner-gating mechanism for the dashboard viewer route**: reuse the client-side `/check-owner` (as `/q/[token]` does) vs. a server-side session check. Resolve in the plan; default = reuse `/check-owner` for consistency.
- **Toolbar trigger refactor of `TradieEditor`**: expose explicit open-edit / open-chat handlers vs. wrap it. Resolve in the plan; default = expose handlers, keep the floating banner for `/q/[token]`.
