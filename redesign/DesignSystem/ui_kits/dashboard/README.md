# UI kit — Tradie dashboard (CRM + quote review)

The sparky's command centre. Where a tradie reviews what QuoteMax drafted, approves & sends, and manages their pricing book, services and conversations. Desktop-first (design width 1440); collapses to a single column under ~1180px.

Modelled on one business — **Hartley Electrical** (Dave Hartley, NSW EC 89421) — so the data stays coherent with the marketing SMS demo and the customer quote page (Sarah Whitlam's 6 downlights).

## Files
- `index.html` — shell. Loads `styles.css`, React + Babel + lucide, `../_shared/kit.jsx`, then `dashboard.jsx`. Tagged `@dsCard group="Dashboard" viewport="1440x900"`.
- `dashboard.jsx` — one IIFE composing `window.QMUI`. All view data lives at the top (`BIZ`, `QUOTES`, `TIERS`, `RATES`, `ACTIVITY`, `CHATS`).

## Views (left sidebar nav)
1. **Overview** — KPI row (`Quotes this week`, `Awaiting review`, `Deposits collected`, `Avg draft time`), a "needs your review" list, and a "this week" activity feed.
2. **Quotes** *(default)* — master/detail. A scrollable **quote queue** (customer, job, value, `StatusPill`) on the left; selecting one opens the **review panel**: the Good/Better/Best options QuoteMax drafted, the recommended tier's line items, the SMS transcript that produced it, and an **Approve & send** action bar.
3. **Pricing book** — the rate table every quote is built from.
4. **Services** — Electrical (live) and Plumbing (add-a-trade) cards: auto-quote vs `$99` site-visit items, with an on/off switch.
5. **Chats** — conversation list + the selected SMS `Thread`.

## Interactive
- **Sidebar nav** switches views (active item gets the accent rule + lift).
- **Quote queue** rows select into the detail panel.
- **Approve & send** flips the action bar to a sent confirmation.
- **Services** toggles; **theme toggle** in the top bar; **chat list** selects a thread.

## Composes
`Logo, Eyebrow, Btn, Badge, StatusPill, Stat, Avatar, Icon, Thread` from `window.QMUI`, plus a few view-local pieces (`Sidebar`, `Topbar`, `KpiRow`, `QueueRow`, `ReviewTier`).

## Status → StatusPill tone
`review → review` (amber, pulsing) · `sent → live` · `sitevisit → neutral` · `paid → paid` · `declined → error`.
