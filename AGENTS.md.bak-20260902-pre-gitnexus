# Engineering context for Codex

> See [README.md](README.md) for the public project overview, and [docs/strategy.md](docs/strategy.md) for the living strategy + re-evaluation history.

## Project state

The repository contains planning artifacts, design assets, and the live
application in [quotemate-automation/](quotemate-automation/). The app is a
Next.js implementation; [docs/strategy.md](docs/strategy.md) is the living
source of product decisions and iteration history.

## The decisions that shape the work

These were settled after substantive re-evaluation (see iteration history at the end of `docs/strategy.md`). Don't drift from them silently — if work demands a change, **add a new iteration entry to `docs/strategy.md` explaining the why** before changing this table.

| Decision | What it means in practice |
|---|---|
| **Portal-first v1, not voice-first** | The AI receptionist (voice agent) is a v3+ premium tier. v1 is tradie-typed-intake on a portal. Voice has bad unit economics at SaaS price points (~$1,500/mo COGS per tradie at moderate call volume). |
| **Electrical + plumbing pilots; roofing added in v10** | Electrical (NSW) and plumbing (QLD) remain the original portal wedges. Roofing is the deliberate third trade: dashboard-only, deterministic, and review-required for high-value work. Its current measurement path is Geoscape/form-based; semantic roof-edge candidates are permitted only under the v14/v15 source, legal, and human-review gates. Do not add a fourth trade without a new strategy iteration. |
| **Four agents, not ten** | Quote Drafter, Quote Reviewer, Inspection Coordinator, Conversion Engine. Reception agent is reserved for v3. |
| **Build the pricing book WITH the tradie** | Most owner-operators don't have a structured price list. Ship a base assembly library per trade (built by paid domain experts) and capture the tradie's overlay through guided onboarding. |
| **Eval framework before prompt iteration** | 100 hold-out (intake → quote) pairs, scored by 5-dimension rubric. No prompt change ships without delta measurement. |
| **Stripe Connect Express** for marketplace flow | Each tradie owns their funds; QuoteMax takes a platform fee. Required for Australian payment compliance. |
| **No auto-send in v1** | Tradie human-in-loop is the liability shield. Australian Consumer Law treats accepted quotes as binding contracts. |

## Repository layout

```
.
├── AGENTS.md                          # this file — engineering context
├── README.md                          # public project overview
├── LICENSE                            # MIT
├── .gitignore
├── .Codex/
│   └── agents/
│       └── strategy-reviewer.md       # consistency check across docs/assets
├── assets/
│   ├── quotemate_flow_with_inspection.svg
│   └── quotemate_experience_map.jpeg
├── docs/
│   └── strategy.md                    # living strategy + re-evaluation history
└── quotemate-automation/              # operational Next.js app, tests, SQL, and scripts
```

## Tech stack

| Layer | Choice |
|---|---|
| Frontend + API | Next.js (App Router) on Vercel |
| Auth, DB, storage, RLS | Supabase (Postgres + pgvector) |
| Background workflows | Vercel Workflow (WDK) or Inngest |
| LLM | Codex (Opus for the heavy reasoning step, Haiku for routing) via Vercel AI Gateway |
| Voice agent (v3 only) | Vapi + Deepgram + ElevenLabs |
| SMS | Twilio (AU long codes) |
| Payments | Stripe AU + Stripe Connect Express |
| Email | Resend |
| Analytics | PostHog |
| PDF | react-pdf server-side |

Don't add infrastructure speculatively — wait until the relevant phase begins.

## Conventions (apply once code starts)

- **Currency stored ex-GST; displayed inc-GST** in customer-facing UI
- **Pricing books are versioned**; quotes reference `pricing_book_version_id` so historical quotes stay accurate when prices change
- **AU/NZ-first**: formatting, language, dates, address parsing all default to AU/NZ patterns
- **Multi-tenant via Supabase RLS from day 1** — never bolt it on later. *(v5 deferral: the 2-trade pilot currently shares one DB without per-tenant isolation. Full `tenant_id`/RLS work is flagged as the next architectural debt — see `docs/strategy.md` v5 "What's deferred". Required before scaling beyond ~5 tradies.)*
- **Money-touching LLM steps must use tool-calling**, never emit prices from free-form text
- **Quotes never auto-send in v1** — tradie human-in-loop on every send

## How to work in this repo

- **For strategy or product questions** — read `docs/strategy.md` first. It has the current thinking. The earlier chat-only analysis (recorded as v1 in the iteration history) is superseded.
- **For visual context** — the assets in `assets/` are ground truth for the user-facing flow; both README and strategy doc reference them.
- **When changing a "decisions that shape the work" entry** — append a new iteration entry to `docs/strategy.md` rather than editing the prior one in place. The history is the audit log.
- **When in doubt about scope** — electrical and plumbing retain their narrow auto-quote wedges. Roofing is an explicit third-trade exception (v10): high-value roof work stays deterministic and tradie-review-required. Existing form/Geoscape measurement is the production fallback; the v14/v15 topology feature is source-gated, feature-flagged, and cannot affect a customer-visible quote without an authenticated tradie approval. Do not add a fourth trade without a new `docs/strategy.md` iteration.
- **After editing `docs/strategy.md`** — invoke the `strategy-reviewer` agent to catch any drift across README, AGENTS.md, and the assets.

## Skills, agents, and commands toolkit

**Vendored into `.Codex/`** — version-controlled with the project, accessible without source plugins on the machine:

- **27 skills** in `.Codex/skills/` — see [`.Codex/skills/README.md`](.Codex/skills/README.md)
- **3 plugin-defined subagents + 1 project agent** in `.Codex/agents/`
- **7 commands** in `.Codex/commands/`
- **Plugin landscape doc** at [`.Codex/PLUGINS.md`](.Codex/PLUGINS.md) — what was vendored, what still needs source plugins (MCPs), how to install

The curated mapping of skills/agents/commands to build phases lives at [`docs/skills-toolkit.md`](docs/skills-toolkit.md).

### Invocation conventions

- **Vendored** items use hyphenated names: `/vercel-nextjs`, `/supabase-supabase`, `/stripe-best-practices` (the plugin colon was flattened to a hyphen during vendor).
- **Built-in** Codex skills keep bare names: `/review`, `/simplify`, `/security-review`, `/fewer-permission-prompts`, `/update-config`.
- **Subagents** are launched via the Agent tool (`subagent_type` parameter) or auto-selected by Codex based on task description.

### Always-relevant skills (built-in, ship with Codex)

`Codex-api`, `simplify`, `fewer-permission-prompts`, `review`, `security-review`, `update-config`.

### Phase 1 core stack (vendored)

Skills: `/vercel-bootstrap`, `/vercel-nextjs`, `/vercel-ai-sdk`, `/vercel-ai-gateway`, `/supabase-supabase`, `/supabase-supabase-postgres-best-practices`, `/stripe-best-practices`, `/vercel-shadcn`.

Subagents: `vercel-ai-architect` (designing the Quote Drafter / Reviewer), `vercel-deployment-expert` (Phase 1 deploy), `vercel-performance-optimizer` (mobile-first portal), `strategy-reviewer` (consistency check after `docs/strategy.md` edits).

Commands: `/vercel-bootstrap`, `/vercel-deploy`, `/vercel-env`, `/vercel-status`, `/stripe-explain-error`, `/stripe-test-cards`.

### Plugins still needed at user level (for MCP servers + hooks)

Vendoring covers documentation; some functionality requires the source plugin to be installed:

- **Supabase MCP** — required to actually run SQL, manage migrations, list projects from Codex. Install: `Codex plugin install supabase@Codex-plugins-official`
- **Vercel hooks** — auto-skill-injection, telemetry. Install: `Codex plugin install vercel@Codex-plugins-official`

See [`.Codex/PLUGINS.md`](.Codex/PLUGINS.md) for the full list and rationale.

## What's deliberately not yet set up

- `.Codex/settings.json` — add permissions when you discover repeated prompts (the `fewer-permission-prompts` skill is the right tool for this)
- Custom **project-specific** skills (workflows unique to QuoteMax, e.g. `/add-trade`, `/eval-quote`) — premature for a greenfield repo; add when a workflow repeats
- CI/CD pipelines — add when there's code to test
- Database migrations — Phase 1

## How Codex should approach changes here

- **Don't propose voice-agent work for v1** — deferred to v3+ premium tier by deliberate decision; surface that the request is out-of-scope and ask whether to add it as a v3 entry in the strategy doc.
- **Don't propose a FOURTH trade without an iteration entry.** Roofing is the established third trade (v10); painting, carpentry, landscaping, or another new trade requires a fresh `docs/strategy.md` entry first.
- **Don't recommend ServiceM8/Tradify-style features that already exist in incumbents.** The wedge is the AI quote draft + the paid inspection flow. Calendar, CRM, and invoicing are deferred until those are working.
- **Treat the iteration log in `docs/strategy.md` as load-bearing.** When decisions evolve, the log is how everyone (including future Codex sessions) understands why.
