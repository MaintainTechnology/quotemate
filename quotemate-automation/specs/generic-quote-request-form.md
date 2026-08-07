# Spec: one self-serve quote-request form, every trade

## Goal

Every deployed SMS AI Receptionist opens a quote enquiry the same way: offer a
short self-serve form on a unique URL, and offer to do it over text instead.
Today only painting does this. Roofing, electrical and plumbing have no form at
all — no page, no table, no API route.

Rather than clone painting's surface three times, build **one** token-gated form
that renders trade-specific fields, and point all four receptionists at it.

## The canonical opener (exact shape, all trades)

Three lines. Only the trade word and the URL change.

```
Hi {firstName}, happy to sort a {trade} quote for you.
Quickest way is this short form — fill it in and I'll text your quote straight back: {formUrl}
Or just reply here and I'll ask you a few quick questions instead.
```

- `{firstName}` omitted entirely when unknown — never "Hi ,".
- `{trade}` is the customer-facing word: roofing, painting, electrical, plumbing.
- `{formUrl}` is `${APP_URL}/quote-request/{token}`, a fresh token per request.
- Em dash is intentional here: it matches the shipped painting wording exactly.
  (The no-em-dash rule applies to newly authored SMS copy; this line is being
  standardised ON the existing painting text, which already ships with one.)

If the customer replies wanting the form, acknowledge and wait. If they reply
with anything else, start the Q&A gather — never make them repeat themselves.

## Scope

### 1. Database — `trade_lead_requests`

New migration + `_down`. Mirrors `painting_lead_requests`, plus a `trade` column.

| column | type | notes |
|---|---|---|
| `token` | text PK | the URL segment; unguessable, 32 hex |
| `trade` | text NOT NULL | electrical / plumbing / roofing / painting |
| `tenant_id` | uuid | |
| `conversation_id` | uuid | |
| `customer_phone` | text | |
| `status` | text NOT NULL | `pending` \| `submitted` \| `expired` |
| `quote_token` | text | set once the estimate produces one |
| `created_at` | timestamptz NOT NULL | |
| `submitted_at` | timestamptz | |

Index on `(tenant_id, created_at desc)` and on `status`.

**Do not migrate or touch `painting_lead_requests`.** Painting keeps working on
its current table until this is proven; a follow-up spec retires it.

### 2. Form page — `app/quote-request/[token]/`

- `page.tsx` — server component. Loads the row by token. Unknown, expired or
  already-submitted token renders a friendly dead-end, never a raw 404.
- `QuoteRequestForm.tsx` — client component. Renders the shared fields, then the
  trade-specific block chosen by `trade`.

**Shared fields (every trade):** full address (with the same
`suggest-address` autocomplete painting uses), first name, best contact time,
optional photos, optional notes.

**Trade-specific blocks:**

- **roofing** — work needed (full re-roof / repair / leak trace / gutters),
  current material, Colorbond profile when material is Colorbond, storeys,
  roof pitch.
- **painting** — reuse the existing painting fields exactly: scopes, coats,
  condition, ceiling height, storeys, floor area, colour change.
- **electrical** — job type (downlights / power points / ceiling fans / other),
  quantity, ceiling type, storeys, existing switch within 5 m.
- **plumbing** — job type (hot water / blocked drain / tap / toilet / other),
  for hot water: gas or electric, capacity, indoor or outdoor.

Style follows the QuoteMax design system already used by `PaintRequestForm.tsx`.

### 3. API — `app/api/quote-request/[token]/route.ts`

- `POST` validates the token is `pending`, validates the payload with Zod per
  trade, writes `status = 'submitted'` and `submitted_at`, then kicks off the
  same estimate path the SMS gather uses for that trade.
- Reuses `app/api/paint-request/[token]/suggest-address/route.ts` behaviour at
  `app/api/quote-request/[token]/suggest-address/route.ts`.
- Returns `{ ok: true }` and the customer is texted the existing holding message.
- **Never 200 on failure.** A failed write or a failed estimate hand-off returns
  a non-2xx and does not mark the row submitted.

### 4. Receptionist wiring — all four services

In `C:\Users\dalig\Desktop\MaintainTech\MaintainOrg\QuoteMax\Receptionists`:
`qm-roofing-receptionist`, `qm-electrical-receptionist`,
`qm-plumbing-receptionist`, `qm-painting-receptionist`.

- On a fresh quote enquiry, mint a `trade_lead_requests` row and send the
  canonical opener above.
- Persist the pending token on the conversation state so the reply is understood.
- A reply that wants the form → acknowledge, stay put.
- Any other reply → begin the Q&A gather, carrying anything already said
  (an address in the same message must not be asked for again).
- Painting keeps its current behaviour byte-for-byte until its table is retired;
  only its URL builder changes.

## Definition of done

- [ ] Migration + `_down` + `scripts/run-migration-NNN.mjs`, applied.
- [ ] `/quote-request/[token]` renders for all four trades; unknown token is a
      friendly dead-end.
- [ ] `POST` persists, hands off, and returns non-2xx on any failure.
- [ ] All four services send the canonical opener with a working unique URL.
- [ ] The three-line shape is byte-identical across trades except trade + URL.
- [ ] `npx tsc --noEmit` clean in the monolith and in each edited service.
- [ ] `npx vitest run` green in the monolith; `npm run check` green in front desk.
- [ ] A live SMS per trade produces a link that loads and submits.

## Non-goals

- Retiring `painting_lead_requests` (follow-up).
- Solar and commercial painting (own flows already).
- Changing pricing, grounding, or the sanity bounds.
- Changing the front desk router.

## Known traps

- Form pages live in the **monolith**, not the receptionist services. Services
  only send links. Editing a service alone ships nothing a customer can open.
- `APP_URL` must stay the apex `https://quotemax.com.au`. The `www` host
  307-redirects cross-origin and strips `Authorization`.
- supabase-js resolves `{data, error}` on failure — it does not throw. A bare
  `await` on a write is the silent-failure bug class in this repo.
- Never report a send as delivered without checking the dispatch result.
