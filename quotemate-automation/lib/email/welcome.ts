// Renders the one-time "Welcome to QuoteMax" onboarding email — the warm
// introduction a tradie receives the first time they reach the dashboard after
// activating. Pure renderer (no I/O); the send-once orchestration lives in
// lib/onboard/welcome-email.ts.
//
// Brand: the Maintain "Caterpillar" design system — warm charcoal canvas
// (#16120F), Caterpillar-yellow accent (#FFC400) with DARK ink on the fill
// (yellow never takes white text), bold uppercase display type. The palette is
// hardcoded as hex inline styles because email clients don't support CSS
// custom properties (var()), so the on-site tokens can't be referenced here —
// the values mirror app/globals.css :root.
//
// Hard invariants (or rendering throws): a business name + a dashboard URL must
// be present. Everything else degrades gracefully — the phone block is shown
// only when a number exists, and the greeting falls back to a friendly "mate".

export type WelcomeEmailTenant = {
  business_name: string | null
  owner_first_name?: string | null
  /** The tradie's freshly-provisioned QuoteMax line. Optional — the number
   *  block is omitted entirely when absent (e.g. provisioning still pending). */
  twilio_sms_number?: string | null
  /** Trades the tenant operates in — used to personalise the copy. */
  trades?: string[] | null
}

export type WelcomeEmailParams = {
  tenant: WelcomeEmailTenant
  /** Absolute URL to the tradie dashboard, e.g. https://app/dashboard. */
  dashboardUrl: string
}

export type RenderedWelcomeEmail = { subject: string; html: string; text: string }

// ─── Brand palette (mirror of app/globals.css :root) ────────────────
const C = {
  inkDeep: '#16120F',
  inkCard: '#2B2422',
  inkLine: '#3A322C',
  accent: '#FFC400',
  accentInk: '#1C1812',
  textPri: '#F6F1EA',
  textSec: '#C3B8AC',
  textDim: '#A2968A',
} as const

/** Escape text for safe interpolation into HTML attribute / element context. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function requireField(value: string | null | undefined, label: string): string {
  const v = (value ?? '').trim()
  if (!v) throw new Error(`welcome email requires ${label}`)
  return v
}

/** Format an E.164 AU mobile as `+61 4xx xxx xxx`; pass through anything else. */
function formatAuMobile(e164: string): string {
  const cleaned = e164.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('+61') && cleaned.length === 12) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9, 12)}`
  }
  return e164
}

/** "electrical" → "Electrical"; joins multi-trade lists as "Electrical & Plumbing". */
function tradesPhrase(trades: string[] | null | undefined): string {
  const list = (trades ?? []).map((t) => t.trim()).filter(Boolean)
  if (list.length === 0) return ''
  const titled = list.map((t) => t.charAt(0).toUpperCase() + t.slice(1))
  if (titled.length === 1) return titled[0]
  if (titled.length === 2) return `${titled[0]} & ${titled[1]}`
  return `${titled.slice(0, -1).join(', ')} & ${titled[titled.length - 1]}`
}

export function renderWelcomeEmail(p: WelcomeEmailParams): RenderedWelcomeEmail {
  const businessName = requireField(p.tenant.business_name, 'a business name')
  const dashboardUrl = requireField(p.dashboardUrl, 'a dashboard URL')
  const firstName = (p.tenant.owner_first_name ?? '').trim() || 'mate'
  const phoneRaw = (p.tenant.twilio_sms_number ?? '').trim()
  const phone = phoneRaw || null
  const trade = tradesPhrase(p.tenant.trades)

  const subject = `Welcome to QuoteMax — ${businessName} is live`

  // The three steps a tradie's customer journey now runs on autopilot.
  const steps: Array<{ n: string; title: string; body: string }> = [
    {
      n: '01',
      title: 'Customers reach out',
      body: phone
        ? `A customer texts or calls your QuoteMax number — no app for them to download, no form to fill in.`
        : `A customer texts or calls your QuoteMax line — no app for them to download, no form to fill in.`,
    },
    {
      n: '02',
      title: 'Your AI receptionist takes it from here',
      body: `It captures the job, asks the right questions, and even grabs photos — exactly how you would on the phone.`,
    },
    {
      n: '03',
      title: 'A quote goes out in minutes',
      body: `A clear Good / Better / Best quote lands with the customer, and you get pinged to review it. You do the trade — we do the quoting.`,
    },
  ]

  // ─── Plain-text fallback (deliverability + non-HTML clients) ──────
  const text = [
    `Welcome to QuoteMax`,
    ``,
    `G'day ${firstName}, you're on the line.`,
    ``,
    `${businessName} is live on QuoteMax${trade ? ` for your ${trade} quotes` : ''}.`,
    `From now on your AI receptionist answers, quotes, and books — around the clock.`,
    ``,
    ...(phone ? [`Your QuoteMax number: ${formatAuMobile(phone)}`, ``] : []),
    `HOW IT WORKS`,
    ...steps.map((s) => `  ${s.n}. ${s.title} — ${s.body}`),
    ``,
    `Open your dashboard: ${dashboardUrl}`,
    ``,
    `Welcome aboard,`,
    `The QuoteMax crew`,
    ``,
    `—`,
    `QuoteMax · Tradies, by tradies · ${businessName}`,
  ].join('\n')

  // ─── HTML (table layout + inline styles; dark Maintain canvas) ───
  const stepRows = steps
    .map(
      (s) => `
            <tr>
              <td style="padding:0 0 18px 0;" valign="top">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="56" valign="top" style="font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:700;line-height:1;color:${C.accent};padding-top:2px;">${s.n}</td>
                    <td valign="top">
                      <div style="font-size:15px;font-weight:700;color:${C.textPri};letter-spacing:0.2px;margin:0 0 4px 0;">${esc(s.title)}</div>
                      <div style="font-size:14px;line-height:1.55;color:${C.textSec};">${esc(s.body)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`,
    )
    .join('')

  const phoneBlock = phone
    ? `
          <tr>
            <td style="padding:26px 32px 6px 32px;" align="center">
              <div style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.textDim};">Your QuoteMax number</div>
              <div style="font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:700;letter-spacing:1px;color:${C.textPri};margin-top:8px;">${esc(formatAuMobile(phone))}</div>
              <div style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.textDim};margin-top:8px;">Routed straight to your AI receptionist</div>
            </td>
          </tr>`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Welcome to QuoteMax</title>
</head>
<body style="margin:0;padding:0;background:${C.inkDeep};">
  <!-- preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.inkDeep};font-size:1px;line-height:1px;">
    You're on the line. Your AI quote receptionist is open for business${trade ? ` — ${esc(trade)} and ready` : ''}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.inkDeep};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${C.inkCard};border:1px solid ${C.inkLine};">

          <!-- wordmark + live pill -->
          <tr>
            <td style="padding:22px 32px;border-bottom:1px solid ${C.inkLine};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:18px;font-weight:800;letter-spacing:0.4px;text-transform:uppercase;color:${C.textPri};">Quote<span style="color:${C.accent};">Max</span></td>
                  <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.accent};">&#9679; Live</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- hero -->
          <tr>
            <td style="padding:36px 32px 8px 32px;">
              <div style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.accent};margin-bottom:14px;">Welcome to QuoteMax</div>
              <h1 style="margin:0;font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-0.5px;text-transform:uppercase;color:${C.textPri};">
                G&rsquo;day ${esc(firstName)},<br><span style="color:${C.accent};">you&rsquo;re on the line.</span>
              </h1>
              <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;color:${C.textSec};">
                <strong style="color:${C.textPri};">${esc(businessName)}</strong> is live on QuoteMax${trade ? ` for your <strong style="color:${C.textPri};">${esc(trade)}</strong> quotes` : ''}. From now on your AI receptionist answers, quotes, and books jobs &mdash; around the clock, even when you&rsquo;re up a ladder.
              </p>
            </td>
          </tr>
          ${phoneBlock}

          <!-- how it works -->
          <tr>
            <td style="padding:30px 32px 6px 32px;">
              <div style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.textDim};margin-bottom:18px;">How it works</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${stepRows}
              </table>
            </td>
          </tr>

          <!-- CTA button (bulletproof) -->
          <tr>
            <td style="padding:14px 32px 36px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${C.accent};">
                    <a href="${esc(dashboardUrl)}" style="display:inline-block;padding:16px 34px;font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.accentInk};text-decoration:none;">Open my dashboard &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:${C.textDim};">
                Set your pricing, tweak your services, and watch the quotes roll in.
              </p>
            </td>
          </tr>

          <!-- footer -->
          <tr>
            <td style="padding:22px 32px;border-top:1px solid ${C.inkLine};">
              <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${C.textSec};">Welcome aboard,<br><strong style="color:${C.textPri};">The QuoteMax crew</strong></p>
              <p style="margin:14px 0 0 0;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.textDim};">
                QuoteMax &middot; Tradies, by tradies &middot; ${esc(businessName)}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}
