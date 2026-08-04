// ─────────────────────────────────────────────────────────────────────────
// Web surface design system — "The Command Centre".
// Canonical copy lives in quotemate-automation/scripts/web-surface/; the
// export script stamps it into every service so all six sites share one
// system. Edit THERE, not here.
//
// Tokens: warm-charcoal canvas, one Caterpillar-yellow accent, a per-service
// trade tint, Manrope + JetBrains Mono, square corners, hairline borders and
// lit top-edges instead of shadows. Australian English. No emoji.
// ─────────────────────────────────────────────────────────────────────────

export interface WebContent {
  service: string
  name: string
  trade: string
  tint: string
  tagline: string
  intro: string[]
  capabilities: { title: string; body: string }[]
  flowTitle: string
  flowMermaid: string
  moduleMermaid: string
  endpoints: { method: string; path: string; auth: string; desc: string }[]
  sandbox: {
    mode: 'simulate-poll' | 'message-sync'
    path: string
    keyEnv: string
    keyHeader: string
    enableFlag: string | null
    defaultFrom: string
    note: string
  }
  keys: { env: string; label: string; desc: string }[]
  authModel: { name: string; body: string }[]
}

/** The whole-fleet architecture diagram — the "group diagram" shown on every
 *  service so each page places itself in the system. */
export const FLEET_MERMAID = `flowchart TB
  C["Customer mobile"] -->|SMS| TW["Twilio number\n(one per tenant)"]
  TW -->|webhook| FD["QM Front Desk\ntenant + trade router"]
  FD -->|electrical| E["Electrical\nReceptionist"]
  FD -->|plumbing| P["Plumbing\nReceptionist"]
  FD -->|roofing| R["Roofing\nReceptionist"]
  FD -->|painting| PA["Painting\nReceptionist"]
  FD -->|solar| S["Solar\nReceptionist"]
  E & P & R & PA & S --> DB[("Supabase\nconversations · quotes · pricing")]
  E & P & R & PA & S --> AI["Claude\ndialog + estimation"]
  E & P & R & PA & S --> ST["Stripe\ndeposits"]
  R --> GEO["Geoscape / Google\nroof measurement"]`

const FLEET: { trade: string; service: string }[] = [
  { trade: 'front desk', service: 'qm-front-desk' },
  { trade: 'electrical', service: 'qm-electrical-receptionist' },
  { trade: 'plumbing', service: 'qm-plumbing-receptionist' },
  { trade: 'roofing', service: 'qm-roofing-receptionist' },
  { trade: 'painting', service: 'qm-painting-receptionist' },
  { trade: 'solar', service: 'qm-solar-receptionist' },
]

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CSS = `
:root{
  --canvas:#16120F; --panel:#1C1712; --panel-2:#211B14; --line:#2B241D;
  --ink:#F4EFE7; --muted:#9C917F; --accent:#FFC400; --ok:#7BE495; --warn:#FF7A59;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:'Manrope',-apple-system,'Segoe UI',Roboto,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--canvas);color:var(--ink);font-family:var(--sans);line-height:1.6;
  background-image:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(255,196,0,.05),transparent)}
a{color:var(--ink);text-decoration:none}
::selection{background:var(--accent);color:#16120F}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)}
.kicker.tint{color:var(--tint)}
h1{font-size:clamp(34px,6vw,58px);font-weight:800;letter-spacing:-.02em;line-height:1.05;margin:14px 0 18px}
h2{font-size:26px;font-weight:800;letter-spacing:-.01em;margin:0 0 6px}
h3{font-size:16px;font-weight:700;margin:0 0 6px}
p.lead{font-size:19px;color:var(--muted);max-width:62ch}
section{padding:56px 0;border-top:1px solid var(--line)}
section:first-of-type{border-top:0}
.sec-head{margin-bottom:28px}
.sec-head p{color:var(--muted);max-width:70ch}

nav.top{position:sticky;top:0;z-index:50;background:rgba(22,18,15,.92);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line)}
nav.top .row{display:flex;align-items:center;gap:20px;height:58px}
nav.top .brand{font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
nav.top .brand .dot{width:9px;height:9px;background:var(--tint)}
nav.top .links{display:flex;gap:2px;margin-left:auto;font-family:var(--mono);font-size:12px}
nav.top .links a{padding:8px 12px;color:var(--muted);border:1px solid transparent}
nav.top .links a:hover{color:var(--ink)}
nav.top .links a.on{color:var(--accent);border-color:var(--line);background:var(--panel)}
nav.top .links a.auth{color:var(--tint)}

.chip{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;
  letter-spacing:.14em;text-transform:uppercase;border:1px solid var(--line);padding:6px 12px;color:var(--muted)}
.chip .sq{width:8px;height:8px;background:var(--tint)}
.pill{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;padding:6px 12px;border:1px solid var(--line)}
.pill .led{width:8px;height:8px;border-radius:50%;background:var(--muted)}
.pill.up .led{background:var(--ok);box-shadow:0 0 8px var(--ok)}

.hero{padding:84px 0 64px}
.hero .meta{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}

.grid{display:grid;gap:1px;background:var(--line);border:1px solid var(--line)}
.grid.c2{grid-template-columns:repeat(2,1fr)}
.grid.c3{grid-template-columns:repeat(3,1fr)}
@media(max-width:840px){.grid.c2,.grid.c3{grid-template-columns:1fr}}
.cell{background:var(--panel);padding:26px 24px;position:relative}
.cell::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,var(--tint),transparent 60%);opacity:0;transition:opacity .25s}
.cell:hover::before{opacity:1}
.cell .n{font-family:var(--mono);font-size:11px;color:var(--tint);letter-spacing:.18em;margin-bottom:12px}
.cell p{color:var(--muted);font-size:14.5px}
.cell.link{display:block}
.cell.link:hover{background:var(--panel-2)}
.cell .go{font-family:var(--mono);font-size:12px;color:var(--accent);margin-top:14px;display:block}

.diagram{border:1px solid var(--line);background:var(--panel);padding:28px;overflow-x:auto;margin-top:18px}
.diagram .mermaid{display:flex;justify-content:center;min-height:120px;color:var(--muted);
  font-family:var(--mono);font-size:12px}

table.api{width:100%;border-collapse:collapse;border:1px solid var(--line);font-size:14px}
table.api th{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);text-align:left;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
table.api td{padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:top}
table.api tr:last-child td{border-bottom:0}
table.api .m{font-family:var(--mono);font-size:12px;color:var(--accent)}
table.api .p{font-family:var(--mono);font-size:13px;white-space:nowrap}
table.api .a{font-family:var(--mono);font-size:11px;color:var(--muted)}
table.api td.d{color:var(--muted)}
.tablewrap{overflow-x:auto;border:1px solid var(--line)}
.tablewrap table.api{border:0}

code,pre{font-family:var(--mono)}
pre.block{background:#120F0C;border:1px solid var(--line);padding:18px 20px;font-size:13px;
  overflow-x:auto;line-height:1.7;margin:14px 0}
code.inline{background:var(--panel);border:1px solid var(--line);padding:2px 7px;font-size:12.5px}

.banner{border:1px solid var(--warn);background:rgba(255,122,89,.07);padding:16px 20px;
  font-size:14px;margin:18px 0;display:flex;gap:14px;align-items:baseline}
.banner .tag{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--warn);white-space:nowrap}
.note{border:1px solid var(--line);border-left:2px solid var(--accent);background:var(--panel);
  padding:14px 18px;font-size:14px;color:var(--muted);margin:14px 0}

.docsec{margin-bottom:44px}
.docsec h2{padding-bottom:10px;border-bottom:1px solid var(--line);margin-bottom:18px}
.docsec p{color:var(--muted);max-width:76ch;margin-bottom:10px}
.docsec ul{margin:10px 0 10px 20px;color:var(--muted)}
.docsec li{margin-bottom:7px}
.docsec li strong{color:var(--ink)}

form.auth{max-width:420px;margin:0 auto;border:1px solid var(--line);background:var(--panel);padding:38px}
form.auth label{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--muted);display:block;margin-bottom:10px}
input[type=password],input[type=text],textarea{width:100%;background:#120F0C;border:1px solid var(--line);
  color:var(--ink);padding:12px 14px;font-family:var(--mono);font-size:14px;outline:none}
input:focus,textarea:focus{border-color:var(--accent)}
button.btn{background:var(--accent);color:#16120F;border:0;padding:12px 22px;font-family:var(--mono);
  font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
button.btn:hover{filter:brightness(1.08)}
button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);padding:8px 14px;
  font-family:var(--mono);font-size:12px;cursor:pointer}
button.ghost:hover{color:var(--ink);border-color:var(--muted)}
.err{border:1px solid var(--warn);color:var(--warn);font-family:var(--mono);font-size:13px;
  padding:10px 14px;margin-bottom:18px}

.chat{border:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;height:560px}
.chat .log{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:75%;padding:11px 15px;font-size:14.5px;white-space:pre-wrap;word-break:break-word}
.msg.out{align-self:flex-end;background:var(--accent);color:#16120F}
.msg.in{align-self:flex-start;background:var(--panel-2);border:1px solid var(--line)}
.msg.sys{align-self:center;color:var(--muted);font-family:var(--mono);font-size:12px;background:none}
.chat .bar{display:flex;gap:10px;border-top:1px solid var(--line);padding:14px}
.chat .bar textarea{flex:1;resize:none;height:48px}
.numrow{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.numrow label{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);display:block;margin-bottom:6px}

.keyrow{border:1px solid var(--line);background:var(--panel);padding:20px 22px;margin-bottom:14px}
.keyrow .top{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.keyrow .env{font-family:var(--mono);font-size:13px;color:var(--accent)}
.keyrow .val{font-family:var(--mono);font-size:13px;background:#120F0C;border:1px solid var(--line);
  padding:9px 12px;margin-top:12px;word-break:break-all;color:var(--muted)}
.keyrow .desc{color:var(--muted);font-size:13.5px;margin-top:8px}
.keyrow .acts{display:flex;gap:8px;margin-left:auto}

.frame{border:1px solid var(--line);height:calc(100vh - 200px);min-height:600px}
.frame iframe{width:100%;height:100%;border:0;background:#fff}

footer{border-top:1px solid var(--line);margin-top:40px;padding:44px 0 60px}
footer .cols{display:flex;justify-content:space-between;gap:30px;flex-wrap:wrap}
footer .fleet{display:flex;flex-direction:column;gap:8px}
footer a{font-family:var(--mono);font-size:12px;color:var(--muted)}
footer a:hover{color:var(--accent)}
footer .fine{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:26px;letter-spacing:.06em}

@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.hero>*{animation:rise .5s ease both}
.hero>*:nth-child(2){animation-delay:.07s}.hero>*:nth-child(3){animation-delay:.14s}
.hero>*:nth-child(4){animation-delay:.21s}
`

const MERMAID_BOOT = `
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
mermaid.initialize({
  startOnLoad: true, securityLevel: 'loose', theme: 'base',
  themeVariables: {
    darkMode: true, background: '#1C1712', primaryColor: '#211B14',
    primaryTextColor: '#F4EFE7', primaryBorderColor: '#2B241D',
    lineColor: '#9C917F', secondaryColor: '#211B14', tertiaryColor: '#16120F',
    fontFamily: 'JetBrains Mono, monospace', fontSize: '13px',
    actorBorder: '#FFC400', actorBkg: '#211B14', actorTextColor: '#F4EFE7',
    signalColor: '#9C917F', signalTextColor: '#C9C0B2',
    labelBoxBkgColor: '#211B14', labelTextColor: '#F4EFE7',
    noteBkgColor: '#16120F', noteTextColor: '#9C917F', noteBorderColor: '#2B241D',
    clusterBkg: '#16120F', clusterBorder: '#2B241D', edgeLabelBackground: '#16120F',
  },
})
</script>`

export function shell(opts: {
  content: WebContent
  title: string
  active: 'home' | 'documentation' | 'api' | 'sandbox' | 'keys' | 'login'
  body: string
  authed: boolean
  mermaid?: boolean
}): string {
  const { content: c, title, active, body, authed } = opts
  const link = (href: string, id: string, label: string) =>
    `<a href="${href}"${active === id ? ' class="on"' : ''}>${label}</a>`
  return `<!doctype html>
<html lang="en-AU"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(c.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>:root{--tint:${c.tint}}${CSS}</style>
</head><body>
<nav class="top"><div class="wrap row">
  <a class="brand" href="/"><span class="dot"></span>QuoteMax <span style="color:var(--muted);font-weight:500">/ ${esc(c.name)}</span></a>
  <div class="links">
    ${link('/', 'home', 'Home')}
    ${link('/documentation', 'documentation', 'Documentation')}
    ${link('/api-explorer', 'api', 'API')}
    ${link('/sandbox', 'sandbox', 'Sandbox')}
    ${link('/keys', 'keys', 'Keys')}
    ${authed
      ? `<form method="post" action="/web/logout" style="display:inline"><button class="ghost" type="submit">Log out</button></form>`
      : link('/login', 'login', '<span class="auth">Log in</span>')}
  </div>
</div></nav>
${body}
<footer><div class="wrap"><div class="cols">
  <div>
    <div class="kicker">QuoteMax fleet</div>
    <div class="fleet" style="margin-top:12px">
      ${FLEET.map((f) =>
        f.service === c.service
          ? `<a style="color:var(--accent)">${f.service} · this service</a>`
          : `<a href="https://${f.service}-production.up.railway.app/" target="_blank" rel="noopener">${f.service}</a>`,
      ).join('\n      ')}
    </div>
  </div>
  <div>
    <div class="kicker tint">This service</div>
    <div class="fleet" style="margin-top:12px">
      <a href="/api/docs" target="_blank">Swagger UI</a>
      <a href="/api/health">Health</a>
      <a href="/api/health/deep">Readiness</a>
    </div>
  </div>
</div>
<div class="fine">QUOTEMAX · ${esc(c.service).toUpperCase()} · AI RECEPTIONIST PLATFORM</div>
</div></footer>
${opts.mermaid ? MERMAID_BOOT : ''}
</body></html>`
}
