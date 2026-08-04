// ─────────────────────────────────────────────────────────────────────────
// The web surface: home, documentation, API explorer, sandbox, keys, login.
// Public pages explain the service; /sandbox and /keys are operator-only
// behind the session in session.ts. All HTML is server-rendered through the
// shared shell in design.ts — one design system across the whole fleet.
// Canonical copy: quotemate-automation/scripts/web-surface/web.controller.ts
// ─────────────────────────────────────────────────────────────────────────

import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { shell, esc, FLEET_MERMAID, type WebContent } from './design'
import { CONTENT } from './content'
import {
  COOKIE, loginEnabled, passwordOk, mintSession, sessionValid,
  readCookie, setCookieHeader, clearCookieHeader,
} from './session'
import { SandboxService } from './sandbox.service'

const c: WebContent = CONTENT

const isSecure = (req: Request): boolean =>
  (req.headers['x-forwarded-proto'] as string | undefined)?.includes('https') ?? false

const authed = (req: Request): boolean =>
  sessionValid(c.service, readCookie(req.headers.cookie, COOKIE))

/** Only ever redirect back to our own paths. */
const safeNext = (next: unknown): string =>
  typeof next === 'string' && /^\/[A-Za-z0-9\-/]*$/.test(next) ? next : '/sandbox'

const publicBase = (req: Request): string => {
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? 'localhost'
  return `${isSecure(req) ? 'https' : 'http'}://${host}`
}

@ApiExcludeController()
@Controller()
export class WebController {
  constructor(private readonly sandbox: SandboxService) {}

  // ── home ──────────────────────────────────────────────────────────────
  @Get('/')
  home(@Req() req: Request, @Res() res: Response): void {
    const caps = c.capabilities
      .map(
        (cap, i) => `<div class="cell"><div class="n">${String(i + 1).padStart(2, '0')}</div>
        <h3>${esc(cap.title)}</h3><p>${esc(cap.body)}</p></div>`,
      )
      .join('\n')
    const endpoints = c.endpoints
      .map(
        (e) => `<tr><td class="m">${e.method}</td><td class="p">${esc(e.path)}</td>
        <td class="a">${esc(e.auth)}</td><td class="d">${esc(e.desc)}</td></tr>`,
      )
      .join('\n')

    const body = `
<header class="hero"><div class="wrap">
  <div class="kicker">QuoteMax · AI receptionist platform</div>
  <h1>${esc(c.name)}</h1>
  <p class="lead">${esc(c.tagline)}</p>
  <div class="meta">
    <span class="chip"><span class="sq"></span>${esc(c.trade)}</span>
    <span class="pill" id="status"><span class="led"></span><span id="status-t">checking…</span></span>
    <span class="chip">SMS · Twilio webhook</span>
  </div>
</div></header>

<section><div class="wrap">
  <div class="sec-head"><div class="kicker tint">What this service is</div>
  <h2>An AI receptionist that answers like staff and prices like a database</h2></div>
  ${c.intro.map((p) => `<p style="color:var(--muted);max-width:76ch;margin-bottom:12px">${esc(p)}</p>`).join('\n')}
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="kicker tint">Capabilities</div>
  <h2>What it does on every turn</h2></div>
  <div class="grid c3">${caps}</div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="kicker tint">Message flow</div>
  <h2>${esc(c.flowTitle)}</h2>
  <p>Every price comes from a tool call against the pricing database — the language model never invents a number.</p></div>
  <div class="diagram"><pre class="mermaid">${esc(c.flowMermaid)}</pre></div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="kicker tint">System architecture</div>
  <h2>Where this service sits in the fleet</h2>
  <p>One Twilio number per tenant. The Front Desk routes each inbound message to the right trade's receptionist; all six services share one database.</p></div>
  <div class="diagram"><pre class="mermaid">${esc(FLEET_MERMAID)}</pre></div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="kicker tint">System design</div>
  <h2>Inside the service</h2></div>
  <div class="diagram"><pre class="mermaid">${esc(c.moduleMermaid)}</pre></div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="kicker tint">Test it</div>
  <h2>Three ways in</h2>
  <p>The sandbox and keys pages need an operator login. Everything required to test — endpoints, credentials, webhook URL — is on those pages.</p></div>
  <div class="grid c3">
    <a class="cell link" href="/sandbox"><div class="n">CHAT</div><h3>Live sandbox</h3>
      <p>Message this receptionist from the browser — the same conversation a customer has over SMS.</p>
      <span class="go">Open the sandbox →</span></a>
    <a class="cell link" href="/api-explorer"><div class="n">SWAGGER</div><h3>API explorer</h3>
      <p>Every endpoint, callable from the browser with request and response schemas.</p>
      <span class="go">Open Swagger →</span></a>
    <a class="cell link" href="/keys"><div class="n">KEYS</div><h3>API keys</h3>
      <p>The credentials this service accepts, with copy-ready values and curl examples.</p>
      <span class="go">View keys →</span></a>
  </div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="kicker tint">Endpoints</div><h2>The API at a glance</h2></div>
  <div class="tablewrap"><table class="api">
    <tr><th>Method</th><th>Path</th><th>Auth</th><th>Purpose</th></tr>
    ${endpoints}
  </table></div>
</div></section>

<script>
fetch('/api/health').then(r=>r.json()).then(h=>{
  const p=document.getElementById('status'),t=document.getElementById('status-t')
  if(h.ok){p.classList.add('up');t.textContent='online · '+Math.round(h.uptimeSeconds/60)+' min up'}
  else t.textContent='degraded'
}).catch(()=>{document.getElementById('status-t').textContent='unreachable'})
</script>`
    res.type('html').send(shell({ content: c, title: 'Home', active: 'home', body, authed: authed(req), mermaid: true }))
  }

  // ── documentation ─────────────────────────────────────────────────────
  @Get('/documentation')
  documentation(@Req() req: Request, @Res() res: Response): void {
    const base = publicBase(req)
    const endpointDocs = c.endpoints
      .map(
        (e) => `<tr><td class="m">${e.method}</td><td class="p">${esc(e.path)}</td>
        <td class="a">${esc(e.auth)}</td><td class="d">${esc(e.desc)}</td></tr>`,
      )
      .join('\n')
    const body = `
<header class="hero" style="padding-bottom:30px"><div class="wrap">
  <div class="kicker">Documentation</div>
  <h1 style="font-size:clamp(30px,4.5vw,44px)">${esc(c.name)} reference</h1>
  <p class="lead">How the service works, what each endpoint expects, and how to test it end to end.</p>
</div></header>

<section style="border-top:0"><div class="wrap">

<div class="docsec"><h2>How it works</h2>
${c.intro.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<div class="diagram"><pre class="mermaid">${esc(c.flowMermaid)}</pre></div>
</div>

<div class="docsec"><h2>Authentication</h2>
<ul>${c.authModel.map((a) => `<li><strong>${esc(a.name)}</strong> — ${esc(a.body)}</li>`).join('\n')}</ul>
<div class="note">Key values live on the <a href="/keys" style="color:var(--accent)">Keys page</a> (operator login required). Rotation = change the variable on the Railway service and redeploy.</div>
</div>

<div class="docsec"><h2>Endpoints</h2>
<div class="tablewrap"><table class="api">
  <tr><th>Method</th><th>Path</th><th>Auth</th><th>Purpose</th></tr>
  ${endpointDocs}
</table></div>
<h3 style="margin-top:26px">Example — run one turn</h3>
<pre class="block">curl -X POST ${esc(base)}${esc(c.sandbox.path)} \\
  -H "content-type: application/json" \\
  -H "${esc(c.sandbox.keyHeader)}: $${esc(c.sandbox.keyEnv)}" \\
  -d '{"from":"${esc(c.sandbox.defaultFrom)}","to":"+61XXXXXXXXX","body":"Hi, I need a quote"}'</pre>
<h3>Example — health</h3>
<pre class="block">curl ${esc(base)}/api/health/deep</pre>
<p><code class="inline">/api/health</code> is liveness (always 200 while serving — the Railway healthcheck target). <code class="inline">/api/health/deep</code> is readiness: 503 plus the missing variable names when configuration is incomplete.</p>
</div>

<div class="docsec"><h2>Testing guide</h2>
<ul>
  <li><strong>Swagger</strong> — open the <a href="/api-explorer" style="color:var(--accent)">API explorer</a>, authorise with the key from the Keys page, and call any endpoint with a live request editor.</li>
  <li><strong>Sandbox</strong> — open the <a href="/sandbox" style="color:var(--accent)">sandbox</a> (login required), set the To number to a tenant's provisioned SMS number, and chat. ${esc(c.sandbox.note)}</li>
  <li><strong>Twilio (production path)</strong> — point a tenant number's inbound SMS webhook at <code class="inline">${esc(base)}/api/sms/inbound</code>. Requests are signature-validated against the Twilio auth token; a customer texting that number then drives the identical pipeline.</li>
</ul>
<div class="banner"><span class="tag">LIVE FIRE</span><span>The sandbox and simulate channel run the REAL pipeline: real database rows, real quote links, and a real SMS to the From number if it is a real mobile. Use a test number.</span></div>
</div>

<div class="docsec"><h2>Configuration</h2>
<p>Every environment variable the service reads is documented in the repo's <code class="inline">.env.example</code>, grouped with an explanation each. The six that gate boot are reported by <code class="inline">/api/health/deep</code> when missing. Web-surface login is controlled by <code class="inline">WEB_ADMIN_PASSWORD</code> (unset ⇒ the sandbox and keys pages stay locked).</p>
</div>

</div></section>`
    res.type('html').send(shell({ content: c, title: 'Documentation', active: 'documentation', body, authed: authed(req), mermaid: true }))
  }

  // ── swagger wrapper ───────────────────────────────────────────────────
  @Get('/api-explorer')
  apiExplorer(@Req() req: Request, @Res() res: Response): void {
    const body = `
<section style="border-top:0;padding-top:36px"><div class="wrap">
  <div class="sec-head"><div class="kicker tint">API explorer</div>
  <h2>Swagger UI — every endpoint, callable</h2>
  <p>The raw document is at <code class="inline">/api/docs-json</code>; the UI below is served by this same service at <code class="inline">/api/docs</code>. Guarded endpoints need the key from the <a href="/keys" style="color:var(--accent)">Keys page</a> — use the Authorize button.</p></div>
  <div class="frame"><iframe src="/api/docs" title="Swagger UI"></iframe></div>
</div></section>`
    res.type('html').send(shell({ content: c, title: 'API explorer', active: 'api', body, authed: authed(req) }))
  }

  // ── sandbox (login required) ──────────────────────────────────────────
  @Get('/sandbox')
  sandboxPage(@Req() req: Request, @Res() res: Response): void {
    if (!authed(req)) return void res.redirect('/login?next=/sandbox')
    const body = `
<section style="border-top:0;padding-top:36px"><div class="wrap">
  <div class="sec-head"><div class="kicker tint">Live sandbox</div>
  <h2>Chat with the ${esc(c.trade)} receptionist</h2>
  <p>${esc(c.sandbox.note)}</p></div>
  <div class="banner"><span class="tag">LIVE FIRE</span><span>This drives the real pipeline — real conversation rows, real quote links, and a real SMS to the From number if it is a real mobile. Keep From on a test number unless you mean it.</span></div>
  <div class="numrow">
    <div><label>From — customer mobile</label><input type="text" id="from" value="${esc(c.sandbox.defaultFrom)}"></div>
    <div><label>To — tenant's provisioned SMS number</label><input type="text" id="to" placeholder="+61…"></div>
  </div>
  <div class="chat">
    <div class="log" id="log">
      <div class="msg sys">Set the To number, then say hello. A slow turn (roof measure) can take minutes.</div>
    </div>
    <div class="bar">
      <textarea id="input" placeholder="Type a customer message…"></textarea>
      <button class="btn" id="send">Send</button>
    </div>
  </div>
</div></section>
<script>
const log=document.getElementById('log'),input=document.getElementById('input'),send=document.getElementById('send')
function add(cls,text){const d=document.createElement('div');d.className='msg '+cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight}
async function go(){
  const from=document.getElementById('from').value.trim(),to=document.getElementById('to').value.trim(),body=input.value.trim()
  if(!body)return
  if(!/^\\+[1-9][0-9]{6,15}$/.test(from)||!/^\\+[1-9][0-9]{6,15}$/.test(to)){add('sys','From and To must be E.164, e.g. +61400000001');return}
  add('out',body);input.value='';send.disabled=true;add('sys','running the pipeline…')
  try{
    const r=await fetch('/web/api/sandbox/message',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({from,to,body})})
    if(r.status===401){location.href='/login?next=/sandbox';return}
    const j=await r.json()
    log.querySelectorAll('.msg.sys').forEach(n=>{if(n.textContent==='running the pipeline…')n.remove()})
    if(j.error)add('sys','error: '+j.error)
    ;(j.replies||[]).forEach(t=>add('in',t))
    if(j.meta)add('sys',j.meta)
    if(!j.error&&!(j.replies||[]).length&&!j.meta)add('sys','no reply returned')
  }catch(e){add('sys','request failed: '+e.message)}
  send.disabled=false;input.focus()
}
send.addEventListener('click',go)
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();go()}})
</script>`
    res.type('html').send(shell({ content: c, title: 'Sandbox', active: 'sandbox', body, authed: true }))
  }

  // ── keys (login required) ─────────────────────────────────────────────
  @Get('/keys')
  keys(@Req() req: Request, @Res() res: Response): void {
    if (!authed(req)) return void res.redirect('/login?next=/keys')
    const base = publicBase(req)
    const rows = c.keys
      .map((k) => {
        const val = process.env[k.env]
        return `<div class="keyrow">
  <div class="top"><span class="env">${esc(k.env)}</span><span class="chip" style="padding:3px 9px">${val ? 'configured' : 'NOT SET'}</span>
    <span class="acts">${val ? `<button class="ghost" data-reveal>Reveal</button><button class="ghost" data-copy>Copy</button>` : ''}</span></div>
  <div class="desc">${esc(k.desc)}</div>
  ${val ? `<div class="val" data-val="${esc(val)}">••••••••••••••••••••••••</div>` : ''}
</div>`
      })
      .join('\n')
    const body = `
<section style="border-top:0;padding-top:36px"><div class="wrap">
  <div class="sec-head"><div class="kicker tint">API keys</div>
  <h2>Credentials this service accepts</h2>
  <p>Display-only by design: keys are configuration, set as Railway service variables. To rotate one, change the variable and redeploy — old values stop working immediately. Nothing on this page is stored in the browser.</p></div>
  ${rows}
  <h3 style="margin-top:34px">Webhook (production entry point)</h3>
  <pre class="block">${esc(base)}/api/sms/inbound</pre>
  <p style="color:var(--muted);font-size:14px">Point a tenant's Twilio number at this URL for inbound SMS. Requests are signature-validated; no API key is used on this path.</p>
  <h3 style="margin-top:26px">Copy-ready test call</h3>
  <pre class="block">curl -X POST ${esc(base)}${esc(c.sandbox.path)} \\
  -H "content-type: application/json" \\
  -H "${esc(c.sandbox.keyHeader)}: &lt;${esc(c.sandbox.keyEnv)} from above&gt;" \\
  -d '{"from":"${esc(c.sandbox.defaultFrom)}","to":"+61XXXXXXXXX","body":"Hi, I need a quote"}'</pre>
</div></section>
<script>
document.querySelectorAll('.keyrow').forEach(row=>{
  const val=row.querySelector('.val'),reveal=row.querySelector('[data-reveal]'),copy=row.querySelector('[data-copy]')
  if(!val)return
  let shown=false
  reveal?.addEventListener('click',()=>{shown=!shown;val.textContent=shown?val.dataset.val:'••••••••••••••••••••••••';reveal.textContent=shown?'Hide':'Reveal'})
  copy?.addEventListener('click',async()=>{await navigator.clipboard.writeText(val.dataset.val);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy',1200)})
})
</script>`
    res.type('html').send(shell({ content: c, title: 'Keys', active: 'keys', body, authed: true }))
  }

  // ── login / logout ────────────────────────────────────────────────────
  @Get('/login')
  loginPage(@Req() req: Request, @Res() res: Response, @Query('next') next?: string, @Query('e') e?: string): void {
    if (authed(req)) return void res.redirect(safeNext(next))
    const inner = loginEnabled()
      ? `${e ? '<div class="err">Wrong password. Try again.</div>' : ''}
<form class="auth" method="post" action="/web/login">
  <input type="hidden" name="next" value="${esc(safeNext(next))}">
  <label>Operator password</label>
  <input type="password" name="password" autofocus autocomplete="current-password">
  <div style="margin-top:22px"><button class="btn" type="submit">Log in</button></div>
  <p style="color:var(--muted);font-size:13px;margin-top:18px">Protects the sandbox and keys pages. The password is the WEB_ADMIN_PASSWORD variable on this service.</p>
</form>`
      : `<div class="auth" style="max-width:520px;margin:0 auto;border:1px solid var(--line);background:var(--panel);padding:38px">
  <div class="kicker" style="color:var(--warn)">Login disabled</div>
  <p style="color:var(--muted);margin-top:12px">WEB_ADMIN_PASSWORD is not set on this service, so the operator pages stay locked. Set it as a Railway variable (and optionally WEB_SESSION_SECRET), redeploy, and log in here.</p>
</div>`
    const body = `<section style="border-top:0;padding:90px 0"><div class="wrap">
  <div style="text-align:center;margin-bottom:34px"><div class="kicker">Operator access</div>
  <h2 style="margin-top:10px">${esc(c.name)}</h2></div>${inner}
</div></section>`
    res.type('html').send(shell({ content: c, title: 'Log in', active: 'login', body, authed: false }))
  }

  @Post('/web/login')
  login(@Body() body: Record<string, string>, @Req() req: Request, @Res() res: Response): void {
    const next = safeNext(body?.next)
    if (!passwordOk(body?.password)) {
      return void res.redirect(`/login?e=1&next=${encodeURIComponent(next)}`)
    }
    const session = mintSession(c.service)
    if (!session) return void res.redirect('/login')
    res.setHeader('Set-Cookie', setCookieHeader(session, isSecure(req)))
    res.redirect(next)
  }

  @Post('/web/logout')
  logout(@Req() req: Request, @Res() res: Response): void {
    res.setHeader('Set-Cookie', clearCookieHeader(isSecure(req)))
    res.redirect('/')
  }

  // ── sandbox API (login required; key stays server-side) ───────────────
  @Post('/web/api/sandbox/message')
  async sandboxMessage(
    @Body() body: { from?: string; to?: string; body?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!authed(req)) return void res.status(401).json({ error: 'not logged in' })
    const e164 = /^\+[1-9]\d{6,15}$/
    const from = String(body?.from ?? '').trim()
    const to = String(body?.to ?? '').trim()
    const text = String(body?.body ?? '').trim()
    if (!e164.test(from) || !e164.test(to) || !text || text.length > 1600) {
      return void res.status(400).json({ error: 'from/to must be E.164 and body 1–1600 chars' })
    }
    const result = await this.sandbox.runTurn(from, to, text)
    res.json(result)
  }
}
