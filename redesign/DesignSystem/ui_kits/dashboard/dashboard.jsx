/* QuoteMax — Tradie dashboard (CRM + quote review). Composes window.QMUI.
   A single sparky's command centre: review QuoteMax-drafted quotes, approve &
   send, manage the pricing book and services, read SMS conversations. */
(function () {
const { useState } = React;
const { Logo, Eyebrow, Btn, Badge, StatusPill, Stat, Avatar, Icon, useLucide, aud, Thread } = window.QMUI;

/* ─── Business identity (the tradie using QuoteMax) ───────────────── */
const BIZ = {
  name: 'Hartley Electrical', owner: 'Dave Hartley', region: 'Sydney · NSW',
  licence: 'NSW EC 89421', abn: '54 219 887 663', number: '0480 102 030',
};

/* ─── Sidebar nav ─────────────────────────────────────────────────── */
const NAV = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { id: 'quotes', label: 'Quotes', icon: 'file-text', badge: 2 },
  { id: 'pricing', label: 'Pricing book', icon: 'book-open' },
  { id: 'services', label: 'Services', icon: 'wrench' },
  { id: 'chats', label: 'Chats', icon: 'message-square' },
];

/* ─── Status mapping for the queue ────────────────────────────────── */
const STATUS = {
  review:    { tone: 'review',  label: 'Review' },
  sent:      { tone: 'live',    label: 'Sent' },
  sitevisit: { tone: 'neutral', label: 'Site visit' },
  paid:      { tone: 'paid',    label: 'Deposit paid' },
  declined:  { tone: 'error',   label: 'Declined' },
};

/* ─── Quote queue data ────────────────────────────────────────────── */
const TIERS = [
  { tier: 'Standard', price: 890,  deposit: 267,  what: '6× dimmable LED downlights, warm white. Like-for-like, existing wiring.' },
  { tier: 'Recommended', price: 1180, deposit: 354, recommended: true, what: '6× CCT-selectable downlights, dimmable. 5-year warranty, tidy cut-ins.' },
  { tier: 'Premium', price: 1540, deposit: 462, what: '6× smart app-controlled downlights, individual dimming. 7-year warranty.' },
];
const LINE_ITEMS = [
  { d: 'Premium CCT downlight — supply + install', q: 6, rate: 190 },
  { d: 'Dimmer module (LED-rated)', q: 1, rate: 90 },
  { d: 'Make good + test, single circuit', q: 1, rate: 100 },
];
const TRANSCRIPT = [
  { from: 'customer', text: "Hey mate, need 6 downlights in the lounge. What's it cost?" },
  { from: 'quotemax', text: 'All new fittings, or swapping existing? And is there roof-space access?' },
  { from: 'customer', text: 'All new. Roof access is easy.' },
  { from: 'quotemax', text: 'Beauty. Drafting three options now — Dave will confirm and send shortly.' },
];
const QUOTES = [
  { id: 'Q-1043', name: 'Sarah Whitlam', suburb: 'Ashfield', job: '6× LED downlights — lounge', value: 1180, status: 'review', updated: '4 min ago', detail: true },
  { id: 'Q-1042', name: 'Marco Felipe', suburb: 'Marrickville', job: '2× ceiling fans + 3 GPOs', value: 940, status: 'sent', updated: '1 hr ago' },
  { id: 'Q-1041', name: 'The Dorrigo Hotel', suburb: 'Newtown', job: 'Switchboard upgrade', value: null, status: 'sitevisit', updated: '3 hr ago' },
  { id: 'Q-1040', name: 'Jen Alcorta', suburb: 'Petersham', job: 'Smoke alarm compliance ×4', value: 560, status: 'paid', updated: 'Yesterday' },
  { id: 'Q-1039', name: 'Colin Reedy', suburb: 'Stanmore', job: 'Outdoor lighting + GPO', value: 720, status: 'review', updated: 'Yesterday' },
  { id: 'Q-1038', name: 'Priya Naidu', suburb: 'Enmore', job: 'Oven + cooktop circuit', value: null, status: 'declined', updated: '2 days ago' },
];

const RATES = [
  ['Standard LED downlight — supply + install', 'each', 145],
  ['Premium CCT downlight — supply + install', 'each', 190],
  ['Power point / GPO (new)', 'each', 165],
  ['Ceiling fan install (existing point)', 'each', 240],
  ['Smoke alarm — 240V photoelectric', 'each', 140],
  ['Outdoor wall light', 'each', 185],
  ['Callout + first hour', 'job', 120],
  ['Site visit — complex jobs', 'fixed', 99],
];

const ACTIVITY = [
  { icon: 'check-check', text: 'Jen Alcorta paid a $168 deposit', sub: 'Smoke alarm compliance ×4 · booked', tone: 'var(--success-bright)' },
  { icon: 'send', text: 'Quote sent to Marco Felipe', sub: '2× ceiling fans + 3 GPOs · $940', tone: 'var(--text-sec)' },
  { icon: 'phone-incoming', text: 'Site visit booked — The Dorrigo Hotel', sub: 'Switchboard upgrade · $99 paid', tone: 'var(--text-sec)' },
  { icon: 'sparkles', text: 'QuoteMax drafted a quote for Sarah Whitlam', sub: '6× LED downlights · 38s · needs review', tone: 'var(--accent)' },
];

const px = (n) => `${n}px`;
const mono = (extra = {}) => ({ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.14em', ...extra });

/* ─── Sidebar ─────────────────────────────────────────────────────── */
function Sidebar({ view, setView }) {
  return (
    <aside className="qm-dash-side" style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--ink-line)', background: 'var(--ink)', minHeight: 0 }}>
      <div style={{ padding: '20px 20px 18px', borderBottom: '1px solid var(--ink-line)' }}>
        <Logo size={32} sub="Dashboard" />
      </div>
      <nav style={{ display: 'grid', gap: 4, padding: 12, flex: 1 }}>
        {NAV.map((n) => {
          const active = n.id === view;
          return (
            <button key={n.id} type="button" onClick={() => setView(n.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px solid', borderColor: active ? 'color-mix(in srgb, var(--accent) 40%, var(--ink-line))' : 'transparent', background: active ? 'var(--ink-card)' : 'transparent', color: active ? 'var(--text-pri)' : 'var(--text-sec)', padding: '11px 12px', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: active ? 700 : 500, position: 'relative' }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: active ? 'var(--accent)' : 'transparent' }} />
              <Icon name={n.icon} size={18} color={active ? 'var(--accent)' : 'var(--text-dim)'} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge ? <span style={mono({ fontSize: 10, fontWeight: 700, color: 'var(--accent-ink)', background: 'var(--accent)', padding: '2px 7px' })}>{n.badge}</span> : null}
            </button>
          );
        })}
      </nav>
      <div style={{ borderTop: '1px solid var(--ink-line)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name={BIZ.owner} tone="accent" size={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 14, color: 'var(--text-pri)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{BIZ.name}</div>
            <div style={mono({ fontSize: 10, color: 'var(--text-dim)' })}>{BIZ.licence}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ─── Top bar ─────────────────────────────────────────────────────── */
function ThemeToggle() {
  const [t, setT] = useState('dark');
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', t); }, [t]);
  return (
    <button type="button" aria-label="Toggle theme" onClick={() => setT((p) => (p === 'dark' ? 'light' : 'dark'))}
      style={{ display: 'inline-grid', placeItems: 'center', width: 40, height: 40, border: '1px solid var(--ink-line)', background: 'transparent', color: 'var(--text-sec)', cursor: 'pointer' }}>
      <Icon name={t === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  );
}
function Topbar({ title, sub }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid var(--ink-line)', padding: '16px 28px', background: 'color-mix(in srgb, var(--ink-deep) 80%, transparent)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 20 }}>
      <div>
        <h1 className="qm-display" style={{ margin: 0, fontSize: 26, color: 'var(--text-pri)' }}>{title}</h1>
        {sub ? <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{sub}</p> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--ink-line)', padding: '9px 13px', color: 'var(--text-sec)' }}>
          <Icon name="phone" size={15} color="var(--accent)" />
          <span style={mono({ fontSize: 12, color: 'var(--text-pri)', letterSpacing: '0.1em' })}>{BIZ.number}</span>
        </span>
        <ThemeToggle />
        <Btn variant="primary" size="md" withArrow>New quote</Btn>
      </div>
    </header>
  );
}

/* ─── KPI row ──────────────────────────────────────────────────────── */
const KPIS = [
  { value: '23', label: 'Quotes this week' },
  { value: '2', label: 'Awaiting review', accent: 'var(--warning-bright)' },
  { value: '$3,240', label: 'Deposits collected' },
  { value: '38s', label: 'Avg draft time' },
];
function KpiRow() {
  return (
    <div className="qm-kpi-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, border: '1px solid var(--ink-line)', background: 'var(--ink-line)' }}>
      {KPIS.map((k) => (
        <div key={k.label} className="qm-edge-lit" style={{ background: 'var(--ink-card)', padding: '22px 24px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 36, lineHeight: 1, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums', color: k.accent || 'var(--accent)' }}>{k.value}</div>
          <div style={mono({ marginTop: 10, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' })}>{k.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── Queue row ───────────────────────────────────────────────────── */
function QueueRow({ q, active, onClick }) {
  const [h, setH] = useState(false);
  const s = STATUS[q.status];
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, width: '100%', textAlign: 'left', cursor: 'pointer', border: 0, borderLeft: '2px solid', borderLeftColor: active ? 'var(--accent)' : 'transparent', borderBottom: '1px solid var(--ink-line)', background: active ? 'var(--ink)' : h ? 'color-mix(in srgb, var(--ink) 55%, transparent)' : 'transparent', padding: '16px 20px', transition: 'background-color .15s ease' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: 'var(--text-pri)' }}>{q.name}</span>
          <span style={mono({ fontSize: 10, color: 'var(--text-dim)' })}>{q.id}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.job}</div>
        <div style={mono({ marginTop: 7, fontSize: 10, color: 'var(--text-dim)' })}>{q.suburb} · {q.updated}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16, color: q.value ? 'var(--text-pri)' : 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{q.value ? aud(q.value) : '—'}</span>
        <StatusPill tone={s.tone} pulse={q.status === 'review'}>{s.label}</StatusPill>
      </div>
    </button>
  );
}

/* ─── Quote detail (Good / Better / Best review) ──────────────────── */
function ReviewTier({ t }) {
  return (
    <div className="qm-edge-lit" style={{ position: 'relative', background: 'var(--ink-card)', border: '1px solid', borderColor: t.recommended ? 'var(--accent)' : 'var(--ink-line)', padding: '18px 18px 20px' }}>
      {t.recommended ? <span style={mono({ position: 'absolute', top: -1, left: 0, fontSize: 9, fontWeight: 700, color: 'var(--accent-ink)', background: 'var(--accent)', padding: '4px 9px' })}>Recommended</span> : null}
      <div style={mono({ marginTop: t.recommended ? 12 : 0, fontSize: 11, fontWeight: 600, color: 'var(--accent)' })}>{t.tier}</div>
      <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 24, color: 'var(--text-pri)', fontVariantNumeric: 'tabular-nums' }}>{aud(t.price)}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-dim)' }}>Deposit {aud(t.deposit)} · 30%</div>
      <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-sec)' }}>{t.what}</p>
    </div>
  );
}
function QuoteDetail({ q }) {
  const [sent, setSent] = useState(false);
  if (!q || !q.detail) {
    return (
      <div className="qm-dash-detail" style={{ borderLeft: '1px solid var(--ink-line)', display: 'grid', placeItems: 'center', padding: 40, minHeight: 400 }}>
        <div style={{ textAlign: 'center', maxWidth: 280 }}>
          <Icon name="file-text" size={30} color="var(--text-dim)" />
          <p style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--text-dim)' }}>Select a quote from the queue to review the Good / Better / Best options QuoteMax drafted.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="qm-dash-detail qm-scroll" style={{ borderLeft: '1px solid var(--ink-line)', overflowY: 'auto', minHeight: 0 }}>
      <div style={{ padding: '22px 24px', borderBottom: '1px solid var(--ink-line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <Eyebrow color="var(--accent)" style={{ fontSize: 10 }}>Drafted · 38s · {q.id}</Eyebrow>
            <h2 className="qm-display" style={{ margin: '8px 0 0', fontSize: 24, color: 'var(--text-pri)' }}>{q.name}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-sec)' }}>{q.job} · {q.suburb}</p>
          </div>
          <StatusPill tone="review" pulse>Review</StatusPill>
        </div>
      </div>

      <div style={{ padding: '22px 24px', borderBottom: '1px solid var(--ink-line)' }}>
        <Eyebrow style={{ fontSize: 10 }}>Options drafted from your pricing book</Eyebrow>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {TIERS.map((t) => <ReviewTier key={t.tier} t={t} />)}
        </div>
      </div>

      <div style={{ padding: '22px 24px', borderBottom: '1px solid var(--ink-line)' }}>
        <Eyebrow style={{ fontSize: 10 }}>Recommended — line items</Eyebrow>
        <div style={{ marginTop: 12, border: '1px solid var(--ink-line)' }}>
          {LINE_ITEMS.map((li, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--ink-line)' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-sec)' }}>{li.d}</span>
              <span style={mono({ fontSize: 11, color: 'var(--text-dim)' })}>{li.q} × {aud(li.rate)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5, color: 'var(--text-pri)', fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right' }}>{aud(li.q * li.rate)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: 'var(--ink)' }}>
            <span style={mono({ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' })}>Total inc GST</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{aud(1180)}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '22px 24px', borderBottom: '1px solid var(--ink-line)' }}>
        <Eyebrow style={{ fontSize: 10 }}>How QuoteMax intook the job</Eyebrow>
        <div style={{ marginTop: 12 }}><Thread messages={TRANSCRIPT} header={false} /></div>
      </div>

      <div style={{ padding: '20px 24px', position: 'sticky', bottom: 0, background: 'var(--ink-deep)', borderTop: '1px solid var(--ink-line)' }}>
        {sent ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)', background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)', color: 'var(--success-bright)', padding: '14px', ...mono({ fontSize: 12, fontWeight: 700 }) }}>
            <Icon name="check-check" size={16} /> Sent to {q.name.split(' ')[0]}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="primary" withArrow fullWidth onClick={() => setSent(true)}>Approve &amp; send</Btn>
            <Btn variant="secondary">Edit</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Quotes view (master / detail) ───────────────────────────────── */
function QuotesView() {
  const [sel, setSel] = useState('Q-1043');
  const active = QUOTES.find((q) => q.id === sel);
  return (
    <div className="qm-dash-main" style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 0.85fr) 1.15fr', minHeight: 0, flex: 1 }}>
      <div className="qm-scroll" style={{ overflowY: 'auto', borderRight: '0', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--ink-line)', position: 'sticky', top: 0, background: 'var(--ink-deep)', zIndex: 5 }}>
          <Eyebrow style={{ fontSize: 11 }}>Quote queue · {QUOTES.length}</Eyebrow>
          <span style={mono({ fontSize: 10, color: 'var(--text-dim)' })}>Newest first</span>
        </div>
        {QUOTES.map((q) => <QueueRow key={q.id} q={q} active={q.id === sel} onClick={() => setSel(q.id)} />)}
      </div>
      <QuoteDetail q={active} />
    </div>
  );
}

/* ─── Overview view ───────────────────────────────────────────────── */
function Overview() {
  return (
    <div style={{ padding: 28, display: 'grid', gap: 24 }}>
      <KpiRow />
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 24 }} className="qm-overview-grid">
        <section>
          <Eyebrow style={{ fontSize: 11 }}>Needs your review</Eyebrow>
          <div style={{ marginTop: 14, border: '1px solid var(--ink-line)' }}>
            {QUOTES.filter((q) => q.status === 'review').map((q) => (
              <div key={q.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 18px', borderBottom: '1px solid var(--ink-line)' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: 'var(--text-pri)' }}>{q.name}</div>
                  <div style={{ marginTop: 3, fontSize: 13, color: 'var(--text-sec)' }}>{q.job} · {q.suburb}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15, color: 'var(--text-pri)', fontVariantNumeric: 'tabular-nums' }}>{aud(q.value)}</span>
                  <Btn variant="secondary" size="sm">Review</Btn>
                </div>
              </div>
            ))}
            <div style={{ padding: '14px 18px', background: 'var(--ink)' }}>
              <span style={mono({ fontSize: 11, color: 'var(--text-dim)' })}>QuoteMax answered 11 messages while you were on the tools today.</span>
            </div>
          </div>
        </section>
        <section>
          <Eyebrow style={{ fontSize: 11 }}>This week</Eyebrow>
          <div style={{ marginTop: 14, display: 'grid', gap: 1, border: '1px solid var(--ink-line)', background: 'var(--ink-line)' }}>
            {ACTIVITY.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 13, padding: '15px 16px', background: 'var(--ink-card)' }}>
                <span style={{ display: 'inline-grid', placeItems: 'center', width: 30, height: 30, flexShrink: 0, border: '1px solid var(--ink-line)', color: a.tone }}><Icon name={a.icon} size={15} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--text-pri)', lineHeight: 1.4 }}>{a.text}</div>
                  <div style={mono({ marginTop: 4, fontSize: 10, color: 'var(--text-dim)' })}>{a.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─── Pricing book view ───────────────────────────────────────────── */
function PricingView() {
  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, maxWidth: '52ch', fontSize: 15, lineHeight: 1.6, color: 'var(--text-sec)' }}>Your rates, your call. QuoteMax only ever quotes from this book — nothing leaves without your prices behind it.</p>
        <Btn variant="secondary" size="md">Edit rates</Btn>
      </div>
      <div style={{ marginTop: 24, border: '1px solid var(--ink-line)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16, padding: '13px 20px', background: 'var(--ink)', borderBottom: '1px solid var(--ink-line)' }}>
          <span style={mono({ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)' })}>Service</span>
          <span style={mono({ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)' })}>Unit</span>
          <span style={mono({ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', minWidth: 90, textAlign: 'right' })}>Rate inc GST</span>
        </div>
        {RATES.map(([d, unit, rate], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 16, padding: '14px 20px', borderBottom: i < RATES.length - 1 ? '1px solid var(--ink-line)' : 0 }}>
            <span style={{ fontSize: 14, color: 'var(--text-pri)' }}>{d}</span>
            <span style={mono({ fontSize: 11, color: 'var(--text-dim)' })}>{unit}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', minWidth: 90, textAlign: 'right' }}>{aud(rate)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Services view ───────────────────────────────────────────────── */
function ServiceCard({ label, region, live, auto, visit }) {
  const [on, setOn] = useState(live);
  return (
    <div className="qm-edge-lit" style={{ background: 'var(--ink-card)', border: '1px solid var(--ink-line)', padding: 28, opacity: on ? 1 : 0.62 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 className="qm-display" style={{ margin: 0, fontSize: 24, color: 'var(--text-pri)' }}>{label}</h3>
          <span style={mono({ fontSize: 11, color: 'var(--text-dim)' })}>{region}</span>
        </div>
        <button type="button" role="switch" aria-checked={on} onClick={() => setOn((v) => !v)}
          style={{ width: 52, height: 28, border: '1px solid var(--ink-line)', background: on ? 'var(--accent)' : 'var(--ink)', cursor: 'pointer', position: 'relative', padding: 0 }}>
          <span aria-hidden="true" style={{ position: 'absolute', top: 2, left: on ? 26 : 2, width: 22, height: 22, background: on ? 'var(--accent-ink)' : 'var(--text-dim)', transition: 'left .2s var(--ease-out-expo)' }} />
        </button>
      </div>
      <div style={{ marginTop: 22 }}>
        <Eyebrow color="var(--accent)" style={{ fontSize: 10 }}>Auto-quoted</Eyebrow>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>{auto.map((a) => <Badge key={a} tone="neutral">{a}</Badge>)}</div>
      </div>
      <div style={{ marginTop: 18 }}>
        <Eyebrow style={{ fontSize: 10 }}>Books a $99 site visit</Eyebrow>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>{visit.map((a) => <Badge key={a} tone="neutral">{a}</Badge>)}</div>
      </div>
    </div>
  );
}
function ServicesView() {
  return (
    <div style={{ padding: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="qm-services-grid">
      <ServiceCard label="Electrical" region="NSW · Live" live auto={['Downlights', 'GPOs', 'Ceiling fans', 'Smoke alarms', 'Outdoor lighting']} visit={['Switchboard upgrade', 'EV charger', 'Fault finding', 'Oven / cooktop']} />
      <ServiceCard label="Plumbing" region="Add a second trade" live={false} auto={['Blocked drains', 'Hot water', 'Tap repair', 'Toilet repair']} visit={['Gas fitting', 'Burst pipe', 'Bathroom reno']} />
    </div>
  );
}

/* ─── Chats view ──────────────────────────────────────────────────── */
const CHATS = {
  'Sarah Whitlam': [...TRANSCRIPT],
  'Marco Felipe': [
    { from: 'customer', text: 'After 2 ceiling fans in the bedrooms and a few extra power points.' },
    { from: 'quotemax', text: 'How many GPOs, and are the fan points already there?' },
    { from: 'customer', text: '3 points. Fan wiring is in, just need the fans hung.' },
    { from: 'quotemax', text: "Got it. Quote's drafted — $940. Dave will send it through shortly." },
  ],
  'Colin Reedy': [
    { from: 'customer', text: 'Need some lights out the back and a weatherproof power point.' },
    { from: 'quotemax', text: 'How many lights, and is there power nearby to run off?' },
    { from: 'customer', text: '2 wall lights and 1 outdoor GPO. Power is in the shed.' },
  ],
};
function ChatsView() {
  const names = Object.keys(CHATS);
  const [sel, setSel] = useState(names[0]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 0.7fr) 1.3fr', minHeight: 0, flex: 1 }} className="qm-chats-grid">
      <div className="qm-scroll" style={{ borderRight: '1px solid var(--ink-line)', overflowY: 'auto', minHeight: 0 }}>
        {names.map((n) => {
          const last = CHATS[n][CHATS[n].length - 1];
          const active = n === sel;
          return (
            <button key={n} type="button" onClick={() => setSel(n)}
              style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 0, borderLeft: '2px solid', borderLeftColor: active ? 'var(--accent)' : 'transparent', borderBottom: '1px solid var(--ink-line)', background: active ? 'var(--ink)' : 'transparent', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <Avatar name={n} tone={active ? 'accent' : 'ink'} size={34} />
                <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 14, color: 'var(--text-pri)' }}>{n}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{last.from === 'quotemax' ? 'QuoteMax: ' : ''}{last.text}</div>
            </button>
          );
        })}
      </div>
      <div className="qm-scroll" style={{ overflowY: 'auto', padding: 24, minHeight: 0 }}>
        <Thread messages={CHATS[sel]} label={`${sel} · SMS intake`} />
      </div>
    </div>
  );
}

/* ─── Shell ───────────────────────────────────────────────────────── */
const VIEWS = {
  overview: { title: 'Overview', sub: `${BIZ.name} · ${BIZ.region}`, comp: Overview },
  quotes: { title: 'Quotes', sub: 'Review what QuoteMax drafted, then approve & send', comp: QuotesView },
  pricing: { title: 'Pricing book', sub: 'The rates every quote is built from', comp: PricingView },
  services: { title: 'Services', sub: 'What auto-quotes and what books a site visit', comp: ServicesView },
  chats: { title: 'Chats', sub: 'Every conversation QuoteMax handled for you', comp: ChatsView },
};
function Dashboard() {
  const [view, setView] = useState('quotes');
  useLucide(view);
  const V = VIEWS[view];
  const Body = V.comp;
  const flush = view === 'quotes' || view === 'chats';
  return (
    <div className="qm-dash-shell qm-grain" style={{ display: 'grid', gridTemplateColumns: '248px 1fr', height: '100%', background: 'var(--ink-deep)', color: 'var(--text-pri)' }}>
      <Sidebar view={view} setView={setView} />
      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <Topbar title={V.title} sub={V.sub} />
        {flush ? <Body /> : <div className="qm-scroll" style={{ overflowY: 'auto', flex: 1 }}><Body /></div>}
      </main>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<Dashboard />);
})();
