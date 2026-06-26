# Spec: CRM integration + lead-list announcement email blast

> Status: BUILT (2026-06-26). All §8 decisions resolved. Lib layer + 7 API routes +
> dashboard UI + public QR landing implemented with full unit/route test coverage.
> Setup + ops: [`quotemate-automation/docs/crm-email-blast-setup.md`](../quotemate-automation/docs/crm-email-blast-setup.md).
> Remaining manual steps (not code): apply migration 152 to prod Supabase, set the
> env vars, and register the HubSpot/Zoho OAuth apps.
> Owner: (tradie-facing feature, QuoteMax / quotemate-automation)

## 1. Objective

Let a tradie (tenant) connect their existing CRM, import their lead/contact list,
and send a one-time announcement email to that list introducing their new QuoteMax
account. The email tells each lead they can now get an instant quote by texting or
scanning a QR code that points at the tradie's quote intake / Twilio number.

The wedge: turn a tradie's existing dormant lead list into live QuoteMax intakes.

## 2. Users & context

- **Actor:** an authenticated tradie in the `/dashboard`.
- Each tenant already has: `business_name`, a business address, and a provisioned
  Twilio phone number (`tenants` row). Reuse these — do not re-collect them.
- Leads currently live in a third-party CRM (HubSpot or Zoho for v1). QuoteMax has
  no CRM connection today.
- Email is sent via the existing Resend integration. Do not add a new email vendor.

## 3. Requirements

### CRM connection
- **R1.** Add a "Connect your CRM" section in the tradie dashboard listing supported
  providers (HubSpot, Zoho for v1) with a Connect button each.
- **R2.** Connecting uses the provider's OAuth flow. On success, store the access +
  refresh tokens **encrypted at rest**, scoped to `tenant_id`.
- **R3.** Behind a provider interface (`connect()`, `fetchContacts()`,
  `refreshToken()`) so additional CRMs can be added without touching call sites.
- **R4.** On connect (and on a manual "Sync" action), fetch the tenant's contacts
  (at minimum: email, first name, last name) and store them scoped to `tenant_id`.
  De-duplicate by email.
- **R5.** Show the tradie the connected provider, last sync time, and contact count.
  Allow disconnect (which deletes stored tokens and, optionally, imported contacts).

### Announcement email blast
- **R6.** Add an "Announce my QuoteMax account" action that composes the announcement
  email to the imported lead list. The campaign is **re-sendable**: the tradie can run
  it once now and again later (e.g. after a sync pulls in new contacts). On re-send,
  default the recipient list to contacts not previously sent this campaign, with an
  option to send to everyone again.
- **R7.** Before each send, show a confirmation screen with the exact recipient count
  and a preview of the email. The blast only sends on explicit confirmation.
- **R8.** The email body must include, populated from the tenant record:
  - business name
  - business address
  - the tradie's QuoteMax (Twilio) phone number
  - a scannable QR code (see R9)
  - a call-to-action to text or scan for an instant quote
- **R9.** The QR code encodes the **tradie's quote intake page URL** (the customer-
  facing intake/quote-request page for that tenant). Generated server-side as an
  embeddable image (data URI or hosted asset).
- **R10.** Each email includes a working **unsubscribe link** and the business's
  **physical postal address** (legal requirement for bulk/commercial email).
- **R11.** Suppress sending to any contact who has previously unsubscribed; record
  unsubscribes per tenant and honor them on future sends.
- **R12.** Sending is throttled/queued so a large list does not block the request or
  trip Resend rate limits; record per-recipient send status (sent / failed / suppressed).

## 4. Data model (proposed)

New migration `sql/migrations/NNN_crm_integration.sql` (+ matching
`scripts/run-migration-NNN.mjs`), all tables RLS-on and `tenant_id`-scoped:

- `crm_connections` — `id`, `tenant_id`, `provider` (`hubspot`|`zoho`), `access_token`
  (encrypted), `refresh_token` (encrypted), `expires_at`, `connected_at`,
  `last_synced_at`, `status`.
- `crm_contacts` — `id`, `tenant_id`, `connection_id`, `email`, `first_name`,
  `last_name`, `external_id`, `imported_at`. Unique on (`tenant_id`, `email`).
- `email_campaigns` — `id`, `tenant_id`, `type` (`announcement`), `subject`, `body`,
  `recipient_count`, `status`, `created_at`, `sent_at`.
- `email_sends` — `id`, `tenant_id`, `campaign_id`, `contact_id`, `email`,
  `status` (`queued`|`sent`|`failed`|`suppressed`), `error`, `sent_at`.
- `email_unsubscribes` — `id`, `tenant_id`, `email`, `unsubscribed_at`. Unique on
  (`tenant_id`, `email`).

## 5. Surfaces (proposed)

- UI: `/dashboard` → new "Marketing / CRM" tab.
- API: `/api/tenant/crm/connect/[provider]` (OAuth start), `/api/tenant/crm/callback`
  (OAuth callback), `/api/tenant/crm/sync`, `/api/tenant/crm/disconnect`,
  `/api/tenant/campaigns/announcement` (compose + confirm + send),
  `/api/email/unsubscribe/[token]` (public unsubscribe).
- Lib: `lib/crm/provider.ts` (interface) + `lib/crm/hubspot.ts`, `lib/crm/zoho.ts`;
  `lib/email/campaign.ts` (queue + send via Resend); `lib/qr/generate.ts`.

## 6. Email copy (v1 announcement)

**Subject:** `{{BusinessName}} now gives instant quotes — just text us`

**HTML / body:**

```
Hi {{FirstName}},

Good news — {{BusinessName}} is now on QuoteMax, so you can get a fast,
itemised quote without waiting around for a callback.

Need a price? Text a quick description of the job (a photo helps) to
{{TwilioNumber}}, or scan the code below. You'll get a clear
Good / Better / Best quote back, usually within minutes.

        [ QR CODE ]
     Scan to start your quote

{{BusinessName}}
{{BusinessAddress}}
{{TwilioNumber}}

Cheers,
{{TradieName}}

—
You're receiving this because you're a contact of {{BusinessName}}.
Not interested? Unsubscribe: {{UnsubscribeUrl}}
{{BusinessName}} · {{BusinessAddress}}
```

Tone: plain AU/NZ English, friendly, no hype. All `{{...}}` tokens resolve from the
tenant record or the per-recipient contact.

## 7. Constraints & non-goals

**Constraints**
- Every CRM read and every email send is scoped by `tenant_id`. No cross-tenant
  access, ever.
- OAuth tokens encrypted at rest; never logged, never returned to the client.
- No silent or automatic sends — explicit tradie confirmation with recipient count.
- Compliant bulk email only: physical address + working unsubscribe on every send;
  honor unsubscribes. (Spam Act 2003 in AU; CAN-SPAM in US.) Consent basis: the
  imported contacts are the tradie's own customers who consented to email from that
  business — QuoteMax sends on the tradie's behalf as the named sender. The unsubscribe
  + address requirements still apply to every send.
- Reuse Resend + the tenant's existing Twilio number; provision nothing new.

**Non-goals (v1)**
- No *automated* drip sequences or scheduled/triggered sends. The announcement is
  re-sendable on demand by the tradie (R6), but QuoteMax does not auto-send on a
  schedule or in response to events.
- No CRM write-back (we only read contacts).
- No CRMs beyond HubSpot + Zoho (interface leaves room; do not build others now).
- No analytics dashboard (open/click tracking) beyond per-recipient send status.

## 8. Resolved decisions

1. **QR destination:** the QR code opens the **tradie's quote intake page** (not an
   `sms:` link). Reflected in R9.
2. **CRM scope for v1:** **HubSpot + Zoho**. Provider interface (R3) leaves room for
   more later; none built in v1.
3. **One-shot vs. reusable:** **both** — the announcement is a re-sendable campaign the
   tradie can run now and again later. Reflected in R6; no automated scheduling (§7
   non-goals).
4. **Contact consent:** the imported contacts are the **tradie's own customers who have
   consented to email from that business**. QuoteMax sends on the tradie's behalf as the
   named sender; unsubscribe + physical-address requirements still apply per send.

## 9. Definition of done

- A tradie can connect HubSpot or Zoho via OAuth, see their imported contact count,
  and disconnect.
- Tokens are stored encrypted and scoped to the tenant; no token is ever logged.
- The tradie can preview the announcement, see the exact recipient count, and send
  only after explicit confirmation.
- Each delivered email contains business name, address, Twilio number, a scannable QR
  code, a CTA, a working unsubscribe link, and the physical address.
- Unsubscribed contacts are suppressed on send and recorded.
- Sends are queued (large lists don't time out) with per-recipient status recorded.
- New tables are RLS-on and tenant-scoped; migration + run script committed; tests
  cover provider import, tenant scoping, unsubscribe suppression, and token encryption.
