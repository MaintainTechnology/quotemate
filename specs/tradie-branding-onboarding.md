# Tradie Branding, Onboarding Fields & Quote Display — Spec

## Objective
Make a QuoteMate-generated customer quote look like a real tradie's quote (the way Roo
Roofing's quote for Jon Pepper does) by capturing the tradie's identity at onboarding and
surfacing it on the customer-facing quote. Alongside this, refresh the QuoteMate brand mark
(new logo, displayed larger) and fix the marketing QR code so a scan actually lands on the
latest signup URL. This closes the gap where the live quote page (`/q/[token]`) currently
shows almost no tradie branding — only a small licence footer and "Powered by QuoteMax."

This is for **tradies onboarding to QuoteMate** (so their quotes carry their own brand) and
the **customers** who receive those quotes.

## Context / background
- App lives in `quotemate-automation/` (Next.js 16 App Router). Read
  `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide
  before writing any Next.js code — Next 16 has breaking changes vs. older knowledge.
- **Reference quote** (source of truth for which fields matter): the PDF
  "Quotation for Jon Pepper 670 London Rd, Chandler" (Roo Roofing, 21.06.2026, 2 pages).
  - **Customer** on the sample: Jon Pepper — 670 London Rd, Chandler QLD 4155 ·
    jon@pepco.com.au · 0414 530 836. (NOT the tradie.)
  - **Tradie** on the sample: **Roo Roofing** — contact person **Matthew**, phone
    **0430 803 305**, email **matthewh@rooroofing.com.au**, implied website
    **rooroofing.com.au**, **QBCC** licence + Master Builders / Public Liability insurance,
    prices quoted **"including GST."**
  - Note: the sample shows **no tradie street address** — only the customer's job-site
    address. We still capture a tradie address (optional) for future use.
- **Current code reality (verified):**
  - Brand mark: `app/_components/BrandMark.tsx` — inline SVG, a white "Q" chat-bubble on the
    `bg-accent` tile (the live accent is yellow `#FFC400`, not orange), rendered ~`h-7 w-7`
    (28px). It appears in the **marketing nav + footer** (`app/_components/site.tsx`) and the
    **signup + onboard auth navs**. Favicon `app/icon.svg` and the social card mirror it.
    Correction to an earlier assumption: the **quote and upload page headers do NOT render this
    brand mark** — they render the Maintain Technology parent lockup (`MaintainLogo`,
    `h-8 sm:h-9`); the QuoteMate mark is absent there by design.
  - Quote page `app/q/[token]/page.tsx` renders **only** a licence footer (from
    `pricing_book`: `licence_type`, `licence_number`, `licence_state`, `gst_registered`,
    tenant-scoped by the quote's `tenant_id`) plus a "Powered by QuoteMax" line. No business
    name, logo, address, phone, email, or website is shown. No per-tenant `branding` is applied.
  - Marketing QR: a static inline SVG in `public/docs/platform-capabilities-walkthrough.html`
    with display text `quotemax.com.au/signup` and CTA `https://www.quotemax.com.au/signup`.
    The repo also has a recent "03 · Onboard as a tradie" signup QR and a dynamic per-tenant QR
    API under `app/api/dashboard/marketing/qr/`. Two domains appear in the codebase:
    `quotemax.com.au` (marketing) and `quote-mate-rho.vercel.app` (Vercel production).
  - Onboarding flow: `app/onboard/*`, `app/signup/*`, `app/api/onboard/*`; tenant data in the
    `tenants` table (has a `branding` jsonb), licence/GST in `pricing_book` (tenant-scoped).
- DB changes follow repo convention: a new `sql/migrations/NNN_*.sql` plus a
  `scripts/run-migration-NNN.mjs`, applied to prod Supabase, with `sql/init.sql` kept
  representative. Storage uses Supabase (existing bucket `intake-photos`).
- Styling follows the **Maintain** design system (deep navy, vibrant orange accent, bold
  uppercase display type) — see the `maintain-design-system` skill.

## Requirements

### A. New logo, displayed larger
1. Design a **new** QuoteMate brand mark to replace the current "Q"-on-orange SVG. It must
   remain on-brand with the Maintain system (orange accent on navy/neutral), read clearly at
   favicon size (16–32px) and at a larger nav size, and be a deliberate visual improvement —
   not a recolour of the existing mark.
2. The new mark is delivered as scalable SVG and applied as the **single source of truth**:
   update `app/_components/BrandMark.tsx`, the favicon `app/icon.svg`, and the social/OG card
   so all three match.
3. Increase the brand mark's default render size, and apply it uniformly to every in-app
   nav/footer surface that renders the QuoteMate mark: the marketing nav + footer
   (`app/_components/site.tsx`), the signup/onboard auth navs, the dashboard navs, and the
   remaining secondary navs (admin loader, invites, pricing-wizard, onboard confirmation pages,
   the `/q/[token]/book` nav). "Larger" = a visibly bigger mark than today's 28px, in the
   ≈40–44px range, staying balanced with the surrounding nav/footer type. (The quote/upload page
   headers are out of scope — they show the Maintain Technology parent lockup, not the QuoteMate
   mark; the tradie's own logo reaches those pages via the quote letterhead in R13.)
4. No layout breakage at any breakpoint after the size increase (marketing nav, footer, and the
   signup/onboard auth navs) on mobile and desktop.

### B. Marketing QR points to the latest signup URL
5. Every marketing QR surface must, when scanned, resolve to **`https://www.quotemax.com.au/signup`**
   (destination path `/signup` kept; domain confirmed as the latest). This includes at minimum:
   the QR in `public/docs/platform-capabilities-walkthrough.html`, the "03 · Onboard as a tradie"
   signup QR, and any other static marketing QR found in `public/docs/*.html` or `app/admin/*`.
6. The **encoded QR matrix** (the actual scannable data), the **visible URL caption**, and the
   **CTA link href** must all agree on `https://www.quotemax.com.au/signup`. A QR whose caption
   says one URL but whose matrix encodes another is a failure.
7. The dynamic per-tenant QR generator (`app/api/dashboard/marketing/qr/*`) is **out of scope to
   redesign**, but if it currently emits a stale base domain for `signup`-type QRs, update that
   base domain to `quotemax.com.au` so newly generated signup QRs are consistent.

### C. Onboarding captures tradie identity
8. The tradie onboarding flow collects the following fields:
   - **Required:** logo upload; business name; business phone; business email; licence number;
     licence state (e.g. QBCC / QLD).
   - **Optional:** contact-person name; website URL; business address.
9. GST status is **not** re-asked in onboarding — reuse the existing `pricing_book.gst_registered`
   for the tenant.
10. The logo upload accepts PNG, JPG/JPEG, SVG, or WebP, max 2 MB, and is stored in Supabase
    Storage (existing `intake-photos` bucket or a dedicated tenant-logos bucket); the stored
    public URL is persisted against the tenant.
11. All captured fields are persisted per tenant (new `tenants` columns and/or `branding` jsonb
    via a new migration for any field without an existing column; licence number/state continue
    to populate `pricing_book`). `sql/init.sql` is updated to stay representative and a
    `scripts/run-migration-NNN.mjs` is provided.
12. Client + server validation: required fields cannot be empty; email is a valid email;
    website (if provided) is a valid URL; phone is a plausible AU number; logo meets the
    type/size limits in R10. Server-side validation must not rely on client checks alone.

### D. Quote display mirrors the captured identity
13. Add a **tradie letterhead** to the customer quote page (`app/q/[token]/page.tsx`) that
    displays, for the quote's tenant: logo, business name, contact-person name (if set), phone,
    email, website (if set), and business address (if set). This is the tradie's identity block —
    analogous to the Roo Roofing header on the sample.
14. The existing licence/GST footer (licence type, number, state, GST) is retained and continues
    to be tenant-scoped by the quote's `tenant_id` (no regression in correctness — a quote must
    never show another tenant's licence).
15. Letterhead data is read **scoped to the quote's `tenant_id`**, exactly like the existing
    licence lookup, so a customer never sees another tradie's branding.
16. Styling stays within the Maintain design system and is responsive (mobile + desktop).

## Non-goals
- Not redesigning the entire quote page, marketing site, or dashboard — only the additions above.
- Not building per-tenant theme colours / custom fonts on the quote (branding beyond the logo
  and the identity fields listed). The `tenants.branding` jsonb may store the values but no
  colour-theming engine is built here.
- Not redesigning or re-architecting the dynamic per-tenant QR system (only the base-domain fix
  in R7).
- Not changing pricing, estimation, routing, or the Stripe/payment flow.
- Not adding GST capture to onboarding (reuse existing).
- Not migrating customer-side fields (Jon-Pepper-style customer details already flow through
  intake).
- Not retroactively forcing existing tenants through the new required-logo gate (see edge cases).

## Constraints
- Next.js 16 App Router; follow `quotemate-automation/AGENTS.md`.
- Supabase (Postgres + Storage); DB changes via numbered migration + run-migration script;
  keep `sql/init.sql` representative.
- Multi-tenant correctness: all quote-display reads scoped by the quote's `tenant_id`.
- Maintain design system for all visible UI.
- Server routes use the service-role key (RLS bypassed); tenant isolation stays app-layer.
- Logo ≤ 2 MB; types PNG/JPG/JPEG/SVG/WebP.

## Edge cases to handle
- Existing tenant with no logo (the 4 active tenants) → quote letterhead falls back to business
  name (and/or the QuoteMate mark) instead of a broken image; onboarding's required-logo gate
  applies to **new** onboarding only and does not lock out existing tenants.
- Optional field not provided (no contact name / no website / no address) → that row is omitted
  cleanly from the letterhead, no empty labels or dangling separators.
- Legacy quote with `tenant_id` null (pre-v6) → letterhead degrades to the current behaviour
  (QuoteMate branding + trade-only licence footer), no crash.
- Logo upload too large / wrong type → rejected with a clear inline error; nothing is persisted.
- SVG logo upload → handled safely (sanitised or served as an image, not inlined as executable
  markup) to avoid stored-XSS via a malicious SVG.
- Website entered without scheme (e.g. `rooroofing.com.au`) → normalised to a valid `https://`
  link before display; the displayed link must not 404 due to a missing scheme.
- Very long business name / address → wraps or truncates in the letterhead without breaking the
  layout on mobile.
- QR caption/CTA already says `quotemax.com.au/signup` but the encoded matrix differs → must be
  regenerated so the matrix matches (this is the actual bug to catch).
- Duplicate / re-submitted onboarding → does not create duplicate tenants or orphan a previously
  uploaded logo.

## Definition of done
- [ ] New brand-mark SVG is live in `BrandMark.tsx`, `app/icon.svg`, and the social/OG card, and
      the three are visually identical.
- [ ] The brand mark renders visibly larger than before (≈40px) in the marketing nav, footer,
      and the signup/onboard auth navs, with no layout breakage on mobile or desktop. (The
      quote/upload headers keep the Maintain parent lockup — out of scope per R3.)
- [ ] Scanning each marketing QR (walkthrough HTML, "03 · Onboard as a tradie", any others) opens
      `https://www.quotemax.com.au/signup`; caption + CTA + encoded matrix all match.
- [ ] Onboarding form shows all required + optional fields; required fields (logo, business name,
      phone, email, licence number, licence state) block submission when empty, both client- and
      server-side.
- [ ] Uploading a >2 MB or non-image file is rejected with a clear error and persists nothing;
      a valid logo is stored in Supabase Storage and its URL saved against the tenant.
- [ ] After completing onboarding, the tenant row (and/or `branding` jsonb) holds business name,
      phone, email, contact name, website, address, and logo URL; `pricing_book` holds licence
      number/state; a new migration + run-migration script exist and `init.sql` is updated.
- [ ] A quote for a fully-onboarded tenant shows a letterhead with that tenant's logo, business
      name, contact name, phone, email, website, and address — matching what was entered.
- [ ] A quote for a tenant missing optional fields / a logo, and a legacy `tenant_id`-null quote,
      both render cleanly with graceful fallbacks (no broken images, empty labels, or crashes).
- [ ] The licence/GST footer still shows the correct tenant's licence (tenant-scoped); no quote
      shows another tenant's licence or branding.
- [ ] Website entered without a scheme renders as a working `https://` link.

## Open questions
- **Brand-name inconsistency:** the product is "QuoteMate" but the rendered brand and footer say
  "QuoteMax" (and the QR points to `quotemax.com.au`). Is QuoteMax the intended public name? The
  new logo and any wordmark should follow whichever is correct — confirm before finalising the
  wordmark. (QR work proceeds against `quotemax.com.au` regardless, per the confirmed decision.)
- **New logo design direction:** any specific concept/wordmark/colour preference for the new mark,
  or is "improve the current Q-bubble within the Maintain system" sufficient creative license?
- **Logo storage bucket:** reuse `intake-photos` or create a dedicated `tenant-logos` bucket?
  (Defaulting to a dedicated bucket unless told otherwise.)
