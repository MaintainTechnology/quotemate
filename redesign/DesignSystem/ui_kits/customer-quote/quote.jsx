/* QuoteMax — Customer quote page. What the customer taps from the SMS link.
   Mobile-first; per-tier deposits lock the booking. Composes window.QMUI. */
(function () {
const { useState } = React;
const { Eyebrow, Btn, Badge, StatusPill, TierCard, Marquee, Topography, Icon, useLucide, aud } = window.QMUI;

/* ─── Quote data (consistent with the dashboard & SMS demo) ───────── */
const BIZ = { name: 'Hartley Electrical', owner: 'Dave Hartley', licence: 'NSW EC 89421', abn: '54 219 887 663', number: '0480 102 030' };
const QUOTE = { id: 'QM-1043', customer: 'Sarah', suburb: 'Ashfield', issued: '28 Jun 2026', valid: '12 Jul 2026' };

const TIERS = [
  { tier: 'Good', price: 890, deposit: 267, blurb: 'A tidy like-for-like. Does the job, nothing fancy.',
    items: ['6× dimmable LED downlights, warm white', 'Reuse existing wiring & switch', '12-month workmanship warranty'] },
  { tier: 'Better', price: 1180, deposit: 354, recommended: true, blurb: 'What most lounges get. Set the white to suit the room.',
    items: ['6× CCT-selectable downlights (warm→cool)', 'New LED-rated dimmer fitted', '5-year warranty · neat cut-ins'] },
  { tier: 'Best', price: 1540, deposit: 462, blurb: 'Smart control, scenes, and the longest cover.',
    items: ['6× smart app-controlled downlights', 'Individual dimming & lighting scenes', '7-year warranty · priority callback'] },
];

const SCOPE = [
  { n: '01', title: "The job", body: 'Supply and install 6 LED downlights in the lounge ceiling — evenly set out and run off your existing wall switch.' },
  { n: '02', title: 'Included on every option', list: ['Set-out & marking to suit the room', 'Make good around each cut-in', 'Test and a Certificate of Compliance (CCEW)', 'All offcuts and packaging taken away'] },
  { n: '03', title: 'Timing & access', body: "About half a day on site. We'll need roof-space access and the lighting circuit off for roughly an hour. We'll lock in a time that suits once the deposit's in." },
];

const ASSUMPTIONS = [
  'Existing ceiling wiring is sound and to standard',
  'Clear roof-space access — no full insulation removal',
  'No asbestos present in the ceiling',
  'Ceiling patching or painting is not included',
];

const mono = (extra = {}) => ({ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.14em', ...extra });

/* ─── Letterhead ──────────────────────────────────────────────────── */
function Letterhead() {
  return (
    <header style={{ borderBottom: '1px solid var(--ink-line)', padding: '20px 22px', background: 'var(--ink-card)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-grid', placeItems: 'center', width: 42, height: 42, background: 'var(--accent)', color: 'var(--accent-ink)' }}>
            <Icon name="zap" size={22} />
          </span>
          <div>
            <div className="qm-display" style={{ fontSize: 19, color: 'var(--text-pri)', lineHeight: 1 }}>{BIZ.name}</div>
            <div style={mono({ marginTop: 5, fontSize: 9.5, color: 'var(--text-dim)' })}>Licensed electrician · {BIZ.licence}</div>
          </div>
        </div>
        <a href={`tel:${BIZ.number.replace(/\s/g, '')}`} aria-label="Call" style={{ display: 'inline-grid', placeItems: 'center', width: 40, height: 40, border: '1px solid var(--ink-line)', color: 'var(--text-sec)', textDecoration: 'none', flexShrink: 0 }}>
          <Icon name="phone" size={17} />
        </a>
      </div>
    </header>
  );
}

/* ─── Quote header ────────────────────────────────────────────────── */
function QuoteHead() {
  return (
    <section style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--ink-line)', background: 'var(--ink-deep)' }}>
      <Topography opacity={0.14} />
      <div style={{ position: 'relative', zIndex: 1, padding: '28px 22px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Eyebrow color="var(--accent)" style={{ fontSize: 10 }}>Quote {QUOTE.id}</Eyebrow>
          <StatusPill tone="review">Awaiting you</StatusPill>
        </div>
        <h1 className="qm-display" style={{ margin: '16px 0 0', fontSize: 34, lineHeight: 0.98, color: 'var(--text-pri)' }}>
          6 downlights,<br /><span style={{ color: 'var(--text-accent)' }}>lounge.</span>
        </h1>
        <p style={{ margin: '18px 0 0', fontSize: 15.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
          G'day {QUOTE.customer} — here's three ways we can do it. Pick what suits and pay the deposit to lock it in. No deposit, no obligation.
        </p>
        <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Badge>Issued {QUOTE.issued}</Badge>
          <Badge>Valid until {QUOTE.valid}</Badge>
        </div>
      </div>
    </section>
  );
}

/* ─── Scope of works ──────────────────────────────────────────────── */
function NumberedSection({ n, title, body, list }) {
  return (
    <div style={{ display: 'flex', gap: 18, padding: '22px 0', borderTop: '1px solid var(--ink-line)' }}>
      <span aria-hidden="true" style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 30, lineHeight: 0.85, color: 'var(--accent)' }}>{n}</span>
      <div style={{ minWidth: 0 }}>
        <h3 className="qm-display" style={{ margin: 0, fontSize: 16, color: 'var(--text-pri)' }}>{title}</h3>
        {body ? <p style={{ margin: '9px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>{body}</p> : null}
        {list ? (
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 9 }}>
            {list.map((it) => (
              <li key={it} style={{ display: 'flex', gap: 11, fontSize: 14, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                <Icon name="check" size={15} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />{it}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
function Scope() {
  return (
    <section style={{ padding: '8px 22px 22px' }}>
      <Eyebrow style={{ fontSize: 10 }}>Scope of works</Eyebrow>
      <div style={{ marginTop: 6 }}>
        {SCOPE.map((s) => <NumberedSection key={s.n} {...s} />)}
      </div>
    </section>
  );
}

/* ─── Tiers ───────────────────────────────────────────────────────── */
function TierList() {
  const [paid, setPaid] = useState(null); // tier name once a deposit is paid
  return (
    <section id="options" style={{ padding: '26px 22px', borderTop: '1px solid var(--ink-line)', background: 'var(--ink-deep)' }}>
      <Eyebrow color="var(--accent)" style={{ fontSize: 10 }}>Choose your option</Eyebrow>
      <h2 className="qm-display" style={{ margin: '10px 0 0', fontSize: 22, color: 'var(--text-pri)' }}>Good · Better · Best</h2>
      <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-dim)' }}>All prices include GST. Deposit is 30% and comes off the final invoice.</p>
      <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
        {TIERS.map((t) => (
          <TierCard key={t.tier} tier={t.tier} blurb={t.blurb} priceIncGst={t.price} depositAmount={t.deposit} depositPct={30}
            recommended={t.recommended} paid={paid === t.tier} disabled={paid && paid !== t.tier}
            ctaLabel={`Pay ${aud(t.deposit)} deposit`} onPay={(e) => { e.preventDefault(); setPaid(t.tier); }}>
            <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 9 }}>
              {t.items.map((it) => (
                <li key={it} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.4, color: 'var(--text-sec)' }}>
                  <Icon name="check" size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />{it}
                </li>
              ))}
            </ul>
          </TierCard>
        ))}
      </div>
      {paid ? (
        <div role="status" style={{ marginTop: 18, display: 'flex', gap: 12, alignItems: 'flex-start', border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)', background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)', padding: '16px 18px' }}>
          <Icon name="check-check" size={18} color="var(--success-bright)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={mono({ fontSize: 11, fontWeight: 700, color: 'var(--success-bright)' })}>{TIERS.find((t) => t.tier === paid).tier} option booked</div>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-sec)' }}>Nice one, {QUOTE.customer}. {BIZ.owner} will text to lock in a time. Your receipt is on its way.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ─── Assumptions / the honest bit ────────────────────────────────── */
function Assumptions() {
  return (
    <section style={{ padding: '24px 22px', borderTop: '1px solid var(--ink-line)' }}>
      <Eyebrow style={{ fontSize: 10 }}>Good to know</Eyebrow>
      <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 11 }}>
        {ASSUMPTIONS.map((a) => (
          <li key={a} style={{ display: 'flex', gap: 11, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>
            <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0 }}>○</span>{a}
          </li>
        ))}
      </ul>
      <p style={{ margin: '16px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)' }}>
        Anything unexpected behind the plaster, we'll stop and talk it through before doing more — never a surprise on the invoice.
      </p>
    </section>
  );
}

/* ─── Compliance footer ───────────────────────────────────────────── */
function Footer() {
  const rows = [
    ['Licensed contractor', `${BIZ.name} · ${BIZ.licence}`],
    ['ABN', BIZ.abn],
    ['Insurance', 'Public liability to $20m'],
    ['Terms', 'GST included · deposit refundable to 48 hrs before booking'],
  ];
  return (
    <footer style={{ padding: '24px 22px 30px', borderTop: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
      <div style={{ display: 'grid', gap: 1, border: '1px solid var(--ink-line)', background: 'var(--ink-line)' }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12, padding: '11px 14px', background: 'var(--ink-card)' }}>
            <span style={mono({ fontSize: 9.5, color: 'var(--text-dim)' })}>{k}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.4 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={mono({ fontSize: 9.5, color: 'var(--text-dim)' })}>Quote prepared by</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <img src="../../assets/logos/quotemax-mark.svg" width={18} height={18} alt="" style={{ display: 'block' }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: '-0.01em', color: 'var(--text-sec)' }}>QuoteMax</span>
        </span>
      </div>
    </footer>
  );
}

/* ─── Page ────────────────────────────────────────────────────────── */
function QuotePage() {
  useLucide();
  return (
    <div className="qm-q-page qm-grain">
      <Letterhead />
      <QuoteHead />
      <Scope />
      <TierList />
      <Assumptions />
      <Footer />
      <Marquee items={['Pick a tier', 'Pay the deposit', "We'll book it in", 'CCEW supplied', 'Licensed & insured']} fontSize={14} speed={30} />
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<QuotePage />);
})();
