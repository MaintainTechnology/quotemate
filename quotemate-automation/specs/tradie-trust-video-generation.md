# AI-generated tradie trust videos: auto-generation + Videos dashboard tab — Spec

> Contract for `/build` and `/review`. Grounded in the live API probe and codebase
> state of 2026-07-20. Repo uses **pnpm**: `pnpm test` (vitest), `pnpm run typecheck`;
> e2e `pnpm test:e2e` (playwright).

## Title

Generate each tradie's welcome and thank-you trust videos with AI (Veo 3.1 via the
Gemini API), automatically on onboarding and on demand from a new dashboard
"Videos" tab, and surface them through the existing trust-video slots on the
customer quote pages.

## Goal

Every tenant's customer-facing quote pages carry a **branded, spoken welcome
video** (Section 3, "Your tradie") and a **thank-you video** (post-booking page)
without QuoteMax filming anyone. Priority order per slot, already wired at
render time (`trustVideoUrls`, mig 175/177):

1. the tradie's own film (QuoteMax-recorded, future),
2. **NEW: the AI-generated video for this tenant**,
3. the generic QuoteMax default placeholder video,
4. the face-holder tile.

Auto-generation means a freshly-activated tenant with just a company name (and
optionally a logo) gets personalised videos with zero manual work — "eliminating
the need for us to create the videos manually". The dashboard tab lets a tradie
improve the result: owner photo, extra images, business details, and a custom
script per video.

## Ground truth (verified live, 2026-07-20)

- `GEMINI_API_KEY` in `.env.local` **is** the key the requester supplied (byte-identical) —
  nothing to add; the key must never appear in code, docs, or commits.
- The key lists **`veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`,
  `veo-3.1-lite-generate-preview`** — all `predictLongRunning` (start operation →
  poll `operations/<name>` → download video file). Veo 3.x produces native audio
  including spoken dialogue, and accepts reference images.
- `gemini-omni-flash-preview` on this key supports `generateContent`/`countTokens`
  only (no video output method). **The requester's "Gemini Omni" therefore maps to
  the Gemini API's video engine, Veo 3.1** — same API, same key. Use
  `veo-3.1-fast-generate-preview` by default (cost/speed), overridable via
  `TRUST_VIDEO_MODEL`.
- Veo prompt budget is small (`inputTokenLimit: 480`) — scripts must stay short
  (~8s of speech, ≤ ~25 words per video).
- Existing rails from the five-sections feature: `tenants.intro_video_url` /
  `thankyou_video_url` (mig 175), public `tenant-videos` bucket with
  `defaults/welcome.mp4` + `defaults/thank-you.mp4` (mig 177), `trustVideoUrls()`
  resolution + `TrustVideo` player on `/q/[token]` §03, `/q/roof/[token]` §03,
  and `/q/[token]/paid`.

## Requirements

### R1 — Generation library (`lib/videos/`)

- `buildTrustVideoPrompt({ slot, businessName, contactName?, trade?, script?, extraContext? })`
  — pure. Composes a Veo prompt: friendly Australian tradesperson setting, the
  business name visible/spoken, and the **spoken dialogue in quotes** (the script).
  Defaults per slot when no custom script:
  - welcome: introduces the business and invites the customer to book the site
    visit;
  - thank-you: Jon's line — request received, we will be in touch to confirm the
    exact time.
  Australian English; no emoji/exclamation-mark/em-dash in default scripts; hard
  cap well under the 480-token model limit (truncate custom scripts with an
  honest error rather than silently over-running).
- `generateTrustVideo({ tenantId, slot, script?, referenceImage? })` — starts a
  `predictLongRunning` job (reference image = owner photo if supplied, else the
  tenant's logo bytes when available; degrade to text-only prompt on a 400),
  persists the **operation name** immediately, polls to completion, downloads the
  video, uploads to `tenant-videos/<tenantId>/<slot>-<timestamp>.mp4` (public
  bucket), and stamps `tenants.intro_video_url` / `thankyou_video_url`.
- **Resumable by design**: generation state lives in `tenants.trust_video_state`
  jsonb (mig 178): per slot `{ status: idle|generating|ready|failed, operation,
  script, error, updated_at, source: auto|dashboard }`. Any later status read may
  resume an in-flight operation (poll → finalise) so a serverless timeout never
  strands a job.
- Never throws to callers; failures land in `trust_video_state.<slot>.error`.

### R2 — Migration 178 (+ runner)

`tenants.trust_video_state jsonb` (nullable), comment, `notify pgrst`; additive
only. (Next free number after the concurrent workstream's 176 and this feature's
own 177.)

### R3 — Tenant API routes (dual-auth via `resolveTenantRequest`, own-tenant only)

- `GET /api/tenant/videos` — current slot URLs (tenant override or null),
  generation state; **resumes/finalises** any `generating` slot whose operation
  has completed (the polling backstop).
- `POST /api/tenant/videos/generate` — multipart FormData: `slot`
  (`welcome|thankyou|both`), optional `script` per slot, optional `owner_photo`
  file, optional extra images (stored alongside for future use), optional detail
  fields (contact name, blurb). Fast-ack pattern: stamp `generating`, kick the
  Veo job(s), heavy work in `after()`; `maxDuration` raised.
- Input guards: image size/type limits mirroring the logo upload; scripts
  length-capped; slot whitelist.

### R4 — Dashboard "Videos" tab

New tab following the existing dashboard tab registry/pattern (component in
`app/dashboard/_components/VideosTab.tsx` or the page's native structure):

- Shows both slots side by side: current video (player) — tenant's generated/own
  video, else the QuoteMax default marked as "QuoteMax default".
- Per-slot script input (textarea prefilled with the default script) — the
  "chat input to modify the behaviour of the generated video".
- Owner photo upload + extra images upload; business name (prefilled, editable
  contact/details fields).
- Generate / Regenerate button per slot + "generate both"; live status via
  polling `GET /api/tenant/videos` (pattern from an existing polling tab);
  failure states show the stored error and allow retry.
- Copy: Australian English, no emoji/exclamations/em-dashes; canonical tokens.

### R5 — Auto-generation on onboarding

In the activation flow's deferred block: when a tenant activates with a
`business_name` (always true), kick generation of **both** slots with the default
scripts (`source: 'auto'`), using the logo as reference when one was uploaded.
Gated by `TRUST_VIDEO_AUTOGEN` env (default **on**); idempotent — never
regenerate a slot whose status is `ready`/`generating` or whose URL is already
set. Activation response time is unaffected (fast-ack + `after()`).

### R6 — Customer-page integration (mostly already done)

`trustVideoUrls()` already prefers `tenants.intro_video_url`/`thankyou_video_url`
over the defaults — generated videos appear on `/q/[token]` §03,
`/q/roof/[token]` §03 and `/q/[token]/paid` **without page changes**. Verify
end-to-end with one real generated video on a test tenant.

### R7 — Verification

- Unit tests (house style: node-env vitest, DI fakes): prompt builder (defaults,
  custom script, caps, banned punctuation in defaults), state transitions
  (idle→generating→ready/failed, resume path), route guards (slot whitelist,
  auth-scoped tenant).
- **One real end-to-end generation** against a test tenant (Sparky or a scratch
  tenant): Veo job → mp4 in the bucket → tenant row stamped → customer page
  renders the generated video. Keep cost bounded (veo-3.1-fast, 2 videos max);
  record the operation latency in the report.
- `pnpm run typecheck` + full `pnpm test` green; roofing e2e still 9/9.

## Constraints

- Key hygiene: `GEMINI_API_KEY` read from env only; never logged, committed, or
  echoed into client code (all Veo calls are server-side).
- Cost control: default model `veo-3.1-fast-generate-preview`; one in-flight
  generation per slot per tenant (state guard); auto-generation once per tenant.
- The generated video must not silently overwrite a **manually set** video: if a
  slot URL was set with `source` absent/manual, dashboard regeneration requires
  the tradie's explicit action (the Generate button), and auto-gen skips it.
- Additive DB change only (mig 178 + runner, `notify pgrst`).
- No customer-page redesign — the slots and player already exist.
- Person likeness: an uploaded owner photo is used as a REFERENCE image only;
  if Veo rejects it (safety), fall back to logo/text-only and surface the note in
  state — never fail the whole job for this.
- Uploaded supplementary images are stored under
  `tenant-videos/<tenantId>/assets/` for reference use; no gallery UI in v1.

## Out of scope (v1)

- Multi-clip stitched videos (> ~8s), voice cloning, per-quote videos.
- Editing/trimming UI; approval workflow (the tradie can regenerate instead).
- Backfilling every existing tenant automatically (run manually per tenant from
  the dashboard, or a later batch script).
