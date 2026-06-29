# Flyer tab — Canva Connect integration

> Upgrade to the existing dashboard **Flyer Designer** ([specs/flyer-designer.md](flyer-designer.md)).
> Adds a real **Canva editor** path alongside the built-in Konva editor, using the
> [Canva Connect APIs](https://www.canva.dev/docs/connect/). The app lives in `quotemate-automation/`.

## The load-bearing finding (why it's not an iframe)

Canva's editor **cannot be embedded in an iframe** (Canva sets framing/CSP restrictions). The
Connect APIs are a server-to-server REST API, not an embeddable widget. So the faithful realization
of "a modal that opens the Canva editor in your app" is Canva's official **return-navigation**
pattern:

1. **Connect** the tenant's Canva account via OAuth 2.0 (authorization code + PKCE, S256).
2. **Create** a flyer-sized design through the API → get its `edit_url`.
3. **Open** that edit URL from a QuoteMate modal (new tab/popup), tagged with a `correlation_state`.
4. The tradie edits in Canva, then **returns** to QuoteMate.
5. **Import** the finished design back via the async **Export API** (PNG + PDF) into the existing
   `flyer-assets` bucket.

Autofill / Brand-template APIs are **Canva Enterprise-only**, so the base flow uses a blank custom
(A4-portrait) design rather than autofill — no Enterprise dependency.

## What was added (isolated `canva_*` subsystem — zero changes to `flyers`)

### Pure, unit-tested core — `lib/canva/`
- `oauth.ts` — PKCE (`code_verifier`/`code_challenge`), authorize-URL + token-exchange/refresh
  request builders, Basic-auth header, token-response parsing, expiry check. Endpoints:
  authorize `https://www.canva.com/api/oauth/authorize`, token `https://api.canva.com/rest/v1/oauth/token`.
- `design.ts` — create-design body (custom 2480×3508), response parsing (`edit_url`/`view_url`),
  `appendCorrelationState`.
- `export.ts` — export-job body + job parsing (`in_progress`/`success`/`failed`, download URLs).
- `config.ts` — reads `CANVA_CLIENT_ID`/`CANVA_CLIENT_SECRET`/optional `CANVA_REDIRECT_URI`.
- `storage.ts` — `flyer-assets` paths namespaced `…/canva/<id>.{png,pdf}`.
- `api-logic.ts` — request zod schemas + connected/format decisions.
- Tests: `lib/canva/*.test.ts` (incl. the RFC 7636 PKCE vector).

### Impure orchestration (server-only)
- `tokens.ts` — Supabase-backed token storage + auto-refresh, one-time PKCE state.
- `client.ts` — thin Connect REST client (create design, export job, poll, download, user id).

### API routes — `app/api/dashboard/flyer/canva/`
| Route | Method | Purpose |
|---|---|---|
| `status` | GET | configured? connected? + this tenant's Canva designs (with export URLs) |
| `connect` | GET | mint PKCE + state, return the Canva consent URL |
| `callback` | GET | OAuth redirect target: exchange code → store tokens; closes the popup |
| `disconnect` | POST | forget the tenant's Canva tokens |
| `designs` | POST | create a Canva design + row; return the edit URL |
| `designs/[id]/import` | POST | export (PNG/PDF) → store in `flyer-assets` → record paths |
| `designs/[id]` | DELETE | drop the QuoteMate design row (ownership-checked) |

All routes are `Bearer`-authenticated and `tenant_id`-scoped (`callback` is bound by the one-time
unguessable `state` instead, since it's a top-level browser redirect).

### UI
- `app/dashboard/flyer/_components/CanvaDesignModal.tsx` — the connect → create → open → import modal.
- `app/dashboard/_components/FlyerDesignerTab.tsx` — adds an "Open Canva" CTA that launches the modal.

### DB — migration 158 (`sql/migrations/158_canva.sql` + `scripts/run-migration-158.mjs`)
- `canva_connections` (per-tenant OAuth tokens), `canva_oauth_states` (short-lived PKCE),
  `canva_designs` (created designs + imported export paths).
- RLS enabled, **service-role-only** grants (these tables hold secrets) — stricter than `flyers`.

## Setup required to go live (manual, one-time)

1. `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` are already in `.env.local`. (Optional:
   `CANVA_REDIRECT_URI` to pin the callback; otherwise it's derived from the request origin.)
2. In the **Canva Developer Portal** for this integration:
   - Add the **redirect URL**: `<origin>/api/dashboard/flyer/canva/callback`
     (dev ngrok URL and `https://quote-mate-rho.vercel.app/...` for prod).
   - Enable scopes: `design:content:read`, `design:content:write`, `design:meta:read`,
     `asset:read`, `asset:write`, `profile:read`.
3. Apply the migration: `node --env-file=.env.local scripts/run-migration-158.mjs`.

## Verification
- `pnpm typecheck` ✓ · `pnpm test` ✓ (`lib/canva/*` unit tests, incl. PKCE RFC vector) · new files lint-clean.
- Live OAuth requires the portal redirect-URL registration above; it can't be exercised in unit tests.
