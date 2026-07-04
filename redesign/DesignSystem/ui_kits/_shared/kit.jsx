/* ════════════════════════════════════════════════════════════════════
   QuoteMax UI-kit primitives (shared by all three kits).
   These mirror the bundled design-system components (components/*) one-to-one
   but are inline-styled so each kit previews + runs standalone. Styling is
   driven entirely by the design tokens in styles.css. Exposed on window.QMUI.
   ════════════════════════════════════════════════════════════════════ */
const { useState, useEffect } = React;

/* ─── Lucide icon — rendered as a React-OWNED inline <svg> ─────────────
   We read the icon's node data from window.lucide.icons and build the SVG
   in React. We deliberately do NOT use lucide.createIcons(): that mutates
   the DOM (swaps <i> for <svg>) behind React's back, which breaks
   reconciliation the moment any ancestor re-renders (nav clicks, toggles).
   React owning the SVG keeps re-renders safe. */
function camelKey(k) { return k.indexOf('-') === -1 ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function pascal(name) { return String(name).split(/[-_]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(''); }
function Icon({ name, size = 18, color, strokeWidth = 1.75, style = {}, ...rest }) {
  const lib = (window.lucide && window.lucide.icons) || {};
  const node = lib[pascal(name)] || lib[name];
  const base = { display: 'inline-flex', flexShrink: 0, verticalAlign: 'middle', ...style };
  if (!node) return <span aria-hidden="true" style={{ width: size, height: size, ...base }} {...rest} />;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={base} {...rest}>
      {node.map((child, i) => {
        const attrs = child[1] || {};
        const out = { key: i };
        for (const k in attrs) out[camelKey(k)] = attrs[k];
        return React.createElement(child[0], out);
      })}
    </svg>
  );
}
// No-op kept for API compatibility — icons are React-owned now, nothing to do.
function useLucide() {}

/* ─── Brand mark + wordmark ───────────────────────────────────────── */
function Logo({ size = 36, word = true, sub }) {
  return (
    <a href="#top" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
      <img src="../../assets/logos/quotemax-mark.svg" width={size} height={size} alt="QuoteMax" style={{ display: 'block' }} />
      {word ? (
        <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.02em', color: 'var(--text-pri)', fontSize: size * 0.46 }}>
          QuoteMax
        </span>
      ) : null}
      {sub ? (
        <>
          <span style={{ color: 'var(--text-dim)' }}>/</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-sec)' }}>{sub}</span>
        </>
      ) : null}
    </a>
  );
}

/* ─── Eyebrow ─────────────────────────────────────────────────────── */
function Eyebrow({ children, color = 'var(--text-dim)', style = {} }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.18em', color, ...style }}>
      {children}
    </span>
  );
}

/* ─── Button ──────────────────────────────────────────────────────── */
function Btn({ children, variant = 'primary', size = 'md', href, onClick, withArrow, fullWidth, disabled, type = 'button', style = {} }) {
  const [h, setH] = useState(false);
  const sizes = {
    sm: { padding: '8px 16px', fontSize: 11, minHeight: 36 },
    md: { padding: '13px 26px', fontSize: 13, minHeight: 44 },
    lg: { padding: '17px 30px', fontSize: 14, minHeight: 56 },
  };
  const variants = {
    primary: { background: h && !disabled ? 'var(--accent-press)' : 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'transparent' },
    secondary: { background: h && !disabled ? 'var(--ink-card)' : 'transparent', color: 'var(--text-pri)', borderColor: h && !disabled ? 'var(--text-dim)' : 'var(--ink-line)' },
    ghost: { background: h && !disabled ? 'var(--ink-card)' : 'transparent', color: 'var(--text-sec)', borderColor: 'transparent' },
  };
  const s = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: fullWidth ? '100%' : 'auto', border: '1px solid', borderRadius: 0,
    fontFamily: 'var(--font-sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1,
    textDecoration: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
    transition: 'background-color .2s ease, border-color .2s ease', ...sizes[size], ...variants[variant], ...style,
  };
  const arrow = withArrow ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true"
      style={{ transform: h ? 'translateX(2px)' : 'none', transition: 'transform .3s var(--ease-out-expo)' }}><path d="M5 12h14M13 5l7 7-7 7" /></svg>
  ) : null;
  const props = { style: s, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), onClick: disabled ? undefined : onClick };
  return href ? <a href={href} {...props}>{children}{arrow}</a> : <button type={type} disabled={disabled} {...props}>{children}{arrow}</button>;
}

/* ─── Badge ───────────────────────────────────────────────────────── */
function Badge({ children, tone = 'neutral', icon, style = {} }) {
  const tones = {
    neutral: { color: 'var(--text-dim)', borderColor: 'var(--ink-line)', background: 'transparent' },
    accent: { color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
    solid: { color: 'var(--accent-ink)', borderColor: 'transparent', background: 'var(--accent)' },
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', border: '1px solid', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: tone === 'solid' ? 700 : 500, textTransform: 'uppercase', letterSpacing: '0.14em', ...tones[tone], ...style }}>
      {icon ? <span style={{ display: 'inline-flex' }} aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

/* ─── StatusPill ──────────────────────────────────────────────────── */
function StatusPill({ children, tone = 'neutral', pulse }) {
  const tones = { live: 'var(--success-bright)', paid: 'var(--success-bright)', review: 'var(--warning-bright)', error: 'var(--danger-bright)', neutral: 'var(--text-dim)' };
  const c = tones[tone] || tones.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', border: `1px solid color-mix(in srgb, ${c} 45%, transparent)`, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: c }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 9999, background: c, animation: pulse ? 'qm-pulse-soft 2.4s ease-in-out infinite' : 'none' }} />
      {children}
    </span>
  );
}

/* ─── Stat ────────────────────────────────────────────────────────── */
function Stat({ value, label, align = 'left' }) {
  return (
    <div style={{ textAlign: align }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.01em', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', fontSize: 'clamp(2.4rem, 5vw, 4.25rem)' }}>{value}</div>
      <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>{label}</div>
    </div>
  );
}

/* ─── Avatar ──────────────────────────────────────────────────────── */
function Avatar({ name = '', src, size = 40, round, tone = 'accent' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const tones = { accent: { background: 'var(--accent)', color: 'var(--accent-ink)', border: 'transparent' }, ink: { background: 'var(--ink)', color: 'var(--text-pri)', border: 'var(--ink-line)' } };
  const t = tones[tone];
  return (
    <span style={{ display: 'inline-grid', placeItems: 'center', flexShrink: 0, width: size, height: size, borderRadius: round ? 9999 : 0, background: t.background, color: t.color, border: `1px solid ${t.border}`, overflow: 'hidden', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: Math.round(size * 0.36) }}>
      {src ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (initials || '?')}
    </span>
  );
}

/* ─── Card ────────────────────────────────────────────────────────── */
function Card({ children, padding = 28, lit = true, sweep, interactive, accentTop, href, onClick, style = {}, className = '' }) {
  const [h, setH] = useState(false);
  const Tag = href ? 'a' : 'div';
  const cls = ['qm-card', lit && 'qm-edge-lit', sweep && 'qm-card-sweep', className].filter(Boolean).join(' ');
  return (
    <Tag href={href} onClick={onClick} className={cls}
      onMouseEnter={interactive ? () => setH(true) : undefined} onMouseLeave={interactive ? () => setH(false) : undefined}
      style={{ position: 'relative', display: 'block', background: interactive && h ? 'var(--ink)' : 'var(--ink-card)', border: '1px solid', borderColor: interactive && h ? 'color-mix(in srgb, var(--accent) 45%, var(--ink-line))' : 'var(--ink-line)', borderRadius: 0, padding, textDecoration: 'none', color: 'inherit', transition: 'background-color .3s ease, border-color .3s ease', cursor: href || onClick ? 'pointer' : 'default', ...style }}>
      {accentTop ? <span aria-hidden="true" style={{ position: 'absolute', insetInline: 0, top: 0, height: 2, background: 'var(--accent)' }} /> : null}
      {children}
    </Tag>
  );
}

/* ─── NumberedCard ────────────────────────────────────────────────── */
function NumberedCard({ num, title, body, interactive = true, sweep = true }) {
  return (
    <Card interactive={interactive} sweep={sweep} padding={32}>
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
        <span aria-hidden="true" style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 0.8, fontSize: 'clamp(2.75rem, 5vw, 4.5rem)', color: 'var(--accent)' }}>{num}</span>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.02em', fontSize: 'var(--text-2xl)', color: 'var(--text-pri)' }}>{title}</h3>
          {body ? <p style={{ margin: '12px 0 0', fontSize: 'var(--text-base)', lineHeight: 1.55, color: 'var(--text-sec)', maxWidth: '48ch' }}>{body}</p> : null}
        </div>
      </div>
    </Card>
  );
}

/* ─── Field ───────────────────────────────────────────────────────── */
function Field({ label, as = 'input', type = 'text', value, defaultValue, onChange, placeholder, hint, error, required, options = [], rows = 4, style = {} }) {
  const [f, setF] = useState(false);
  const control = { width: '100%', boxSizing: 'border-box', background: 'var(--ink)', border: '1px solid', borderColor: error ? 'var(--danger-bright)' : f ? 'var(--accent)' : 'var(--ink-line)', borderRadius: 0, color: 'var(--text-pri)', fontFamily: 'var(--font-sans)', fontSize: 16, lineHeight: 1.4, padding: '12px 14px', outline: 'none', transition: 'border-color .2s ease', appearance: as === 'select' ? 'none' : undefined };
  const shared = { value, defaultValue, onChange, onFocus: () => setF(true), onBlur: () => setF(false), style: control };
  return (
    <div style={{ display: 'grid', gap: 7, ...style }}>
      {label ? <label style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>{label}{required ? <span style={{ color: 'var(--accent)' }}> *</span> : null}</label> : null}
      {as === 'textarea' ? <textarea rows={rows} placeholder={placeholder} {...shared} />
        : as === 'select' ? <div style={{ position: 'relative' }}><select {...shared}>{options.map((o) => { const x = typeof o === 'string' ? { label: o, value: o } : o; return <option key={x.value} value={x.value}>{x.label}</option>; })}</select><span aria-hidden="true" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>▾</span></div>
        : <input type={type} placeholder={placeholder} {...shared} />}
      {error ? <span style={{ fontSize: 12, color: 'var(--danger-bright)' }}>{error}</span> : hint ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{hint}</span> : null}
    </div>
  );
}

/* ─── SegmentedToggle ─────────────────────────────────────────────── */
function Segmented({ options = [], value, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'inline-flex', border: '1px solid var(--ink-line)', background: 'var(--ink-card)', padding: 4, gap: 4 }}>
      {options.map((o) => { const x = typeof o === 'string' ? { label: o, value: o } : o; const active = x.value === value;
        return <button key={x.value} type="button" aria-pressed={active} onClick={() => onChange && onChange(x.value)} style={{ border: 0, cursor: 'pointer', padding: '8px 18px', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', background: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent-ink)' : 'var(--text-sec)', transition: 'background-color .2s ease, color .2s ease' }}>{x.label}</button>; })}
    </div>
  );
}

/* ─── Marquee ─────────────────────────────────────────────────────── */
function Marquee({ items = [], speed = 36, fontSize = 22 }) {
  const Run = ({ hidden }) => (
    <span aria-hidden={hidden || undefined} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
      {items.map((it, i) => <span key={i} style={{ display: 'flex', alignItems: 'center' }}><span style={{ padding: '0 24px' }}>{it}</span><span aria-hidden="true">·</span></span>)}
    </span>
  );
  return <div className="qm-marquee" style={{ padding: '18px 0' }}><div className="qm-marquee__track" style={{ animationDuration: `${speed}s` }}><Run /><Run hidden /></div></div>;
}

/* ─── Topography (signature SVG overlay) ──────────────────────────── */
function Topography({ opacity = 0.18 }) {
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity, pointerEvents: 'none' }} viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="var(--edge-glow)" strokeWidth="1" style={{ animation: 'qm-topo-drift 26s ease-in-out infinite alternate' }}>
        <path d="M0,820 Q240,700 480,760 T960,720 T1440,780 T1920,740 T2400,760" />
        <path d="M0,920 Q240,820 480,850 T960,830 T1440,880 T1920,850 T2400,870" opacity="0.5" />
        <path d="M0,1020 Q240,940 480,960 T960,940 T1440,980 T1920,960 T2400,970" opacity="0.2" />
      </g>
      <g fill="none" strokeWidth="1" style={{ animation: 'qm-topo-drift 34s ease-in-out infinite alternate-reverse' }}>
        <path d="M0,870 Q240,760 480,800 T960,780 T1440,830 T1920,800 T2400,820" stroke="var(--accent)" opacity="0.45" />
        <path d="M0,970 Q240,880 480,900 T960,880 T1440,930 T1920,900 T2400,915" stroke="var(--edge-glow)" opacity="0.35" />
      </g>
    </svg>
  );
}

/* ─── AUD money helper ────────────────────────────────────────────── */
const aud = (n) => (typeof n === 'number' ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : n);

/* ─── SMS thread (static) — inbound = customer, outbound = QuoteMax ── */
function Thread({ messages = [], header = true, label = 'SMS intake', minHeight, online = true }) {
  return (
    <div className="qm-edge-lit" style={{ border: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
      {header ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--ink-line)', padding: '12px 16px' }}>
          <Eyebrow style={{ fontSize: 10, letterSpacing: '0.16em' }}>{label}</Eyebrow>
          {online ? <StatusPill tone="live" pulse>Online</StatusPill> : null}
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: 12, padding: '20px 16px', minHeight }}>
        {messages.map((m, i) => {
          const inbound = m.from === 'customer';
          return (
            <div key={i} style={{ display: 'flex', justifyContent: inbound ? 'flex-start' : 'flex-end' }}>
              <div style={{ maxWidth: '86%', border: '1px solid', borderColor: inbound ? 'var(--ink-line)' : 'color-mix(in srgb, var(--accent) 35%, transparent)', background: inbound ? 'var(--ink-deep)' : 'color-mix(in srgb, var(--accent) 10%, transparent)', color: inbound ? 'var(--text-sec)' : 'var(--text-pri)', padding: '10px 14px', fontSize: 14, lineHeight: 1.45 }}>
                {!inbound ? <span style={{ display: 'block', marginBottom: 4, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>QuoteMax</span> : null}
                {m.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── TierCard — Good / Better / Best option (customer quote page) ─── */
function TierCard({ tier = 'Better', blurb, priceIncGst, depositAmount, depositPct = 30, recommended, paid, disabled, ctaLabel = 'Pay deposit', onPay, href, children }) {
  const [h, setH] = useState(false);
  return (
    <article className="qm-edge-lit" style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--ink-card)', border: '1px solid', borderColor: recommended ? 'var(--accent)' : 'var(--ink-line)', padding: 28, opacity: disabled ? 0.5 : 1, transition: 'opacity .3s ease' }}>
      {recommended ? <span style={{ position: 'absolute', top: -1, left: 0, background: 'var(--accent)', color: 'var(--accent-ink)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', padding: '4px 10px' }}>Recommended</span> : null}
      <div style={{ marginTop: recommended ? 14 : 0, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--accent)' }}>{tier}</div>
      {blurb ? <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>{blurb}</p> : null}
      {children}
      <div style={{ marginTop: 20, borderTop: '1px solid var(--ink-line)', paddingTop: 18 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 30, letterSpacing: '-0.01em', color: 'var(--text-pri)', fontVariantNumeric: 'tabular-nums' }}>{aud(priceIncGst)}</div>
        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>inc GST</div>
        {depositAmount != null ? <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text-sec)' }}>Deposit to book: <span style={{ fontWeight: 700, color: 'var(--text-pri)' }}>{aud(depositAmount)}</span><span style={{ color: 'var(--text-dim)' }}> · {depositPct}%</span></div> : null}
      </div>
      <div style={{ marginTop: 22 }}>
        {paid ? <div style={{ border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)', background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)', color: 'var(--success-bright)', padding: '13px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Deposit paid</div>
          : disabled ? <div style={{ border: '1px solid var(--ink-line)', color: 'var(--text-dim)', padding: '13px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Confirm to unlock</div>
          : <a href={href || '#'} onClick={onPay} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ display: 'block', background: h ? 'var(--accent-press)' : 'var(--accent)', color: 'var(--accent-ink)', padding: '14px 16px', textAlign: 'center', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', transition: 'background-color .2s ease' }}>{ctaLabel}</a>}
      </div>
    </article>
  );
}

window.QMUI = { Icon, useLucide, Logo, Eyebrow, Btn, Badge, StatusPill, Stat, Avatar, Card, NumberedCard, Field, Segmented, Marquee, Topography, aud, Thread, TierCard };
