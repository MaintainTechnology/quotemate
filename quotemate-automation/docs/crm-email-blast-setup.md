# CRM email-blast — setup & operations

Implements [`specs/crm-email-blast.md`](../../specs/crm-email-blast.md). This doc covers
the environment variables and the one-time external setup the feature needs to run
in a real environment. The code is built + unit-tested without any of these, but
real CRM connections and email delivery require them.

## 1. Apply the database migration

```
node --env-file=.env.local scripts/run-migration-152.mjs
```

Creates `crm_connections`, `crm_contacts`, `email_campaigns`, `email_sends`,
`email_unsubscribes` (all RLS-on, tenant-scoped). The run script verifies the
tables exist with RLS enabled.

## 2. Environment variables

| Var | Purpose | Notes |
|---|---|---|
| `ENCRYPTION_KEY` | AES-256-GCM key for CRM tokens at rest | `openssl rand -base64 32` (decodes to 32 bytes). Required to connect a CRM. |
| `OAUTH_STATE_SECRET` | Signs the OAuth `state` param | Falls back to `ENCRYPTION_KEY` if unset. |
| `UNSUBSCRIBE_SECRET` | Signs unsubscribe links | Falls back to `ENCRYPTION_KEY` if unset. |
| `RESEND_API_KEY` | Resend API key (sending) | Required to send the blast. |
| `RESEND_FROM_EMAIL` | From address, e.g. `QuoteMax <noreply@yourdomain>` | Domain must be verified in Resend. |
| `APP_URL` | Public base URL | Used for QR + unsubscribe links when a request origin isn't available. |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` / `HUBSPOT_REDIRECT_URI` | HubSpot OAuth app | Redirect URI = `{APP_URL}/api/tenant/crm/callback`. Scope `crm.objects.contacts.read`. |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REDIRECT_URI` | Zoho OAuth app | Scope `ZohoCRM.modules.contacts.READ`. |
| `ZOHO_ACCOUNTS_DOMAIN` / `ZOHO_API_DOMAIN` | Zoho data-centre override | Optional. Defaults to global `.com`; AU = `https://accounts.zoho.com.au` / `https://www.zohoapis.com.au`. |

A provider only appears in the dashboard once its three OAuth vars are set
(`configuredProviders()`); a missing provider never breaks the others.

## 3. Register the OAuth apps

- **HubSpot**: developer portal → create an app → set the redirect URI to
  `{APP_URL}/api/tenant/crm/callback`, scope `crm.objects.contacts.read`.
- **Zoho**: API console → Server-based application → same redirect URI, scope
  `ZohoCRM.modules.contacts.READ`. Note the data centre your account lives in.

## 4. How it flows

1. Tradie clicks **Connect HubSpot/Zoho** on `/dashboard/crm` → `GET /api/tenant/crm/connect/[provider]`
   returns the authorize URL → browser redirects to the CRM.
2. CRM redirects back to `GET /api/tenant/crm/callback` with a signed `state`; we
   exchange the code, store **encrypted** tokens, and kick off a first contact import.
3. **Sync** (`POST /api/tenant/crm/sync`) re-imports contacts (deduped by email,
   refreshing the token if expired).
4. **Preview** (`POST /api/tenant/campaigns/announcement`) shows the recipient count
   + breakdown **and a rendered preview of the email** (R7); **Send** (`confirm: true`)
   renders + delivers per recipient and records per-recipient status — `sent`, `failed`,
   or `suppressed` (R12). `mode: 'unsent'` (default) skips already-sent contacts;
   `mode: 'all'` re-sends to everyone. Unsubscribes are always suppressed and a `sent`
   row is never downgraded by a later failed re-send. Campaign `sent`/`failed` counts
   are cumulative across re-sends.
5. Every email carries a signed unsubscribe link → `GET /api/email/unsubscribe/[token]`
   records the suppression. The QR code points at `/start/[tenantId]`.

## 5. Compliance

The announcement renderer refuses to build an email without a business name,
physical address, Twilio number, and unsubscribe link — so a non-compliant send is
impossible. The send endpoint additionally 400s if the tenant profile is missing an
address or Twilio number. Imported contacts are the tradie's own consented customers;
QuoteMax sends as the named tradie business.

## 6. Known limits (v1)

- Sends run inline with a 60s `maxDuration`. Very large lists should move to a queue
  / cron; today the per-recipient `email_sends` rows make a resumable re-send safe.
- No open/click analytics beyond per-recipient send status.
- HubSpot + Zoho only (the provider interface leaves room for more).
