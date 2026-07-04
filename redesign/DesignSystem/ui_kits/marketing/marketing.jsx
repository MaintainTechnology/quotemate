/* QuoteMax — Marketing / pricing site recreation. Composes window.QMUI. */
(function () {
const { useState, useEffect, useRef } = React;
const { Logo, Eyebrow, Btn, Badge, StatusPill, Stat, Card, NumberedCard, Segmented, Marquee, Topography, Icon, useLucide } = window.QMUI;

const MAXW = 1408; // 88rem

/* ─── Theme toggle — demonstrates the warm-paper light flip ───────── */
function ThemeToggle() {
  const [theme, setTheme] = useState('dark');
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  return (
    <button type="button" aria-label="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      style={{ display: 'inline-grid', placeItems: 'center', width: 44, height: 44, border: '1px solid var(--ink-line)', background: 'transparent', color: 'var(--text-sec)', cursor: 'pointer' }}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

/* ─── Nav ─────────────────────────────────────────────────────────── */
function Nav() {
  const link = { fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500, color: 'var(--text-sec)', textDecoration: 'none' };
  return (
    <nav style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: '1px solid var(--ink-line)', background: 'color-mix(in srgb, var(--ink-deep) 85%, transparent)', backdropFilter: 'blur(12px)' }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px' }}>
        <Logo size={36} />
        <div className="qm-nav-links" style={{ display: 'flex', gap: 32 }}>
          <a href="#how" className="qm-link-underline" style={link}>How</a>
          <a href="#trades" className="qm-link-underline" style={link}>Trades</a>
          <a href="#pricing" className="qm-link-underline" style={link}>Pricing</a>
          <a href="#faq" className="qm-link-underline" style={link}>FAQ</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ThemeToggle />
          <Btn variant="ghost" size="sm" href="#">Sign in</Btn>
          <Btn variant="primary" size="sm" withArrow href="#pricing">Get started</Btn>
        </div>
      </div>
    </nav>
  );
}

/* ─── Animated SMS demo ───────────────────────────────────────────── */
const DEMO = [
  { from: 'customer', text: "Hey mate, need 6 downlights in the lounge. What's it cost?", at: 500 },
  { from: 'quotemax', text: 'All new fittings, or swapping existing? And is there roof-space access?', at: 1300 },
  { from: 'customer', text: 'All new. Roof access is easy.', at: 2200 },
];
function AnimatedSms() {
  const [step, setStep] = useState(0);     // messages revealed
  const [typing, setTyping] = useState(false);
  const [quote, setQuote] = useState(false);
  useEffect(() => {
    const timers = [];
    DEMO.forEach((m, i) => timers.push(setTimeout(() => setStep(i + 1), m.at)));
    timers.push(setTimeout(() => setTyping(true), 2900));
    timers.push(setTimeout(() => { setTyping(false); setQuote(true); }, 4200));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className="qm-edge-lit" style={{ border: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--ink-line)', padding: '12px 16px' }}>
        <Eyebrow style={{ fontSize: 10, letterSpacing: '0.16em' }}>Live example · SMS intake</Eyebrow>
        <StatusPill tone="live" pulse>Online</StatusPill>
      </div>
      <div style={{ display: 'grid', gap: 12, padding: '20px 16px', minHeight: 220 }}>
        {DEMO.slice(0, step).map((m, i) => <Bubble key={i} {...m} />)}
        {typing ? <Typing /> : null}
      </div>
      {quote ? (
        <div style={{ borderTop: '1px solid var(--ink-line)', background: 'color-mix(in srgb, var(--ink-deep) 50%, transparent)', padding: 16, animation: 'qm-rise 640ms var(--ease-out-expo) both' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Eyebrow color="var(--accent)" style={{ fontSize: 10, letterSpacing: '0.16em' }}>Quote drafted · under a minute</Eyebrow>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>Sample</span>
          </div>
          <div style={{ marginTop: 12, position: 'relative', border: '1px solid var(--ink-line)', background: 'var(--ink-card)', padding: 16, textAlign: 'center' }}>
            <span aria-hidden="true" style={{ position: 'absolute', insetInline: 0, top: 0, height: 2, background: 'var(--accent)' }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 22, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>$890</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
function Bubble({ from, text }) {
  const inbound = from === 'customer';
  return (
    <div style={{ display: 'flex', justifyContent: inbound ? 'flex-start' : 'flex-end', animation: 'qm-pop-in 420ms var(--ease-out-expo) both' }}>
      <div style={{ maxWidth: '86%', border: '1px solid', borderColor: inbound ? 'var(--ink-line)' : 'color-mix(in srgb, var(--accent) 35%, transparent)', background: inbound ? 'var(--ink-deep)' : 'color-mix(in srgb, var(--accent) 10%, transparent)', color: inbound ? 'var(--text-sec)' : 'var(--text-pri)', padding: '10px 14px', fontSize: 14, lineHeight: 1.45 }}>
        {!inbound ? <span style={{ display: 'block', marginBottom: 4, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>QuoteMax</span> : null}
        {text}
      </div>
    </div>
  );
}
function Typing() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', animation: 'qm-pop-in 420ms var(--ease-out-expo) both' }}>
      <div role="status" aria-label="QuoteMax is drafting" style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', padding: '12px 14px' }}>
        {[0, 1, 2].map((d) => <span key={d} aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: 'var(--accent-soft)', animation: 'qm-typing-bounce 1.3s ease-in-out infinite', animationDelay: `${d * 160}ms` }} />)}
      </div>
    </div>
  );
}

/* ─── Hero ────────────────────────────────────────────────────────── */
function HeroTile({ src, caption }) {
  return (
    <figure className="qm-duotone qm-edge-lit" style={{ margin: 0, position: 'relative', border: '1px solid var(--ink-line)', aspectRatio: '4/5' }}>
      <img className="qm-duotone__img" src={src} alt={caption} />
      <figcaption className="qm-photo-caption" style={{ position: 'absolute', insetInline: 0, bottom: 0, padding: '24px 10px 8px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em' }}>{caption}</figcaption>
    </figure>
  );
}
function Hero() {
  const flag = <img src="../../assets/icons/au-flag.svg" alt="Australia" style={{ height: 13, border: '1px solid color-mix(in srgb, var(--text-pri) 15%, transparent)', display: 'block' }} />;
  return (
    <section style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--ink-line)' }}>
      <Topography />
      <div className="qm-hero-grid" style={{ position: 'relative', zIndex: 1, maxWidth: MAXW, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', alignItems: 'center', gap: 64, padding: '80px 24px' }}>
        <div>
          <div style={{ marginBottom: 20 }}><Badge icon={flag}>Built for Australian tradies</Badge></div>
          <Eyebrow>QuoteMax · We do the quoting for you</Eyebrow>
          <h1 className="qm-display" style={{ margin: '20px 0 0', fontSize: 'var(--display-hero)', color: 'var(--text-pri)' }}>
            Drafts your <span style={{ color: 'var(--text-accent)' }}>quote</span><br />before they <span style={{ color: 'var(--text-accent)' }}>hang up.</span>
          </h1>
          <p style={{ margin: '28px 0 0', maxWidth: '34ch', fontSize: 18, lineHeight: 1.6, color: 'var(--text-sec)' }}>
            Customers text your QuoteMax number. QuoteMax asks the right questions, applies your pricing book, and drafts a clean quote in under a minute. You review, tweak, send.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 36 }}>
            <Btn variant="primary" size="lg" withArrow href="#pricing">Get my QuoteMax</Btn>
            <Btn variant="secondary" size="lg" href="#how">See how it works</Btn>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 40 }}>
            <HeroTile src="../../assets/photos/trade-electrical.jpg" caption="Electrical" />
            <HeroTile src="../../assets/photos/trade-plumbing.jpg" caption="Plumbing" />
            <HeroTile src="../../assets/photos/trade-solar.jpg" caption="Solar" />
          </div>
        </div>
        <div><AnimatedSms /></div>
      </div>
    </section>
  );
}

/* ─── Trust strip + powered-by ────────────────────────────────────── */
function TrustStrip() {
  return (
    <section style={{ borderBottom: '1px solid var(--ink-line)', background: 'color-mix(in srgb, var(--ink) 40%, transparent)' }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: '28px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Badge>Built in Australia</Badge>
          <Badge>Electrical pilot · NSW</Badge>
          <Badge>Plumbing pilot · QLD</Badge>
          <Badge>Free trial · Starter Monthly</Badge>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>Runs on Twilio</span>
      </div>
    </section>
  );
}
const PARTNERS = ['anthropic', 'gemini', 'twilio', 'deepgram', 'vapi', 'voyage'];
function PoweredBy() {
  return (
    <section style={{ borderBottom: '1px solid var(--ink-line)' }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '56px 24px' }}>
        <p style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.24em', color: 'var(--text-dim)', margin: 0 }}>Powered by</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '28px 56px', marginTop: 32 }}>
          {PARTNERS.map((p) => (
            <img key={p} src={`../../assets/partners/${p}.svg`} alt={p} className="qm-partner" style={{ height: 30, width: 'auto' }} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How it works ────────────────────────────────────────────────── */
function HowItWorks() {
  return (
    <section id="how" style={{ borderBottom: '1px solid var(--ink-line)', scrollMarginTop: 80 }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '120px 24px' }}>
        <div style={{ maxWidth: '48rem' }}>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="qm-display" style={{ margin: '12px 0 0', fontSize: 'var(--display-section)', lineHeight: 1, color: 'var(--text-pri)' }}>
            Three steps. <span style={{ color: 'var(--text-accent)' }}>You stay on the tools.</span>
          </h2>
        </div>
        <div className="qm-how-grid" style={{ marginTop: 56, display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 56, alignItems: 'start' }}>
          <div style={{ position: 'relative', display: 'grid', gap: 16 }}>
            <div className="qm-spine" style={{ position: 'absolute', left: 34, top: 40, bottom: 40, width: 1, background: 'linear-gradient(180deg, var(--accent) 0%, var(--ink-line) 72%, transparent 100%)' }} aria-hidden="true" />
            <NumberedCard num="01" title="Customer texts your number" body="Each tradie gets a dedicated AU number. Voice or SMS, both feed QuoteMax while you stay on the tools." />
            <NumberedCard num="02" title="QuoteMax drafts the quote" body="QuoteMax asks the right questions for the job type, applies your pricing book, and writes the line items in under a minute." />
            <NumberedCard num="03" title="You review, send, get paid" body="The quote lands in your dashboard. Approve as-is or tweak it. The customer pays a deposit and the job is booked." />
          </div>
          <figure className="qm-duotone qm-edge-lit qm-how-photo" style={{ margin: 0, position: 'relative', border: '1px solid var(--ink-line)', aspectRatio: '3/4' }}>
            <img className="qm-duotone__img" src="../../assets/photos/trade-carpentry.jpg" alt="Tradesperson at a workshop bench" style={{ objectPosition: 'center 30%' }} />
            <figcaption className="qm-photo-caption" style={{ position: 'absolute', insetInline: 0, bottom: 0, padding: '48px 20px 20px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em' }}>You stay on the tools</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

/* ─── Trades ──────────────────────────────────────────────────────── */
function TradePanel({ label, state, src, auto, inspection }) {
  return (
    <Card padding={0} interactive sweep style={{ overflow: 'hidden' }}>
      <div style={{ position: 'relative' }}>
        <figure className="qm-duotone" style={{ margin: 0, aspectRatio: '16/9', borderBottom: '1px solid var(--ink-line)' }}>
          <img className="qm-duotone__img" src={src} alt={label} style={{ objectPosition: 'center 28%' }} />
        </figure>
        <div className="qm-photo-caption" style={{ position: 'absolute', insetInline: 0, bottom: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, padding: '48px 24px 20px' }}>
          <h3 className="qm-display" style={{ margin: 0, fontSize: 30 }}>{label}</h3>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.9)', paddingBottom: 4 }}>{state}</span>
        </div>
      </div>
      <div style={{ padding: 32 }}>
        <Eyebrow color="var(--accent)" style={{ fontSize: 11, letterSpacing: '0.16em' }}>Auto-quoted</Eyebrow>
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 8 }}>
          {auto.map((it) => <li key={it} style={{ display: 'flex', gap: 12, fontSize: 15, color: 'var(--text-sec)' }}><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }} aria-hidden="true">→</span>{it}</li>)}
        </ul>
        <div style={{ marginTop: 28, borderTop: '1px solid var(--ink-line)', paddingTop: 28 }}>
          <Eyebrow style={{ fontSize: 11, letterSpacing: '0.16em' }}>$99 site visit</Eyebrow>
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 8 }}>
            {inspection.map((it) => <li key={it} style={{ display: 'flex', gap: 12, fontSize: 15, color: 'var(--text-sec)' }}><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }} aria-hidden="true">○</span>{it}</li>)}
          </ul>
        </div>
      </div>
    </Card>
  );
}
function Trades() {
  return (
    <section id="trades" style={{ borderBottom: '1px solid var(--ink-line)', scrollMarginTop: 80 }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '120px 24px' }}>
        <h2 className="qm-display" style={{ margin: 0, maxWidth: '52rem', fontSize: 'var(--display-section)', lineHeight: 1, color: 'var(--text-pri)' }}>
          Straightforward jobs <span style={{ color: 'var(--text-accent)' }}>auto-quote</span>.<br />The tricky ones book a site visit.
        </h2>
        <div className="qm-trades-grid" style={{ marginTop: 56, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <TradePanel label="Electrical" state="NSW · Pilot" src="../../assets/photos/trade-electrical.jpg"
            auto={['Downlights', 'Power points (GPOs)', 'Ceiling fans', 'Smoke alarms', 'Outdoor lighting']}
            inspection={['Switchboard upgrade', 'EV charger', 'Fault finding', 'Oven / cooktop']} />
          <TradePanel label="Plumbing" state="QLD · Pilot" src="../../assets/photos/trade-plumbing.jpg"
            auto={['Blocked drains', 'Hot water replacement', 'Tap repair', 'Tap replacement', 'Toilet repair']}
            inspection={['Gas fitting', 'Burst pipe', 'Bathroom renovation']} />
        </div>
        <div style={{ marginTop: 32 }}>
          <Eyebrow style={{ fontSize: 11, letterSpacing: '0.16em' }}>Next in line</Eyebrow>
          <div className="qm-upcoming" style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
            {[['Roofing', 'trade-roofing'], ['Solar', 'trade-solar'], ['Painting', 'trade-painting']].map(([label, img]) => (
              <figure key={label} className="qm-duotone qm-edge-lit" style={{ margin: 0, position: 'relative', border: '1px solid var(--ink-line)', aspectRatio: '4/3' }}>
                <img className="qm-duotone__img" src={`../../assets/photos/${img}.jpg`} alt={label} />
                <figcaption className="qm-photo-caption" style={{ position: 'absolute', insetInline: 0, bottom: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '40px 16px 14px' }}>
                  <span className="qm-display" style={{ fontSize: 18 }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'rgba(255,255,255,0.9)' }}>Coming soon</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── The shift ───────────────────────────────────────────────────── */
function Shift() {
  const rows = [
    ['Misses the call while you\u2019re up a ladder', 'Answers every text and call the second it lands'],
    ['Quotes typed up at 11pm, after dinner', 'A clean quote drafted in under a minute'],
    ['Job goes to whoever\u2019s free to reply', 'A clean quote in their hand while you\u2019re still on the job'],
  ];
  return (
    <section style={{ borderBottom: '1px solid var(--ink-line)' }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '120px 24px' }}>
        <h2 className="qm-display" style={{ margin: 0, maxWidth: '52rem', fontSize: 'var(--display-section)', lineHeight: 1, color: 'var(--text-pri)' }}>
          The job goes to whoever quotes first. <span style={{ color: 'var(--text-accent)' }}>Now that\u2019s you.</span>
        </h2>
        <div style={{ marginTop: 56, display: 'grid', gap: 1, border: '1px solid var(--ink-line)', background: 'var(--ink-line)' }}>
          <div className="qm-shift-head" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24, background: 'var(--ink-deep)', padding: '16px 24px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--text-dim)' }}>The usual</span>
            <span aria-hidden="true" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>With QuoteMax</span>
          </div>
          {rows.map(([a, b], i) => (
            <div key={i} className="qm-shift-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24, background: 'var(--ink-card)', padding: '24px' }}>
              <p style={{ margin: 0, fontSize: 17, color: 'var(--text-dim)', textDecoration: 'line-through', textDecorationColor: 'color-mix(in srgb, var(--text-dim) 40%, transparent)' }}>{a}</p>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }} aria-hidden="true">→</span>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 500, color: 'var(--text-pri)' }}>{b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Numbers ─────────────────────────────────────────────────────── */
function Numbers() {
  return (
    <section style={{ borderBottom: '1px solid var(--ink-line)' }}>
      <div className="qm-numbers" style={{ maxWidth: MAXW, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '48px 24px', padding: '80px 24px' }}>
        <Stat value="< 1 min" label="Per quote drafted" />
        <Stat value="24/7" label="Line always answered" />
        <Stat value="$0" label="Cut of your jobs" />
        <Stat value="$99" label="Locked site-visit price" />
      </div>
    </section>
  );
}

/* ─── Pricing ─────────────────────────────────────────────────────── */
const PLANS = [
  { id: 'starter', name: 'Starter', tagline: 'Sole trader · SMS receptionist', monthly: 49, annual: 490, highlights: ['SMS & WhatsApp receptionist', '~40 quotes a month', 'Clean quotes + deposits collected', '1 trade · 1 dedicated AU number'] },
  { id: 'pro', name: 'Pro', tagline: 'Busy sole trader / small crew', monthly: 129, annual: 1290, featured: true, inheritsFrom: 'Starter', highlights: ['Voice receptionist — 300 mins / mo', '~150 quotes a month', 'Up to 2 trades · 2 dashboard seats', 'Your branding + 1 specialised estimator'] },
  { id: 'crew', name: 'Crew', tagline: 'Multi-trade teams', monthly: 299, annual: 2990, inheritsFrom: 'Pro', highlights: ['Voice receptionist — 1,000 mins / mo', '~400 quotes a month', 'Up to 4 trades · 5 seats · 3 numbers', 'All estimators, custom domain & priority support'] },
];
const aud = (n) => '$' + n.toLocaleString('en-AU');
function PlanCard({ plan, annual }) {
  const perMonth = annual ? Math.round(plan.annual / 12) : plan.monthly;
  const saving = plan.monthly * 12 - plan.annual;
  return (
    <Card accentTop={plan.featured} sweep padding={32} style={{ display: 'flex', flexDirection: 'column', borderColor: plan.featured ? 'color-mix(in srgb, var(--accent) 50%, var(--ink-line))' : 'var(--ink-line)' }}>
      {plan.featured ? <span style={{ position: 'absolute', right: 20, top: 20, background: 'var(--accent)', color: 'var(--accent-ink)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '5px 10px' }}>Most popular</span> : null}
      <h3 className="qm-display" style={{ margin: 0, fontSize: 24, color: 'var(--text-pri)' }}>{plan.name}</h3>
      <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-mono)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>{plan.tagline}</p>
      <div style={{ marginTop: 24, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 48, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: plan.featured ? 'var(--accent)' : 'var(--text-pri)' }}>{aud(perMonth)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>/ mo</span>
      </div>
      <p style={{ margin: '8px 0 0', minHeight: 20, fontSize: 14, color: 'var(--text-sec)' }}>
        {annual ? <>Billed {aud(plan.annual)}/yr · <span style={{ color: 'var(--accent)' }}>save {aud(saving)}</span></> : <>Billed monthly · or {aud(plan.annual)}/yr</>}
      </p>
      <div style={{ marginTop: 28 }}><Btn variant={plan.featured ? 'primary' : 'secondary'} fullWidth href="#">{plan.id === 'starter' ? 'Start free trial' : 'Get started'}</Btn></div>
      {plan.inheritsFrom ? <p style={{ margin: '28px 0 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)' }}>Everything in {plan.inheritsFrom}, plus:</p> : null}
      <ul style={{ listStyle: 'none', margin: plan.inheritsFrom ? '12px 0 0' : '28px 0 0', padding: 0, display: 'grid', gap: 10 }}>
        {plan.highlights.map((h) => <li key={h} style={{ display: 'flex', gap: 12, fontSize: 14, lineHeight: 1.5, color: 'var(--text-sec)' }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }} aria-hidden="true">→</span>{h}</li>)}
      </ul>
    </Card>
  );
}
function Pricing() {
  const [annual, setAnnual] = useState(true);
  return (
    <section id="pricing" style={{ borderBottom: '1px solid var(--ink-line)', scrollMarginTop: 80 }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '120px 24px' }}>
        <div style={{ maxWidth: '48rem' }}>
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="qm-display" style={{ margin: '12px 0 0', fontSize: 'var(--display-sub)', lineHeight: 1.05, color: 'var(--text-pri)' }}>Costs less than <span style={{ color: 'var(--text-accent)' }}>one missed job.</span></h2>
          <p style={{ margin: '24px 0 0', maxWidth: '46rem', fontSize: 18, lineHeight: 1.6, color: 'var(--text-sec)' }}>Pick a plan and QuoteMax is quoting the same day. Starter Monthly comes with a 14-day free trial. We never take a cut of your jobs.</p>
        </div>
        <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Segmented ariaLabel="Billing period" value={annual ? 'annual' : 'monthly'} onChange={(v) => setAnnual(v === 'annual')} options={[{ label: 'Monthly', value: 'monthly' }, { label: 'Annual', value: 'annual' }]} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--accent)' }}>Save ~17% — 2 months free</span>
        </div>
        <div className="qm-plans" style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {PLANS.map((p) => <PlanCard key={p.id} plan={p} annual={annual} />)}
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ ─────────────────────────────────────────────────────────── */
const FAQ = [
  ['Do I lose control of my pricing?', 'No. QuoteMax only ever uses your pricing book. Every quote lands in your dashboard for you to approve or tweak before it goes out.'],
  ['What about complex jobs?', 'Anything non-standard books a $99 site visit instead of auto-quoting. You quote those the way you always have, with the deposit already paid.'],
  ['Whose number is it?', 'Yours. Each tradie gets a dedicated Australian number. Customers text or call it; you stay on the tools.'],
  ['Which trades are live?', 'Electrical in NSW and plumbing in QLD are piloting now. More trades are being onboarded, so tell us yours.'],
];
function Faq() {
  return (
    <section id="faq" style={{ borderBottom: '1px solid var(--ink-line)', scrollMarginTop: 80 }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '120px 24px' }}>
        <div style={{ maxWidth: '48rem' }}>
          <Eyebrow>Good questions</Eyebrow>
          <h2 className="qm-display" style={{ margin: '12px 0 0', fontSize: 'var(--display-section)', lineHeight: 1, color: 'var(--text-pri)' }}>The stuff tradies <span style={{ color: 'var(--text-accent)' }}>actually</span> ask.</h2>
        </div>
        <dl className="qm-faq" style={{ marginTop: 56, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px 48px', margin: '56px 0 0' }}>
          {FAQ.map(([q, a]) => (
            <div key={q} style={{ borderTop: '1px solid var(--ink-line)', paddingTop: 24 }}>
              <dt className="qm-display" style={{ fontSize: 18, color: 'var(--text-pri)' }}>{q}</dt>
              <dd style={{ margin: '12px 0 0', maxWidth: '46ch', fontSize: 15, lineHeight: 1.6, color: 'var(--text-sec)' }}>{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ─── Closing CTA + footer + marquee ──────────────────────────────── */
function ClosingCta() {
  return (
    <section style={{ borderBottom: '1px solid var(--ink-line)' }}>
      <div style={{ maxWidth: '56rem', margin: '0 auto', padding: '112px 24px' }}>
        <h2 className="qm-display" style={{ margin: 0, fontSize: 'var(--display-sub)', lineHeight: 1.05, color: 'var(--text-pri)' }}><span style={{ color: 'var(--text-accent)' }}>Both pilots</span> are live.<br />Your turn is next.</h2>
        <p style={{ margin: '24px 0 0', maxWidth: '46rem', fontSize: 18, lineHeight: 1.6, color: 'var(--text-sec)' }}>Each tradie gets their own number, pricing book, and QuoteMax tuned to their brand voice. Setup takes about three minutes.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 40 }}>
          <Btn variant="primary" size="lg" withArrow href="#pricing">Get my QuoteMax</Btn>
          <Btn variant="secondary" size="lg" href="#how">See how it works</Btn>
        </div>
      </div>
    </section>
  );
}
function Footer() {
  const cols = [
    ['Product', ['How it works', 'Pricing', 'FAQ']],
    ['Trades', ['Electrical', 'Plumbing', 'Roofing', 'Solar', 'Painting']],
    ['Account', ['Sign in', 'Get started']],
    ['Legal', ['Privacy policy', 'Terms & conditions', 'Cookie policy']],
  ];
  return (
    <footer>
      <div className="qm-footer-grid" style={{ maxWidth: MAXW, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr', gap: 40, padding: '64px 24px' }}>
        <div>
          <Logo size={36} />
          <p style={{ margin: '16px 0 0', maxWidth: '24ch', fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)' }}>QuoteMax drafts clean quotes for Australian electricians and plumbers.</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--text-dim)' }}>{title}</span>
            <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 10 }}>
              {links.map((l) => <li key={l}><a href="#" className="qm-link-underline" style={{ fontSize: 14, color: 'var(--text-sec)', textDecoration: 'none' }}>{l}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--ink-line)' }}>
        <div style={{ maxWidth: MAXW, margin: '0 auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, padding: '20px 24px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>© 2026 QuoteMax</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>Electrical NSW · Plumbing QLD</span>
        </div>
      </div>
    </footer>
  );
}

function MarketingPage() {
  useLucide();
  return (
    <div id="top" className="qm-marketing-canvas qm-grain" style={{ minHeight: '100vh' }}>
      <Nav />
      <Hero />
      <TrustStrip />
      <PoweredBy />
      <HowItWorks />
      <Trades />
      <Shift />
      <Numbers />
      <Pricing />
      <Faq />
      <ClosingCta />
      <Footer />
      <Marquee items={['QuoteMax', 'Built in Australia', 'For tradies, by tradies', 'Quote drafted in under a minute', 'Electrical NSW', 'Plumbing QLD']} />
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<MarketingPage />);
})();
