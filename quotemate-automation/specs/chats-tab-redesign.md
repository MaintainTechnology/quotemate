# Chats tab — Command Centre two-pane redesign

## Goal

Replace the Chats tab's card-accordion list with the reference **two-pane conversations
layout** (conversation rail + live thread + SMS composer) so it is visually faithful to the
`data-screen-label="Chats"` screen in
`C:/Users/dalig/Downloads/QuoteMate/quoteMate/redesign/QuoteMax Dashboard (standalone).html`,
with **zero regression** to chat/SMS capture, the `/api/tenant/chats` data contract, and the
Overview "chats went cold" deep-link.

Measurable outcome: side-by-side screenshot of the rebuilt tab vs the reference Chats screen
shows the same layout anatomy (rail widths, row anatomy, bubble treatment, composer) at 1440,
and all existing chat information (names, channels, statuses, job types, transcripts, counts)
remains visible and live.

## Role

Principal product designer + design engineer. Ship the UI in the repo, not mockups.

## Context

- Surface: `/dashboard` → Chats tab. Component `ChatsTab` in
  [app/dashboard/page.tsx:14383](app/dashboard/page.tsx) (plus `ChatsList`,
  `ChatFilterButton`, `ChatCard`, and the shared `Transcript` at page.tsx:9545).
- Data: `GET /api/tenant/chats` ([app/api/tenant/chats/route.ts](app/api/tenant/chats/route.ts))
  returns ≤30 merged SMS + voice rows (`ChatRow` at page.tsx:457), each with full
  `messages[]` (`{direction: 'inbound'|'outbound', body, created_at}`), sorted by
  `last_message_at` desc. **This endpoint's response shape must not change** (Overview's
  "Recent chats" widget consumes the same rows).
- The raw brief mentions "the uploaded image" — no image exists in this session; the
  standalone HTML export is the authoritative design source. Its Chats screen markup was
  extracted verbatim into **Appendix A** below and its computed data-bound styles into
  **Appendix B**. Treat the appendices as the target state.
- Assumed job shape: **POLISH (redesign) of an existing surface**. Assumed breakpoints:
  375 / 768 / 1024 / 1440. Assumed direction: exact adoption of the reference layout using
  the app's existing Command Centre tokens.

## Design Decisions (routing record)

1. **Design system:** QuoteMax "Command Centre" — canon confirmed. The app's
   `app/globals.css` already defines the identical token set (`--ink-deep #16120F`,
   `--ink #1E1813`, `--ink-card #2B2422`, `--ink-line #3A322C`, `--accent #FFC400`,
   `--accent-ink #1C1812`, `--text-pri/sec/dim`, `--success-bright #34D27B`, Manrope +
   JetBrains Mono) and exposes them as Tailwind utilities (`bg-ink-deep`, `border-ink-line`,
   `text-text-dim`, …). Author every value against these tokens — no new hex values, no
   second accent, square corners, hairline borders, zero emoji, Australian English.
   `maintain-design-system` (navy/orange) is deprecated — never reference it.
2. **Build engine:** `/design-taste-frontend-v1` (existing surface, audit-first): audit the
   current `ChatsTab` against Appendix A, then rebuild to the reference.
3. **UX lens:** `/bencium-controlled-ux-designer` — an operational CRM surface for a paying
   tradie; must stay tightly on-brand; no experimental divergence from the reference.
4. **Generated imagery:** none — data-dense dashboard; imagery does not elevate it.

## Task

Rebuild the Chats tab as the reference two-pane layout, then wire the composer to a real
SMS reply path. Work only on: `ChatsTab` + its child components in `app/dashboard/page.tsx`,
the `{tab === 'chats'}` mount site (page.tsx:1063) and its immediate wrapper handling, and a
new `app/api/tenant/chats/[id]/reply/route.ts`. Touch nothing else.

### Layout requirements (from Appendix A — exact values)

- **R1 — Shell.** Two-pane grid `grid-template-columns: minmax(290px,390px) minmax(0,1fr)`
  filling the content viewport height (each pane scrolls independently; the page itself does
  not scroll while on this tab). No `Card` wrapper, no panel containers — panes sit directly
  on the `--ink-deep` canvas separated by 1px `--ink-line` hairlines. Suppress the generic
  `TabHeader` for the chats tab (same pattern as `calendar`), and escape the content
  wrapper's horizontal padding so the panes run full-bleed (scope the escape to this tab
  only — do not alter other tabs' padding).
- **R2 — Rail header.** Sticky (top:0, bg `--ink-deep`, bottom hairline, padding 15px 18px):
  left = `CONVERSATIONS · {n}` (JetBrains Mono 11px w600 uppercase tracking 0.16em,
  `--text-sec`); right slot = the **All / Went cold filter** (replaces the reference's static
  "All channels" label — same mono 10px uppercase 0.14em `--text-dim` idiom; the active
  option reads `--text-pri` or accent). This preserves the existing `filter`/`onFilterChange`
  contract and the Overview cold-chats CTA deep-link (page.tsx:994–997, reset effect at 578–583).
- **R3 — Conversation rows.** Full-width buttons per Appendix B `rowStyle`: display block,
  text-left, `border-left: 2px solid` accent when active else transparent, bottom hairline,
  bg `--ink` when active else transparent, padding 15px 16px, background-color transition
  ~.15s, hover per `.qm-row:hover` (`color-mix(in srgb, var(--ink) 55%, transparent)`).
  Row anatomy: 34×34 square avatar (initial, mono 700 13px; active = accent bg +
  `--accent-ink` text, inactive = `--ink` bg + hairline border + `--text-pri`); name (Manrope
  700 14px `--text-pri`) with right-aligned relative time (mono 9.5px `--text-dim`); meta
  line (mono 9px uppercase 0.1em `--text-dim`) carrying `{job type} · {suburb} · {SMS|VOICE}`
  plus `· TRADIE SIGNUP` when `conversation_type === 'tradie_registration'` and the trade
  when multi-trade; preview line (12.5px `--text-dim`, single-line ellipsis, margin-top 8px)
  showing the last message body. Every existing datum currently on `ChatCard` must survive
  somewhere visible (name/number, channel, suburb, job type, status, quote-drafted, signup,
  in/out counts may move into the thread header/meta but may not be dropped).
- **R4 — Selection.** Clicking a row selects it and renders its thread in the right pane.
  Desktop: first row auto-selected on load. The active row shows the accent left bar.
- **R5 — Thread header.** Sticky, padding 15px 20px, bottom hairline, bg `--ink-deep`:
  left = `{first_name || from_number} · {SMS INTAKE | VOICE INTAKE}` (mono 10.5px w600
  uppercase 0.16em `--text-dim`); right = actions cluster:
  - Quote chip: when `chat.intake_id` exists render the ghost button (hairline border, mono
    9.5px w700 uppercase 0.12em, padding 7px 12px, `--text-pri`) labelled `Open quote →`,
    wired to a new optional `onGoToQuotes` prop → parent passes `() => setTab('quotes')`
    (same pattern as `CalendarTab`'s `onGoToQuotes`, page.tsx:1055). (Deliberate deviation:
    the reference label is "Draft quote →", but no draft-from-chat API exists — an honest
    "Open quote →" beats a dead button. When no intake exists, omit the button.)
  - Status badge per the reference "Online" chip (padding 5px 10px, mono 9.5px w700
    uppercase 0.13em, bordered `color-mix(in srgb, var(--success-bright) 45%, transparent)`):
    status `open` → `LIVE` in `--success-bright` with the 6px pulsing dot
    (`qm-pulse-soft`-style keyframe, respect `prefers-reduced-motion`); `done` → `COMPLETED`
    success-bright, no pulse; `abandoned` → `WENT COLD` in `--warning-bright` with matching
    border mix; anything else → the raw status, `--text-dim` + hairline border.
    (Deliberate deviation: status `structuring` renders as `DRAFTING` in `--warning-bright`
    with the pulsing dot — preserving the old ChatCard's amber drafting signal — rather than
    falling to the raw-status fallback.)
- **R6 — Messages.** Thread body padding 26px 30px, `display:grid; gap:12px`, max-width
  880px. Bubbles per Appendix B: max-width 86%, padding 10px 13px, 13.5px/1.45,
  `whitespace-pre-wrap break-words`. **Inbound (customer) = left**, hairline `--ink-line`
  border, bg `--ink-deep`, text `--text-sec`. **Outbound = right**, border
  `color-mix(in srgb, var(--accent) 35%, transparent)`, bg
  `color-mix(in srgb, var(--accent) 10%, transparent)`, text `--text-pri`, with sender label
  (mono 9px w700 uppercase 0.16em `--accent`): `QUOTEMAX` for pipeline history, `YOU` for
  messages sent from the composer this session. (Note: this flips the current `Transcript`
  alignment — the reference wins. Keep each message's timestamp accessible via
  `title`/`aria-label` rather than visible text, matching the reference's clean bubbles.)
  Voice rows render their parsed transcript through the same bubble treatment.
- **R7 — Composer.** Sticky bottom (top hairline, padding 14px 24px, bg `--ink-deep`):
  input `height:42px`, bg `--ink`, hairline border, Manrope 13.5px, placeholder
  `Reply by SMS`; Send button 42px high, accent bg, `--accent-ink` text, Manrope 700 12px
  uppercase 0.06em. Enter submits. Shown **only** for SMS conversations with a
  `from_number`; voice threads show a quiet mono note (`VOICE CALL — NO SMS THREAD`) in its
  place. Disabled + busy state while a send is in flight; inline error (danger-bright text)
  on failure without losing the draft.
- **R8 — Reply API (new).** `POST /api/tenant/chats/[id]/reply` with body `{ body: string }`:
  - Auth via `resolveTenantRequest` (dual-auth) exactly like the GET route; 401/404 the same way.
  - Verify the conversation exists, `tenant_id` matches, `channel` is SMS
    (row in `sms_conversations`), and `from_number` is present; otherwise 404/422.
  - Validate body: trimmed length 1..1600; reject empty.
  - Send the SMS to the customer's number via the **same outbound send path the SMS pipeline
    already uses** (see `lib/sms/dispatch.ts` / the reply-send used by
    `app/api/sms/inbound/route.ts` — reuse, do not hand-roll a new Twilio client), sending
    from the conversation's `to_number` (the tenant's number).
  - On success insert an `sms_messages` row (`direction: 'outbound'`, body, conversation_id)
    and bump the conversation's `last_message_at`; return the created message JSON. Failure
    to send must NOT insert a message row.
  - UI appends the returned message to the open thread without a refetch.
- **R9 — States.** Loading (`LOADING CONVERSATIONS…` mono label on canvas), error (existing
  `ErrorBanner` copy), and empty (`No conversations yet…` current copy) render on the bare
  canvas — no Card. Cold-filter-empty keeps the current friendly copy.
- **R10 — Responsive.** ≥768px: two-pane grid as above (rail compresses toward 290px).
  <768px: single pane — rail list first; selecting a conversation shows the thread
  full-width with a ≥44px back control in the thread header; composer remains sticky above
  the keyboard. No horizontal scroll at 375/768/1024/1440. Pagination is dropped (the API
  caps at 30 rows; the rail scrolls) — `usePagination`/`PaginationControls` usage goes away
  with the old list.
- **R11 — Capture-pipeline invariant.** No edits to `/api/sms/inbound`, `/api/vapi/webhook`,
  `lib/sms/*` dialog logic, or the GET `/api/tenant/chats` handler (the reply route is
  purely additive). Inbound capture, AI dialog, and voice intake behave identically after
  this change. The full vitest suite must pass unmodified (except new tests).

### Testing

- TDD (failing test first) for the logic-bearing pieces: reply-route validation (auth
  rejection, wrong-tenant rejection, voice-channel rejection, empty/oversize body rejection,
  success inserts + returns message — mock the supabase client + send helper) and the
  cold-filter behaviour if its predicate moves. Run with the repo's real command.
- Pure styling/layout is verified visually via screenshots, not tests.

## Constraints

- Minimal diff: no unrequested pages/components/abstractions/refactors; only the named
  surface + the additive reply route. Do not restyle `Transcript`'s other call sites
  (quote cards) — if the new bubbles diverge, build the thread rendering inside the chats
  components rather than mutating the shared `Transcript`.
- Every colour/font/spacing value traces to the existing tokens; no one-off hex, no emoji,
  no gradient text, text on yellow is always `--accent-ink`.
- Real, general UI — no hard-coding to pass a screenshot, no faked states.
- There is uncommitted in-flight work in the repo (quote-queue, quote-ui, globals.css,
  `/m/[token]`) — do not revert or entangle it.
- Reversible edits may proceed directly; confirm before anything destructive.
- The composer sends **real SMS** in environments with live Twilio credentials — during
  verification, never point a send at a real customer number.

## Acceptance criteria & gates

Beautiful, operationalized:
- **Anti-slop:** Manrope display + JetBrains Mono labels only; layout matches Appendix A
  anatomy; intentional tracking/rhythm as specified above.
- **Accessible:** AA contrast (the specified token pairs already pass on `--ink-deep`);
  visible focus (`--focus-ring` idiom / existing focus utilities) on rows, filter, buttons,
  input; full keyboard path (tab through rail rows → thread actions → composer; Enter sends);
  rail rows and all controls ≥44px effective target height; `aria-pressed`/`aria-current`
  on filter + selected row; no emoji-as-icons.
- **Responsive:** no horizontal scroll and no broken grid at 375/768/1024/1440 (R10).
- **Craft:** real SVG icons only (existing lucide/inline set) if any; `cursor:pointer` on
  interactives; background-color transitions ~150ms; no layout shift on hover.
- **Coherent:** tokens only (see Design Decisions 1).

Gate commands (detected from package.json — run each iteration):
- `pnpm lint` — ⚠ discovered during the build: the repo carries a PRE-EXISTING failing
  baseline of ~1102 eslint errors across untouched files (strict `react-hooks` rules —
  set-state-in-effect, purity — plus `no-explicit-any`, present before this work started).
  The gate for this spec is therefore: **zero lint errors in the changed surface** (the
  chats components in page.tsx and every new file), which is verifiable with a scoped
  `npx eslint` run. The repo-wide cleanup is out of scope per the minimal-diff constraint.
- `pnpm typecheck`
- `pnpm test` (vitest; includes the new reply-route tests)
- `pnpm build` — run at least once before declaring done (Next 16 / Turbopack).

Visual gates:
- Dev server + Playwright (`/playwright-cli` or the repo's Playwright setup): screenshots of
  the Chats tab at 375 / 768 / 1024 / 1440, plus one of the reference Chats screen (open the
  standalone HTML, click Conversations) for side-by-side comparison at 1440.
- The authed dashboard flow is driven per the repo's `verify` skill (Clerk-authed
  `/dashboard`).
- `/ui-ux-pro-max` pre-delivery checklist (a11y + responsive + anti-slop) passes.
- `/review` (against this spec) and `/code-review` (diff) report no blocker/major findings.

Definition of done: all Rs met, all gates green, capture-pipeline invariant (R11) confirmed
by the untouched inbound routes + passing suite, completion report delivered (what shipped,
per-breakpoint screenshots, checklist results, exact gate commands, residual risks).

## Known risks / deferred (record in completion report)

- A tradie's manual reply lands inside an AI-managed dialog; the AI only fires on inbound
  webhooks so nothing breaks, but the next AI turn will see the tradie's message in history.
  Acceptable for v1; revisit if dialogs get confused.
- `sms_messages` has no sender column, so historical outbound all renders as `QUOTEMAX`;
  only session-sent messages show `YOU`. Ceiling: add a `sender` column when product needs it.
- Reference shows a static "Online" badge and a "Draft quote →" button; both were mapped to
  honest live equivalents (R5) — visual idiom kept, labels truthful.

## Appendix A — reference Chats screen markup (extracted verbatim from the standalone export)

```html
<sc-if value="{{ isChats }}" hint-placeholder-val="{{ false }}">
  <div data-screen-label="Chats" class="qm-md-chats" style="display:grid;grid-template-columns:minmax(290px,390px) minmax(0,1fr);flex:1;min-height:0">
    <div class="qm-scroll" style="overflow-y:auto;min-height:0;border-right:1px solid var(--ink-line)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--ink-line);position:sticky;top:0;background:var(--ink-deep);z-index:5">
        <span style="font-family:var(--font-mono);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.16em;color:var(--text-sec)">Conversations · 5</span>
        <span style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-dim)">All channels</span>
      </div>
      <sc-for list="{{ chatList }}" as="c" hint-placeholder-count="5">
        <button type="button" class="qm-row" onclick="{{ c.onSelect }}" style="{{ c.rowStyle }}">
          <div style="display:flex;align-items:center;gap:11px">
            <span style="{{ c.avatarStyle }}">{{ c.initial }}</span>
            <div style="min-width:0;flex:1">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span style="font-family:var(--font-sans);font-weight:700;font-size:14px;color:var(--text-pri)">{{ c.who }}</span>
                <span style="flex-shrink:0;font-family:var(--font-mono);font-size:9.5px;color:var(--text-dim)">{{ c.when }}</span>
              </div>
              <div style="margin-top:2px;font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim)">{{ c.meta }}</div>
            </div>
          </div>
          <div style="margin-top:8px;font-size:12.5px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ c.preview }}</div>
        </button>
      </sc-for>
    </div>
    <div class="qm-scroll" style="overflow-y:auto;min-height:0;display:flex;flex-direction:column;background:var(--ink-deep)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 20px;border-bottom:1px solid var(--ink-line);position:sticky;top:0;background:var(--ink-deep);z-index:5">
        <span style="font-family:var(--font-mono);font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.16em;color:var(--text-dim)">{{ chatThread.label }}</span>
        <div style="display:flex;align-items:center;gap:10px">
          <button type="button" onclick="{{ draftFromChat }}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid var(--ink-line);background:transparent;color:var(--text-pri);padding:7px 12px;font-family:var(--font-mono);font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;cursor:pointer">Draft quote →</button>
          <span style="display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border:1px solid color-mix(in srgb, var(--success-bright) 45%, transparent);font-family:var(--font-mono);font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.13em;color:var(--success-bright)">
            <span aria-hidden="true" style="width:6px;height:6px;border-radius:9999px;background:var(--success-bright);animation:qm-pulse-soft 2.4s ease-in-out infinite"></span>Online</span>
        </div>
      </div>
      <div style="padding:26px 30px;display:grid;gap:12px;max-width:880px;width:100%">
        <sc-for list="{{ chatThread.msgs }}" as="m" hint-placeholder-count="4">
          <div style="display:flex;justify-content:{{ m.rowJustify }}">
            <div style="{{ m.bubbleStyle }}">
              <sc-if value="{{ m.showSender }}" hint-placeholder-val="{{ false }}">
                <span style="display:block;margin-bottom:4px;font-family:var(--font-mono);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:var(--accent)">{{ m.senderLabel }}</span>
              </sc-if>
              {{ m.text }}
            </div>
          </div>
        </sc-for>
      </div>
      <div style="margin-top:auto;position:sticky;bottom:0;background:var(--ink-deep);border-top:1px solid var(--ink-line);padding:14px 24px;display:flex;gap:10px;align-items:center">
        <input value="{{ chatInput }}" onchange="{{ onChatInput }}" onkeydown="{{ onChatKey }}" placeholder="Reply by SMS" style="flex:1;min-width:0;height:42px;padding:0 14px;background:var(--ink);border:1px solid var(--ink-line);color:var(--text-pri);font-family:var(--font-sans);font-size:13.5px;outline:none">
        <button type="button" onclick="{{ sendChat }}" style="display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 18px;border:1px solid transparent;background:var(--accent);color:var(--accent-ink);font-family:var(--font-sans);font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;cursor:pointer">Send</button>
      </div>
    </div>
  </div>
</sc-if>
```

## Appendix B — computed data-bound styles (from the .dc source JS)

```js
// conversation row (active = selected)
rowStyle: { display:'block', width:'100%', textAlign:'left', cursor:'pointer', border:0,
  borderLeft:'2px solid ' + (active ? 'var(--accent)' : 'transparent'),
  borderBottom:'1px solid var(--ink-line)',
  background: active ? 'var(--ink)' : 'transparent',
  padding:'15px 16px', transition:'background-color .15s ease' }

avatarStyle: { display:'inline-grid', placeItems:'center', width:'34px', height:'34px',
  flexShrink:0, background: active ? 'var(--accent)' : 'var(--ink)',
  color: active ? 'var(--accent-ink)' : 'var(--text-pri)',
  border:'1px solid ' + (active ? 'transparent' : 'var(--ink-line)'),
  fontFamily:'var(--font-mono)', fontWeight:700, fontSize:'13px' }

// message bubble: inbound = customer (left, plain); outbound = QuoteMax/You (right, accent-tinted)
bubbleStyle: { maxWidth:'86%',
  border:'1px solid ' + (inbound ? 'var(--ink-line)' : 'color-mix(in srgb, var(--accent) 35%, transparent)'),
  background: inbound ? 'var(--ink-deep)' : 'color-mix(in srgb, var(--accent) 10%, transparent)',
  color: inbound ? 'var(--text-sec)' : 'var(--text-pri)',
  padding:'10px 13px', fontSize:'13.5px', lineHeight:1.45 }
// rowJustify: inbound ? 'flex-start' : 'flex-end'
// senderLabel: 'QuoteMax' on outbound history, 'You' on tradie-sent

// hover + scrollbars (already-shipped idioms)
// .qm-row:hover { background: color-mix(in srgb, var(--ink) 55%, transparent) }
// .qm-scroll::-webkit-scrollbar{width:10px} thumb: var(--ink-line) border 2px var(--ink-deep)
```
