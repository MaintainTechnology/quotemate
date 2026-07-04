/* @ds-bundle: {"format":4,"namespace":"QuoteMaxDesignSystem_638aa1","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Eyebrow","sourcePath":"components/core/Eyebrow.jsx"},{"name":"Stat","sourcePath":"components/core/Stat.jsx"},{"name":"StatusPill","sourcePath":"components/core/StatusPill.jsx"},{"name":"SegmentedToggle","sourcePath":"components/forms/SegmentedToggle.jsx"},{"name":"TextField","sourcePath":"components/forms/TextField.jsx"},{"name":"SmsThread","sourcePath":"components/quote/SmsThread.jsx"},{"name":"TierCard","sourcePath":"components/quote/TierCard.jsx"},{"name":"Card","sourcePath":"components/surfaces/Card.jsx"},{"name":"Marquee","sourcePath":"components/surfaces/Marquee.jsx"},{"name":"NumberedCard","sourcePath":"components/surfaces/NumberedCard.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"e634784eff8e","components/core/Badge.jsx":"e2d40443950e","components/core/Button.jsx":"195dab209cda","components/core/Eyebrow.jsx":"efef3f8fa56f","components/core/Stat.jsx":"b65e5e046eaf","components/core/StatusPill.jsx":"42674a8eb864","components/forms/SegmentedToggle.jsx":"f868a3e1738c","components/forms/TextField.jsx":"0568196f7019","components/quote/SmsThread.jsx":"cb434b7c058a","components/quote/TierCard.jsx":"04ba63f662c2","components/surfaces/Card.jsx":"a56070fcd772","components/surfaces/Marquee.jsx":"dce9cd22e5b8","components/surfaces/NumberedCard.jsx":"b9e89d662ae9","ui_kits/_shared/kit.jsx":"73f06c917c96","ui_kits/customer-quote/quote.jsx":"2ba857040e04","ui_kits/dashboard/dashboard.jsx":"677a6078cd4c","ui_kits/marketing/marketing.jsx":"22f0189fe0da"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.QuoteMaxDesignSystem_638aa1 = window.QuoteMaxDesignSystem_638aa1 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Avatar — a square (brand-default) or round identity tile. Shows an image
 * when `src` is given, otherwise initials derived from `name`. The default
 * look is a yellow tile with dark ink, echoing the logo mark.
 */
function Avatar({
  name = '',
  src,
  size = 40,
  round = false,
  tone = 'accent',
  ...rest
}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const tones = {
    accent: {
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      border: 'transparent'
    },
    ink: {
      background: 'var(--ink)',
      color: 'var(--text-pri)',
      border: 'var(--ink-line)'
    }
  };
  const t = tones[tone] || tones.accent;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-grid',
      placeItems: 'center',
      flexShrink: 0,
      width: size,
      height: size,
      borderRadius: round ? 'var(--radius-pill)' : 'var(--radius-none)',
      background: t.background,
      color: t.color,
      border: `1px solid ${t.border}`,
      overflow: 'hidden',
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize: Math.round(size * 0.36),
      letterSpacing: '0.02em',
      userSelect: 'none'
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials || '?');
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Badge / chip — a small mono-uppercase label in a square hairline box.
 * Use for trust signals, pilot status, metadata. `icon` renders before the
 * label (e.g. an AU flag <img> or a Lucide glyph).
 */
function Badge({
  children,
  tone = 'neutral',
  icon,
  ...rest
}) {
  const tones = {
    neutral: {
      color: 'var(--text-dim)',
      borderColor: 'var(--ink-line)',
      background: 'transparent'
    },
    accent: {
      color: 'var(--accent)',
      borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
      background: 'color-mix(in srgb, var(--accent) 10%, transparent)'
    },
    solid: {
      color: 'var(--accent-ink)',
      borderColor: 'transparent',
      background: 'var(--accent)'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '7px 12px',
      border: '1px solid',
      borderRadius: 'var(--radius-none)',
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      fontWeight: tone === 'solid' ? 700 : 500,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)',
      ...tones[tone]
    }
  }, rest), icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center'
    },
    "aria-hidden": "true"
  }, icon) : null, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * QuoteMax Button — square, heavy, uppercase-tracked.
 * Primary is a Caterpillar-yellow FILL with dark ink (never white text);
 * secondary is a hairline-bordered button; ghost is borderless. Renders as
 * <button> or, when `href` is set, as <a>.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  href,
  type = 'button',
  disabled = false,
  fullWidth = false,
  withArrow = false,
  onClick,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const sizes = {
    sm: {
      padding: '8px 16px',
      fontSize: '11px',
      minHeight: 36
    },
    md: {
      padding: '13px 26px',
      fontSize: '13px',
      minHeight: 44
    },
    lg: {
      padding: '17px 30px',
      fontSize: '14px',
      minHeight: 56
    }
  };
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: fullWidth ? '100%' : 'auto',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-control)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    lineHeight: 1,
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'background-color var(--dur-fast) ease, border-color var(--dur-fast) ease, color var(--dur-fast) ease',
    ...sizes[size]
  };
  const variants = {
    primary: {
      background: hover && !disabled ? 'var(--accent-press)' : 'var(--accent)',
      color: 'var(--accent-ink)',
      borderColor: 'transparent'
    },
    secondary: {
      background: hover && !disabled ? 'var(--ink-card)' : 'transparent',
      color: 'var(--text-pri)',
      borderColor: hover && !disabled ? 'var(--text-dim)' : 'var(--ink-line)'
    },
    ghost: {
      background: hover && !disabled ? 'var(--ink-card)' : 'transparent',
      color: 'var(--text-sec)',
      borderColor: 'transparent'
    },
    danger: {
      background: hover && !disabled ? '#a11717' : 'var(--danger)',
      color: '#fff',
      borderColor: 'transparent'
    }
  };
  const style = {
    ...base,
    ...variants[variant],
    transform: active && !disabled ? 'translateY(1px)' : 'none'
  };
  const arrow = withArrow ? /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "square",
    strokeLinejoin: "miter",
    "aria-hidden": "true",
    style: {
      transform: hover && !disabled ? 'translateX(2px)' : 'none',
      transition: 'transform var(--dur-base) var(--ease-out-expo)'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 5l7 7-7 7"
  })) : null;
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    onClick: disabled ? undefined : onClick
  };
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      style: style
    }, handlers, rest), children, arrow);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    style: style
  }, handlers, rest), children, arrow);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Eyebrow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mono uppercase eyebrow — the small tracked label that sits above a
 * headline or names a section. JetBrains Mono, wide tracking, dim by default.
 */
function Eyebrow({
  children,
  as = 'span',
  color = 'var(--text-dim)',
  ...rest
}) {
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, _extends({
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-eyebrow)',
      color,
      margin: 0
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/core/Stat.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Stat — a big JetBrains-Mono figure in accent over a mono uppercase label.
 * The brand's headline numbers ("< 1 min", "$0", "24/7"). Fluid size.
 */
function Stat({
  value,
  label,
  align = 'left',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      textAlign: align
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      lineHeight: 1.05,
      letterSpacing: '-0.01em',
      color: 'var(--accent)',
      fontVariantNumeric: 'tabular-nums',
      fontSize: 'clamp(2.5rem, 5vw, 4.25rem)'
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)',
      color: 'var(--text-dim)'
    }
  }, label));
}
Object.assign(__ds_scope, { Stat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Stat.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusPill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StatusPill — a small dot + mono label that reports live state. The dot
 * can pulse for a genuinely live signal (an active account, an open line).
 */
function StatusPill({
  children,
  tone = 'neutral',
  pulse = false,
  ...rest
}) {
  const tones = {
    live: 'var(--success-bright)',
    paid: 'var(--success-bright)',
    review: 'var(--warning-bright)',
    error: 'var(--danger-bright)',
    neutral: 'var(--text-dim)'
  };
  const c = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      padding: '6px 11px',
      border: `1px solid color-mix(in srgb, ${c} 45%, transparent)`,
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)',
      color: c
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 7,
      height: 7,
      borderRadius: 'var(--radius-pill)',
      background: c,
      animation: pulse ? 'qm-pulse-soft 2.4s ease-in-out infinite' : 'none'
    }
  }), children);
}
Object.assign(__ds_scope, { StatusPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusPill.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedToggle.jsx
try { (() => {
/**
 * SegmentedToggle — a square bordered group of options where the active one
 * is a yellow fill with dark ink. The brand's Monthly/Annual switch and any
 * 2–3 option mode picker.
 */
function SegmentedToggle({
  options = [],
  value,
  onChange,
  ariaLabel
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "group",
    "aria-label": ariaLabel,
    style: {
      display: 'inline-flex',
      border: '1px solid var(--ink-line)',
      background: 'var(--ink-card)',
      padding: 4,
      gap: 4
    }
  }, options.map(o => {
    const opt = typeof o === 'string' ? {
      label: o,
      value: o
    } : o;
    const active = opt.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: opt.value,
      type: "button",
      "aria-pressed": active,
      onClick: () => onChange && onChange(opt.value),
      style: {
        border: 0,
        cursor: 'pointer',
        padding: '8px 18px',
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-ink)' : 'var(--text-sec)',
        transition: 'background-color var(--dur-fast) ease, color var(--dur-fast) ease'
      }
    }, opt.label);
  }));
}
Object.assign(__ds_scope, { SegmentedToggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedToggle.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * TextField — square, hairline-bordered field on the sunken surface. Mono
 * uppercase label above; the border warms to accent on focus. Renders an
 * <input>, <textarea> or <select> via `as`.
 */
function TextField({
  label,
  as = 'input',
  type = 'text',
  value,
  defaultValue,
  onChange,
  placeholder,
  hint,
  error,
  required = false,
  disabled = false,
  options = [],
  id,
  rows = 4,
  ...rest
}) {
  const [focus, setFocus] = useState(false);
  const fieldId = id || (label ? `tf-${String(label).replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const control = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--ink)',
    border: '1px solid',
    borderColor: error ? 'var(--danger-bright)' : focus ? 'var(--accent)' : 'var(--ink-line)',
    borderRadius: 'var(--radius-control)',
    color: 'var(--text-pri)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-base)',
    lineHeight: 1.4,
    padding: '12px 14px',
    minHeight: as === 'textarea' ? undefined : 'var(--control-h-md)',
    outline: 'none',
    opacity: disabled ? 0.55 : 1,
    transition: 'border-color var(--dur-fast) ease',
    appearance: as === 'select' ? 'none' : undefined
  };
  const shared = {
    id: fieldId,
    value,
    defaultValue,
    onChange,
    disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: control,
    ...rest
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 7
    }
  }, label ? /*#__PURE__*/React.createElement("label", {
    htmlFor: fieldId,
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)',
      color: 'var(--text-dim)'
    }
  }, label, required ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, " *") : null) : null, as === 'textarea' ? /*#__PURE__*/React.createElement("textarea", _extends({
    rows: rows,
    placeholder: placeholder
  }, shared)) : as === 'select' ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("select", shared, options.map(o => {
    const opt = typeof o === 'string' ? {
      label: o,
      value: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      right: 14,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--text-dim)',
      fontFamily: 'var(--font-mono)',
      pointerEvents: 'none'
    }
  }, "\u25BE")) : /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    placeholder: placeholder
  }, shared)), error ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--danger-bright)'
    }
  }, error) : hint ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--text-dim)'
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextField.jsx", error: String((e && e.message) || e) }); }

// components/quote/SmsThread.jsx
try { (() => {
function aud(n) {
  if (typeof n !== 'number') return n;
  return '$' + n.toLocaleString('en-AU', {
    maximumFractionDigits: 0
  });
}
function Bubble({
  from,
  text
}) {
  const inbound = from === 'customer';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: inbound ? 'flex-start' : 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '86%',
      border: '1px solid',
      borderColor: inbound ? 'var(--ink-line)' : 'color-mix(in srgb, var(--accent) 35%, transparent)',
      background: inbound ? 'var(--ink-deep)' : 'color-mix(in srgb, var(--accent) 10%, transparent)',
      color: inbound ? 'var(--text-sec)' : 'var(--text-pri)',
      padding: '10px 14px',
      fontSize: 'var(--text-sm)',
      lineHeight: 1.45
    }
  }, !inbound ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      marginBottom: 4,
      fontFamily: 'var(--font-mono)',
      fontSize: '9px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
      color: 'var(--accent)'
    }
  }, "QuoteMax") : null, text));
}
function Typing() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "status",
    "aria-label": "QuoteMax is drafting the quote",
    style: {
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
      background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
      padding: '12px 14px'
    }
  }, [0, 1, 2].map(d => /*#__PURE__*/React.createElement("span", {
    key: d,
    "aria-hidden": "true",
    style: {
      width: 6,
      height: 6,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--accent-soft)',
      animation: 'qm-typing-bounce 1.3s ease-in-out infinite',
      animationDelay: `${d * 160}ms`
    }
  }))));
}

/**
 * SmsThread — the live SMS-intake demo, rendered as content bubbles on the
 * canvas (deliberately NOT a fake phone frame). Inbound = customer; outbound
 * = QuoteMax (accent-tinted, labelled). Optional trailing typing indicator
 * and a "quote drafted" drop with the price.
 */
function SmsThread({
  messages = [],
  typing = false,
  quote,
  header = true
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--ink-line)',
      background: 'var(--ink-card)',
      boxShadow: 'var(--lift)'
    }
  }, header ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid var(--ink-line)',
      padding: '12px 16px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
      color: 'var(--text-dim)'
    }
  }, "Live example \xB7 SMS intake"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--success-bright)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--success-bright)',
      animation: 'qm-pulse-soft 2.4s ease-in-out infinite'
    }
  }), "Online")) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12,
      padding: '20px 16px'
    }
  }, messages.map((m, i) => /*#__PURE__*/React.createElement(Bubble, {
    key: i,
    from: m.from,
    text: m.text
  })), typing ? /*#__PURE__*/React.createElement(Typing, null) : null), quote ? /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--ink-line)',
      background: 'color-mix(in srgb, var(--ink-deep) 50%, transparent)',
      padding: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
      color: 'var(--accent)'
    }
  }, quote.label || 'Quote drafted · under a minute'), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '9px',
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--text-dim)'
    }
  }, "Sample")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      position: 'relative',
      border: '1px solid var(--ink-line)',
      background: 'var(--ink-card)',
      padding: '16px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      insetInline: 0,
      top: 0,
      height: 2,
      background: 'var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize: '22px',
      color: 'var(--accent)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, aud(quote.amount)))) : null);
}
Object.assign(__ds_scope, { SmsThread });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/quote/SmsThread.jsx", error: String((e && e.message) || e) }); }

// components/quote/TierCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function aud(n) {
  if (typeof n !== 'number') return n;
  return '$' + n.toLocaleString('en-AU', {
    maximumFractionDigits: 0
  });
}

/**
 * TierCard — a Good / Better / Best option on the customer quote page. Big
 * mono price (inc GST), a deposit-to-book line, and a deposit CTA. The
 * recommended tier takes an accent border + badge; a paid tier shows the
 * success state; sibling tiers dim once one is paid.
 */
function TierCard({
  tier = 'Better',
  blurb,
  priceIncGst,
  depositAmount,
  depositPct = 30,
  recommended = false,
  paid = false,
  disabled = false,
  ctaLabel = 'Pay deposit',
  href,
  onPay,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("article", _extends({
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--ink-card)',
      border: '1px solid',
      borderColor: recommended ? 'var(--accent)' : 'var(--ink-line)',
      borderRadius: 'var(--radius-card)',
      boxShadow: 'var(--lift)',
      padding: 28,
      opacity: disabled ? 0.5 : 1,
      transition: 'opacity var(--dur-base) ease'
    }
  }, rest), recommended ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: -1,
      left: 0,
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
      padding: '4px 10px'
    }
  }, "Recommended") : null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: recommended ? 14 : 0,
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)',
      color: 'var(--accent)'
    }
  }, tier), blurb ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: 'var(--text-sm)',
      lineHeight: 1.55,
      color: 'var(--text-sec)'
    }
  }, blurb) : null, children, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      borderTop: '1px solid var(--ink-line)',
      paddingTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize: '30px',
      letterSpacing: '-0.01em',
      color: 'var(--text-pri)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, aud(priceIncGst)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)',
      color: 'var(--text-dim)'
    }
  }, "inc GST"), depositAmount != null ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 'var(--text-sm)',
      color: 'var(--text-sec)'
    }
  }, "Deposit to book: ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--text-pri)'
    }
  }, aud(depositAmount)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-dim)'
    }
  }, " \xB7 ", depositPct, "%")) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 22
    }
  }, paid ? /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)',
      background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)',
      color: 'var(--success-bright)',
      padding: '13px 16px',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)'
    }
  }, "Deposit paid") : disabled ? /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--ink-line)',
      color: 'var(--text-dim)',
      padding: '13px 16px',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)'
    }
  }, "Confirm to unlock") : /*#__PURE__*/React.createElement("a", {
    href: href || '#',
    onClick: onPay,
    style: {
      display: 'block',
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      padding: '14px 16px',
      textAlign: 'center',
      textDecoration: 'none',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)'
    }
  }, ctaLabel)));
}
Object.assign(__ds_scope, { TierCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/quote/TierCard.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Card — the structural surface: a palette-charcoal panel held by a warm
 * hairline, lifted by the inner "lit edge" (not a drop shadow). Square
 * corners. Optional accent top rule, hover-driven accent sweep, and an
 * interactive hover state (border warms to accent, surface lifts a step).
 */
function Card({
  children,
  as = 'div',
  padding = 28,
  lit = true,
  sweep = false,
  interactive = false,
  accentTop = false,
  href,
  style = {},
  className = '',
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const Tag = href ? 'a' : as;
  const cls = ['qm-card', lit && 'qm-edge-lit', sweep && 'qm-card-sweep', className].filter(Boolean).join(' ');
  const merged = {
    position: 'relative',
    display: 'block',
    background: interactive && hover ? 'var(--ink)' : 'var(--ink-card)',
    border: '1px solid',
    borderColor: interactive && hover ? 'color-mix(in srgb, var(--accent) 45%, var(--ink-line))' : 'var(--ink-line)',
    borderRadius: 'var(--radius-card)',
    padding,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background-color var(--dur-base) ease, border-color var(--dur-base) ease',
    ...style
  };
  return /*#__PURE__*/React.createElement(Tag, _extends({
    href: href,
    className: cls,
    style: merged,
    onMouseEnter: interactive ? () => setHover(true) : undefined,
    onMouseLeave: interactive ? () => setHover(false) : undefined
  }, rest), accentTop ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      insetInline: 0,
      top: 0,
      height: 2,
      background: 'var(--accent)'
    }
  }) : null, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Card.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Marquee.jsx
try { (() => {
/**
 * Marquee — the signature yellow CTA ticker. Dark ink on yellow (never
 * white). The track holds the items twice so the -50% loop is seamless;
 * reduced-motion users see the static leading set. Items are separated by
 * a middot.
 */
function Marquee({
  items = [],
  speed = 36,
  fontSize = 22
}) {
  const Run = ({
    hidden
  }) => /*#__PURE__*/React.createElement("span", {
    "aria-hidden": hidden || undefined,
    style: {
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0,
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)'
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '0 24px'
    }
  }, it), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xB7"))));
  return /*#__PURE__*/React.createElement("div", {
    className: "qm-marquee",
    style: {
      padding: '18px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "qm-marquee__track",
    style: {
      animationDuration: `${speed}s`
    }
  }, /*#__PURE__*/React.createElement(Run, null), /*#__PURE__*/React.createElement(Run, {
    hidden: true
  })));
}
Object.assign(__ds_scope, { Marquee });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Marquee.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/NumberedCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * NumberedCard — the signature step card: a large JetBrains-Mono number in
 * accent beside an all-caps title and body. Built on Card, so it inherits
 * the lit edge and the optional hover sweep.
 */
function NumberedCard({
  num,
  title,
  body,
  children,
  interactive = true,
  sweep = true,
  ...rest
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Card, _extends({
    interactive: interactive,
    sweep: sweep,
    padding: 32
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 28,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      flexShrink: 0,
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      lineHeight: 0.8,
      fontSize: 'clamp(2.75rem, 5vw, 4.5rem)',
      color: 'var(--accent)'
    }
  }, num), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '-0.02em',
      fontSize: 'var(--text-2xl)',
      color: 'var(--text-pri)'
    }
  }, title), body ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      fontSize: 'var(--text-base)',
      lineHeight: 1.55,
      color: 'var(--text-sec)',
      maxWidth: '48ch'
    }
  }, body) : null, children)));
}
Object.assign(__ds_scope, { NumberedCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/NumberedCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/_shared/kit.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* ════════════════════════════════════════════════════════════════════
   QuoteMax UI-kit primitives (shared by all three kits).
   These mirror the bundled design-system components (components/*) one-to-one
   but are inline-styled so each kit previews + runs standalone. Styling is
   driven entirely by the design tokens in styles.css. Exposed on window.QMUI.
   ════════════════════════════════════════════════════════════════════ */
const {
  useState,
  useEffect
} = React;

/* ─── Lucide icon — rendered as a React-OWNED inline <svg> ─────────────
   We read the icon's node data from window.lucide.icons and build the SVG
   in React. We deliberately do NOT use lucide.createIcons(): that mutates
   the DOM (swaps <i> for <svg>) behind React's back, which breaks
   reconciliation the moment any ancestor re-renders (nav clicks, toggles).
   React owning the SVG keeps re-renders safe. */
function camelKey(k) {
  return k.indexOf('-') === -1 ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
function pascal(name) {
  return String(name).split(/[-_]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 1.75,
  style = {},
  ...rest
}) {
  const lib = window.lucide && window.lucide.icons || {};
  const node = lib[pascal(name)] || lib[name];
  const base = {
    display: 'inline-flex',
    flexShrink: 0,
    verticalAlign: 'middle',
    ...style
  };
  if (!node) return /*#__PURE__*/React.createElement("span", _extends({
    "aria-hidden": "true",
    style: {
      width: size,
      height: size,
      ...base
    }
  }, rest));
  return /*#__PURE__*/React.createElement("svg", _extends({
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || 'currentColor',
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    style: base
  }, rest), node.map((child, i) => {
    const attrs = child[1] || {};
    const out = {
      key: i
    };
    for (const k in attrs) out[camelKey(k)] = attrs[k];
    return React.createElement(child[0], out);
  }));
}
// No-op kept for API compatibility — icons are React-owned now, nothing to do.
function useLucide() {}

/* ─── Brand mark + wordmark ───────────────────────────────────────── */
function Logo({
  size = 36,
  word = true,
  sub
}) {
  return /*#__PURE__*/React.createElement("a", {
    href: "#top",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logos/quotemax-mark.svg",
    width: size,
    height: size,
    alt: "QuoteMax",
    style: {
      display: 'block'
    }
  }), word ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '-0.02em',
      color: 'var(--text-pri)',
      fontSize: size * 0.46
    }
  }, "QuoteMax") : null, sub ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-dim)'
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--text-sec)'
    }
  }, sub)) : null);
}

/* ─── Eyebrow ─────────────────────────────────────────────────────── */
function Eyebrow({
  children,
  color = 'var(--text-dim)',
  style = {}
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.18em',
      color,
      ...style
    }
  }, children);
}

/* ─── Button ──────────────────────────────────────────────────────── */
function Btn({
  children,
  variant = 'primary',
  size = 'md',
  href,
  onClick,
  withArrow,
  fullWidth,
  disabled,
  type = 'button',
  style = {}
}) {
  const [h, setH] = useState(false);
  const sizes = {
    sm: {
      padding: '8px 16px',
      fontSize: 11,
      minHeight: 36
    },
    md: {
      padding: '13px 26px',
      fontSize: 13,
      minHeight: 44
    },
    lg: {
      padding: '17px 30px',
      fontSize: 14,
      minHeight: 56
    }
  };
  const variants = {
    primary: {
      background: h && !disabled ? 'var(--accent-press)' : 'var(--accent)',
      color: 'var(--accent-ink)',
      borderColor: 'transparent'
    },
    secondary: {
      background: h && !disabled ? 'var(--ink-card)' : 'transparent',
      color: 'var(--text-pri)',
      borderColor: h && !disabled ? 'var(--text-dim)' : 'var(--ink-line)'
    },
    ghost: {
      background: h && !disabled ? 'var(--ink-card)' : 'transparent',
      color: 'var(--text-sec)',
      borderColor: 'transparent'
    }
  };
  const s = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: fullWidth ? '100%' : 'auto',
    border: '1px solid',
    borderRadius: 0,
    fontFamily: 'var(--font-sans)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    lineHeight: 1,
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'background-color .2s ease, border-color .2s ease',
    ...sizes[size],
    ...variants[variant],
    ...style
  };
  const arrow = withArrow ? /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "square",
    "aria-hidden": "true",
    style: {
      transform: h ? 'translateX(2px)' : 'none',
      transition: 'transform .3s var(--ease-out-expo)'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 5l7 7-7 7"
  })) : null;
  const props = {
    style: s,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    onClick: disabled ? undefined : onClick
  };
  return href ? /*#__PURE__*/React.createElement("a", _extends({
    href: href
  }, props), children, arrow) : /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled
  }, props), children, arrow);
}

/* ─── Badge ───────────────────────────────────────────────────────── */
function Badge({
  children,
  tone = 'neutral',
  icon,
  style = {}
}) {
  const tones = {
    neutral: {
      color: 'var(--text-dim)',
      borderColor: 'var(--ink-line)',
      background: 'transparent'
    },
    accent: {
      color: 'var(--accent)',
      borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
      background: 'color-mix(in srgb, var(--accent) 10%, transparent)'
    },
    solid: {
      color: 'var(--accent-ink)',
      borderColor: 'transparent',
      background: 'var(--accent)'
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '7px 12px',
      border: '1px solid',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: tone === 'solid' ? 700 : 500,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      ...tones[tone],
      ...style
    }
  }, icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex'
    },
    "aria-hidden": "true"
  }, icon) : null, children);
}

/* ─── StatusPill ──────────────────────────────────────────────────── */
function StatusPill({
  children,
  tone = 'neutral',
  pulse
}) {
  const tones = {
    live: 'var(--success-bright)',
    paid: 'var(--success-bright)',
    review: 'var(--warning-bright)',
    error: 'var(--danger-bright)',
    neutral: 'var(--text-dim)'
  };
  const c = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      padding: '6px 11px',
      border: `1px solid color-mix(in srgb, ${c} 45%, transparent)`,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: c
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 7,
      height: 7,
      borderRadius: 9999,
      background: c,
      animation: pulse ? 'qm-pulse-soft 2.4s ease-in-out infinite' : 'none'
    }
  }), children);
}

/* ─── Stat ────────────────────────────────────────────────────────── */
function Stat({
  value,
  label,
  align = 'left'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: align
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      lineHeight: 1.05,
      letterSpacing: '-0.01em',
      color: 'var(--accent)',
      fontVariantNumeric: 'tabular-nums',
      fontSize: 'clamp(2.4rem, 5vw, 4.25rem)'
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--text-dim)'
    }
  }, label));
}

/* ─── Avatar ──────────────────────────────────────────────────────── */
function Avatar({
  name = '',
  src,
  size = 40,
  round,
  tone = 'accent'
}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const tones = {
    accent: {
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      border: 'transparent'
    },
    ink: {
      background: 'var(--ink)',
      color: 'var(--text-pri)',
      border: 'var(--ink-line)'
    }
  };
  const t = tones[tone];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-grid',
      placeItems: 'center',
      flexShrink: 0,
      width: size,
      height: size,
      borderRadius: round ? 9999 : 0,
      background: t.background,
      color: t.color,
      border: `1px solid ${t.border}`,
      overflow: 'hidden',
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize: Math.round(size * 0.36)
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials || '?');
}

/* ─── Card ────────────────────────────────────────────────────────── */
function Card({
  children,
  padding = 28,
  lit = true,
  sweep,
  interactive,
  accentTop,
  href,
  onClick,
  style = {},
  className = ''
}) {
  const [h, setH] = useState(false);
  const Tag = href ? 'a' : 'div';
  const cls = ['qm-card', lit && 'qm-edge-lit', sweep && 'qm-card-sweep', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement(Tag, {
    href: href,
    onClick: onClick,
    className: cls,
    onMouseEnter: interactive ? () => setH(true) : undefined,
    onMouseLeave: interactive ? () => setH(false) : undefined,
    style: {
      position: 'relative',
      display: 'block',
      background: interactive && h ? 'var(--ink)' : 'var(--ink-card)',
      border: '1px solid',
      borderColor: interactive && h ? 'color-mix(in srgb, var(--accent) 45%, var(--ink-line))' : 'var(--ink-line)',
      borderRadius: 0,
      padding,
      textDecoration: 'none',
      color: 'inherit',
      transition: 'background-color .3s ease, border-color .3s ease',
      cursor: href || onClick ? 'pointer' : 'default',
      ...style
    }
  }, accentTop ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      insetInline: 0,
      top: 0,
      height: 2,
      background: 'var(--accent)'
    }
  }) : null, children);
}

/* ─── NumberedCard ────────────────────────────────────────────────── */
function NumberedCard({
  num,
  title,
  body,
  interactive = true,
  sweep = true
}) {
  return /*#__PURE__*/React.createElement(Card, {
    interactive: interactive,
    sweep: sweep,
    padding: 32
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 28,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      flexShrink: 0,
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      lineHeight: 0.8,
      fontSize: 'clamp(2.75rem, 5vw, 4.5rem)',
      color: 'var(--accent)'
    }
  }, num), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '-0.02em',
      fontSize: 'var(--text-2xl)',
      color: 'var(--text-pri)'
    }
  }, title), body ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      fontSize: 'var(--text-base)',
      lineHeight: 1.55,
      color: 'var(--text-sec)',
      maxWidth: '48ch'
    }
  }, body) : null)));
}

/* ─── Field ───────────────────────────────────────────────────────── */
function Field({
  label,
  as = 'input',
  type = 'text',
  value,
  defaultValue,
  onChange,
  placeholder,
  hint,
  error,
  required,
  options = [],
  rows = 4,
  style = {}
}) {
  const [f, setF] = useState(false);
  const control = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--ink)',
    border: '1px solid',
    borderColor: error ? 'var(--danger-bright)' : f ? 'var(--accent)' : 'var(--ink-line)',
    borderRadius: 0,
    color: 'var(--text-pri)',
    fontFamily: 'var(--font-sans)',
    fontSize: 16,
    lineHeight: 1.4,
    padding: '12px 14px',
    outline: 'none',
    transition: 'border-color .2s ease',
    appearance: as === 'select' ? 'none' : undefined
  };
  const shared = {
    value,
    defaultValue,
    onChange,
    onFocus: () => setF(true),
    onBlur: () => setF(false),
    style: control
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 7,
      ...style
    }
  }, label ? /*#__PURE__*/React.createElement("label", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--text-dim)'
    }
  }, label, required ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, " *") : null) : null, as === 'textarea' ? /*#__PURE__*/React.createElement("textarea", _extends({
    rows: rows,
    placeholder: placeholder
  }, shared)) : as === 'select' ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("select", shared, options.map(o => {
    const x = typeof o === 'string' ? {
      label: o,
      value: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: x.value,
      value: x.value
    }, x.label);
  })), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      right: 14,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--text-dim)',
      fontFamily: 'var(--font-mono)',
      pointerEvents: 'none'
    }
  }, "\u25BE")) : /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    placeholder: placeholder
  }, shared)), error ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--danger-bright)'
    }
  }, error) : hint ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-dim)'
    }
  }, hint) : null);
}

/* ─── SegmentedToggle ─────────────────────────────────────────────── */
function Segmented({
  options = [],
  value,
  onChange,
  ariaLabel
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "group",
    "aria-label": ariaLabel,
    style: {
      display: 'inline-flex',
      border: '1px solid var(--ink-line)',
      background: 'var(--ink-card)',
      padding: 4,
      gap: 4
    }
  }, options.map(o => {
    const x = typeof o === 'string' ? {
      label: o,
      value: o
    } : o;
    const active = x.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: x.value,
      type: "button",
      "aria-pressed": active,
      onClick: () => onChange && onChange(x.value),
      style: {
        border: 0,
        cursor: 'pointer',
        padding: '8px 18px',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-ink)' : 'var(--text-sec)',
        transition: 'background-color .2s ease, color .2s ease'
      }
    }, x.label);
  }));
}

/* ─── Marquee ─────────────────────────────────────────────────────── */
function Marquee({
  items = [],
  speed = 36,
  fontSize = 22
}) {
  const Run = ({
    hidden
  }) => /*#__PURE__*/React.createElement("span", {
    "aria-hidden": hidden || undefined,
    style: {
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0,
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize,
      textTransform: 'uppercase',
      letterSpacing: '0.14em'
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '0 24px'
    }
  }, it), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xB7"))));
  return /*#__PURE__*/React.createElement("div", {
    className: "qm-marquee",
    style: {
      padding: '18px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "qm-marquee__track",
    style: {
      animationDuration: `${speed}s`
    }
  }, /*#__PURE__*/React.createElement(Run, null), /*#__PURE__*/React.createElement(Run, {
    hidden: true
  })));
}

/* ─── Topography (signature SVG overlay) ──────────────────────────── */
function Topography({
  opacity = 0.18
}) {
  return /*#__PURE__*/React.createElement("svg", {
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity,
      pointerEvents: 'none'
    },
    viewBox: "0 0 1920 1080",
    preserveAspectRatio: "xMidYMid slice",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("g", {
    fill: "none",
    stroke: "var(--edge-glow)",
    strokeWidth: "1",
    style: {
      animation: 'qm-topo-drift 26s ease-in-out infinite alternate'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M0,820 Q240,700 480,760 T960,720 T1440,780 T1920,740 T2400,760"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M0,920 Q240,820 480,850 T960,830 T1440,880 T1920,850 T2400,870",
    opacity: "0.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M0,1020 Q240,940 480,960 T960,940 T1440,980 T1920,960 T2400,970",
    opacity: "0.2"
  })), /*#__PURE__*/React.createElement("g", {
    fill: "none",
    strokeWidth: "1",
    style: {
      animation: 'qm-topo-drift 34s ease-in-out infinite alternate-reverse'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M0,870 Q240,760 480,800 T960,780 T1440,830 T1920,800 T2400,820",
    stroke: "var(--accent)",
    opacity: "0.45"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M0,970 Q240,880 480,900 T960,880 T1440,930 T1920,900 T2400,915",
    stroke: "var(--edge-glow)",
    opacity: "0.35"
  })));
}

/* ─── AUD money helper ────────────────────────────────────────────── */
const aud = n => typeof n === 'number' ? '$' + n.toLocaleString('en-AU', {
  maximumFractionDigits: 0
}) : n;

/* ─── SMS thread (static) — inbound = customer, outbound = QuoteMax ── */
function Thread({
  messages = [],
  header = true,
  label = 'SMS intake',
  minHeight,
  online = true
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "qm-edge-lit",
    style: {
      border: '1px solid var(--ink-line)',
      background: 'var(--ink-card)'
    }
  }, header ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid var(--ink-line)',
      padding: '12px 16px'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    style: {
      fontSize: 10,
      letterSpacing: '0.16em'
    }
  }, label), online ? /*#__PURE__*/React.createElement(StatusPill, {
    tone: "live",
    pulse: true
  }, "Online") : null) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12,
      padding: '20px 16px',
      minHeight
    }
  }, messages.map((m, i) => {
    const inbound = m.from === 'customer';
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        justifyContent: inbound ? 'flex-start' : 'flex-end'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '86%',
        border: '1px solid',
        borderColor: inbound ? 'var(--ink-line)' : 'color-mix(in srgb, var(--accent) 35%, transparent)',
        background: inbound ? 'var(--ink-deep)' : 'color-mix(in srgb, var(--accent) 10%, transparent)',
        color: inbound ? 'var(--text-sec)' : 'var(--text-pri)',
        padding: '10px 14px',
        fontSize: 14,
        lineHeight: 1.45
      }
    }, !inbound ? /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        marginBottom: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.16em',
        color: 'var(--accent)'
      }
    }, "QuoteMax") : null, m.text));
  })));
}

/* ─── TierCard — Good / Better / Best option (customer quote page) ─── */
function TierCard({
  tier = 'Better',
  blurb,
  priceIncGst,
  depositAmount,
  depositPct = 30,
  recommended,
  paid,
  disabled,
  ctaLabel = 'Pay deposit',
  onPay,
  href,
  children
}) {
  const [h, setH] = useState(false);
  return /*#__PURE__*/React.createElement("article", {
    className: "qm-edge-lit",
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--ink-card)',
      border: '1px solid',
      borderColor: recommended ? 'var(--accent)' : 'var(--ink-line)',
      padding: 28,
      opacity: disabled ? 0.5 : 1,
      transition: 'opacity .3s ease'
    }
  }, recommended ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: -1,
      left: 0,
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
      padding: '4px 10px'
    }
  }, "Recommended") : null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: recommended ? 14 : 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--accent)'
    }
  }, tier), blurb ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: 14,
      lineHeight: 1.55,
      color: 'var(--text-sec)'
    }
  }, blurb) : null, children, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      borderTop: '1px solid var(--ink-line)',
      paddingTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize: 30,
      letterSpacing: '-0.01em',
      color: 'var(--text-pri)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, aud(priceIncGst)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--text-dim)'
    }
  }, "inc GST"), depositAmount != null ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 14,
      color: 'var(--text-sec)'
    }
  }, "Deposit to book: ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--text-pri)'
    }
  }, aud(depositAmount)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-dim)'
    }
  }, " \xB7 ", depositPct, "%")) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 22
    }
  }, paid ? /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)',
      background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)',
      color: 'var(--success-bright)',
      padding: '13px 16px',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.14em'
    }
  }, "Deposit paid") : disabled ? /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--ink-line)',
      color: 'var(--text-dim)',
      padding: '13px 16px',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: '0.14em'
    }
  }, "Confirm to unlock") : /*#__PURE__*/React.createElement("a", {
    href: href || '#',
    onClick: onPay,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: 'block',
      background: h ? 'var(--accent-press)' : 'var(--accent)',
      color: 'var(--accent-ink)',
      padding: '14px 16px',
      textAlign: 'center',
      textDecoration: 'none',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      transition: 'background-color .2s ease'
    }
  }, ctaLabel)));
}
window.QMUI = {
  Icon,
  useLucide,
  Logo,
  Eyebrow,
  Btn,
  Badge,
  StatusPill,
  Stat,
  Avatar,
  Card,
  NumberedCard,
  Field,
  Segmented,
  Marquee,
  Topography,
  aud,
  Thread,
  TierCard
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/_shared/kit.jsx", error: String((e && e.message) || e) }); }

// ui_kits/customer-quote/quote.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* QuoteMax — Customer quote page. What the customer taps from the SMS link.
   Mobile-first; per-tier deposits lock the booking. Composes window.QMUI. */
(function () {
  const {
    useState
  } = React;
  const {
    Eyebrow,
    Btn,
    Badge,
    StatusPill,
    TierCard,
    Marquee,
    Topography,
    Icon,
    useLucide,
    aud
  } = window.QMUI;

  /* ─── Quote data (consistent with the dashboard & SMS demo) ───────── */
  const BIZ = {
    name: 'Hartley Electrical',
    owner: 'Dave Hartley',
    licence: 'NSW EC 89421',
    abn: '54 219 887 663',
    number: '0480 102 030'
  };
  const QUOTE = {
    id: 'QM-1043',
    customer: 'Sarah',
    suburb: 'Ashfield',
    issued: '28 Jun 2026',
    valid: '12 Jul 2026'
  };
  const TIERS = [{
    tier: 'Good',
    price: 890,
    deposit: 267,
    blurb: 'A tidy like-for-like. Does the job, nothing fancy.',
    items: ['6× dimmable LED downlights, warm white', 'Reuse existing wiring & switch', '12-month workmanship warranty']
  }, {
    tier: 'Better',
    price: 1180,
    deposit: 354,
    recommended: true,
    blurb: 'What most lounges get. Set the white to suit the room.',
    items: ['6× CCT-selectable downlights (warm→cool)', 'New LED-rated dimmer fitted', '5-year warranty · neat cut-ins']
  }, {
    tier: 'Best',
    price: 1540,
    deposit: 462,
    blurb: 'Smart control, scenes, and the longest cover.',
    items: ['6× smart app-controlled downlights', 'Individual dimming & lighting scenes', '7-year warranty · priority callback']
  }];
  const SCOPE = [{
    n: '01',
    title: "The job",
    body: 'Supply and install 6 LED downlights in the lounge ceiling — evenly set out and run off your existing wall switch.'
  }, {
    n: '02',
    title: 'Included on every option',
    list: ['Set-out & marking to suit the room', 'Make good around each cut-in', 'Test and a Certificate of Compliance (CCEW)', 'All offcuts and packaging taken away']
  }, {
    n: '03',
    title: 'Timing & access',
    body: "About half a day on site. We'll need roof-space access and the lighting circuit off for roughly an hour. We'll lock in a time that suits once the deposit's in."
  }];
  const ASSUMPTIONS = ['Existing ceiling wiring is sound and to standard', 'Clear roof-space access — no full insulation removal', 'No asbestos present in the ceiling', 'Ceiling patching or painting is not included'];
  const mono = (extra = {}) => ({
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    ...extra
  });

  /* ─── Letterhead ──────────────────────────────────────────────────── */
  function Letterhead() {
    return /*#__PURE__*/React.createElement("header", {
      style: {
        borderBottom: '1px solid var(--ink-line)',
        padding: '20px 22px',
        background: 'var(--ink-card)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-grid',
        placeItems: 'center',
        width: 42,
        height: 42,
        background: 'var(--accent)',
        color: 'var(--accent-ink)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "zap",
      size: 22
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "qm-display",
      style: {
        fontSize: 19,
        color: 'var(--text-pri)',
        lineHeight: 1
      }
    }, BIZ.name), /*#__PURE__*/React.createElement("div", {
      style: mono({
        marginTop: 5,
        fontSize: 9.5,
        color: 'var(--text-dim)'
      })
    }, "Licensed electrician \xB7 ", BIZ.licence))), /*#__PURE__*/React.createElement("a", {
      href: `tel:${BIZ.number.replace(/\s/g, '')}`,
      "aria-label": "Call",
      style: {
        display: 'inline-grid',
        placeItems: 'center',
        width: 40,
        height: 40,
        border: '1px solid var(--ink-line)',
        color: 'var(--text-sec)',
        textDecoration: 'none',
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "phone",
      size: 17
    }))));
  }

  /* ─── Quote header ────────────────────────────────────────────────── */
  function QuoteHead() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        position: 'relative',
        overflow: 'hidden',
        borderBottom: '1px solid var(--ink-line)',
        background: 'var(--ink-deep)'
      }
    }, /*#__PURE__*/React.createElement(Topography, {
      opacity: 0.14
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative',
        zIndex: 1,
        padding: '28px 22px 30px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      color: "var(--accent)",
      style: {
        fontSize: 10
      }
    }, "Quote ", QUOTE.id), /*#__PURE__*/React.createElement(StatusPill, {
      tone: "review"
    }, "Awaiting you")), /*#__PURE__*/React.createElement("h1", {
      className: "qm-display",
      style: {
        margin: '16px 0 0',
        fontSize: 34,
        lineHeight: 0.98,
        color: 'var(--text-pri)'
      }
    }, "6 downlights,", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "lounge.")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '18px 0 0',
        fontSize: 15.5,
        lineHeight: 1.55,
        color: 'var(--text-sec)'
      }
    }, "G'day ", QUOTE.customer, " \u2014 here's three ways we can do it. Pick what suits and pay the deposit to lock it in. No deposit, no obligation."), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 18,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Badge, null, "Issued ", QUOTE.issued), /*#__PURE__*/React.createElement(Badge, null, "Valid until ", QUOTE.valid))));
  }

  /* ─── Scope of works ──────────────────────────────────────────────── */
  function NumberedSection({
    n,
    title,
    body,
    list
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 18,
        padding: '22px 0',
        borderTop: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true",
      style: {
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 30,
        lineHeight: 0.85,
        color: 'var(--accent)'
      }
    }, n), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "qm-display",
      style: {
        margin: 0,
        fontSize: 16,
        color: 'var(--text-pri)'
      }
    }, title), body ? /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '9px 0 0',
        fontSize: 14,
        lineHeight: 1.55,
        color: 'var(--text-sec)'
      }
    }, body) : null, list ? /*#__PURE__*/React.createElement("ul", {
      style: {
        listStyle: 'none',
        margin: '12px 0 0',
        padding: 0,
        display: 'grid',
        gap: 9
      }
    }, list.map(it => /*#__PURE__*/React.createElement("li", {
      key: it,
      style: {
        display: 'flex',
        gap: 11,
        fontSize: 14,
        lineHeight: 1.45,
        color: 'var(--text-sec)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 15,
      color: "var(--accent)",
      style: {
        flexShrink: 0,
        marginTop: 2
      }
    }), it))) : null));
  }
  function Scope() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        padding: '8px 22px 22px'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 10
      }
    }, "Scope of works"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 6
      }
    }, SCOPE.map(s => /*#__PURE__*/React.createElement(NumberedSection, _extends({
      key: s.n
    }, s)))));
  }

  /* ─── Tiers ───────────────────────────────────────────────────────── */
  function TierList() {
    const [paid, setPaid] = useState(null); // tier name once a deposit is paid
    return /*#__PURE__*/React.createElement("section", {
      id: "options",
      style: {
        padding: '26px 22px',
        borderTop: '1px solid var(--ink-line)',
        background: 'var(--ink-deep)'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      color: "var(--accent)",
      style: {
        fontSize: 10
      }
    }, "Choose your option"), /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: '10px 0 0',
        fontSize: 22,
        color: 'var(--text-pri)'
      }
    }, "Good \xB7 Better \xB7 Best"), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '10px 0 0',
        fontSize: 13.5,
        lineHeight: 1.5,
        color: 'var(--text-dim)'
      }
    }, "All prices include GST. Deposit is 30% and comes off the final invoice."), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 20,
        display: 'grid',
        gap: 14
      }
    }, TIERS.map(t => /*#__PURE__*/React.createElement(TierCard, {
      key: t.tier,
      tier: t.tier,
      blurb: t.blurb,
      priceIncGst: t.price,
      depositAmount: t.deposit,
      depositPct: 30,
      recommended: t.recommended,
      paid: paid === t.tier,
      disabled: paid && paid !== t.tier,
      ctaLabel: `Pay ${aud(t.deposit)} deposit`,
      onPay: e => {
        e.preventDefault();
        setPaid(t.tier);
      }
    }, /*#__PURE__*/React.createElement("ul", {
      style: {
        listStyle: 'none',
        margin: '14px 0 0',
        padding: 0,
        display: 'grid',
        gap: 9
      }
    }, t.items.map(it => /*#__PURE__*/React.createElement("li", {
      key: it,
      style: {
        display: 'flex',
        gap: 10,
        fontSize: 13.5,
        lineHeight: 1.4,
        color: 'var(--text-sec)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 14,
      color: "var(--accent)",
      style: {
        flexShrink: 0,
        marginTop: 2
      }
    }), it)))))), paid ? /*#__PURE__*/React.createElement("div", {
      role: "status",
      style: {
        marginTop: 18,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)',
        background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)',
        padding: '16px 18px'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check-check",
      size: 18,
      color: "var(--success-bright)",
      style: {
        flexShrink: 0,
        marginTop: 1
      }
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: mono({
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--success-bright)'
      })
    }, TIERS.find(t => t.tier === paid).tier, " option booked"), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '6px 0 0',
        fontSize: 13.5,
        lineHeight: 1.5,
        color: 'var(--text-sec)'
      }
    }, "Nice one, ", QUOTE.customer, ". ", BIZ.owner, " will text to lock in a time. Your receipt is on its way."))) : null);
  }

  /* ─── Assumptions / the honest bit ────────────────────────────────── */
  function Assumptions() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        padding: '24px 22px',
        borderTop: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 10
      }
    }, "Good to know"), /*#__PURE__*/React.createElement("ul", {
      style: {
        listStyle: 'none',
        margin: '14px 0 0',
        padding: 0,
        display: 'grid',
        gap: 11
      }
    }, ASSUMPTIONS.map(a => /*#__PURE__*/React.createElement("li", {
      key: a,
      style: {
        display: 'flex',
        gap: 11,
        fontSize: 13.5,
        lineHeight: 1.45,
        color: 'var(--text-sec)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true",
      style: {
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)',
        flexShrink: 0
      }
    }, "\u25CB"), a))), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '16px 0 0',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--text-dim)'
      }
    }, "Anything unexpected behind the plaster, we'll stop and talk it through before doing more \u2014 never a surprise on the invoice."));
  }

  /* ─── Compliance footer ───────────────────────────────────────────── */
  function Footer() {
    const rows = [['Licensed contractor', `${BIZ.name} · ${BIZ.licence}`], ['ABN', BIZ.abn], ['Insurance', 'Public liability to $20m'], ['Terms', 'GST included · deposit refundable to 48 hrs before booking']];
    return /*#__PURE__*/React.createElement("footer", {
      style: {
        padding: '24px 22px 30px',
        borderTop: '1px solid var(--ink-line)',
        background: 'var(--ink-card)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gap: 1,
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-line)'
      }
    }, rows.map(([k, v]) => /*#__PURE__*/React.createElement("div", {
      key: k,
      style: {
        display: 'grid',
        gridTemplateColumns: '110px 1fr',
        gap: 12,
        padding: '11px 14px',
        background: 'var(--ink-card)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 9.5,
        color: 'var(--text-dim)'
      })
    }, k), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: 'var(--text-sec)',
        lineHeight: 1.4
      }
    }, v)))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 9.5,
        color: 'var(--text-dim)'
      })
    }, "Quote prepared by"), /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/logos/quotemax-mark.svg",
      width: 18,
      height: 18,
      alt: "",
      style: {
        display: 'block'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-sans)',
        fontWeight: 800,
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: '-0.01em',
        color: 'var(--text-sec)'
      }
    }, "QuoteMax"))));
  }

  /* ─── Page ────────────────────────────────────────────────────────── */
  function QuotePage() {
    useLucide();
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-q-page qm-grain"
    }, /*#__PURE__*/React.createElement(Letterhead, null), /*#__PURE__*/React.createElement(QuoteHead, null), /*#__PURE__*/React.createElement(Scope, null), /*#__PURE__*/React.createElement(TierList, null), /*#__PURE__*/React.createElement(Assumptions, null), /*#__PURE__*/React.createElement(Footer, null), /*#__PURE__*/React.createElement(Marquee, {
      items: ['Pick a tier', 'Pay the deposit', "We'll book it in", 'CCEW supplied', 'Licensed & insured'],
      fontSize: 14,
      speed: 30
    }));
  }
  ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(QuotePage, null));
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/customer-quote/quote.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/dashboard.jsx
try { (() => {
/* QuoteMax — Tradie dashboard (CRM + quote review). Composes window.QMUI.
   A single sparky's command centre: review QuoteMax-drafted quotes, approve &
   send, manage the pricing book and services, read SMS conversations. */
(function () {
  const {
    useState
  } = React;
  const {
    Logo,
    Eyebrow,
    Btn,
    Badge,
    StatusPill,
    Stat,
    Avatar,
    Icon,
    useLucide,
    aud,
    Thread
  } = window.QMUI;

  /* ─── Business identity (the tradie using QuoteMax) ───────────────── */
  const BIZ = {
    name: 'Hartley Electrical',
    owner: 'Dave Hartley',
    region: 'Sydney · NSW',
    licence: 'NSW EC 89421',
    abn: '54 219 887 663',
    number: '0480 102 030'
  };

  /* ─── Sidebar nav ─────────────────────────────────────────────────── */
  const NAV = [{
    id: 'overview',
    label: 'Overview',
    icon: 'layout-dashboard'
  }, {
    id: 'quotes',
    label: 'Quotes',
    icon: 'file-text',
    badge: 2
  }, {
    id: 'pricing',
    label: 'Pricing book',
    icon: 'book-open'
  }, {
    id: 'services',
    label: 'Services',
    icon: 'wrench'
  }, {
    id: 'chats',
    label: 'Chats',
    icon: 'message-square'
  }];

  /* ─── Status mapping for the queue ────────────────────────────────── */
  const STATUS = {
    review: {
      tone: 'review',
      label: 'Review'
    },
    sent: {
      tone: 'live',
      label: 'Sent'
    },
    sitevisit: {
      tone: 'neutral',
      label: 'Site visit'
    },
    paid: {
      tone: 'paid',
      label: 'Deposit paid'
    },
    declined: {
      tone: 'error',
      label: 'Declined'
    }
  };

  /* ─── Quote queue data ────────────────────────────────────────────── */
  const TIERS = [{
    tier: 'Standard',
    price: 890,
    deposit: 267,
    what: '6× dimmable LED downlights, warm white. Like-for-like, existing wiring.'
  }, {
    tier: 'Recommended',
    price: 1180,
    deposit: 354,
    recommended: true,
    what: '6× CCT-selectable downlights, dimmable. 5-year warranty, tidy cut-ins.'
  }, {
    tier: 'Premium',
    price: 1540,
    deposit: 462,
    what: '6× smart app-controlled downlights, individual dimming. 7-year warranty.'
  }];
  const LINE_ITEMS = [{
    d: 'Premium CCT downlight — supply + install',
    q: 6,
    rate: 190
  }, {
    d: 'Dimmer module (LED-rated)',
    q: 1,
    rate: 90
  }, {
    d: 'Make good + test, single circuit',
    q: 1,
    rate: 100
  }];
  const TRANSCRIPT = [{
    from: 'customer',
    text: "Hey mate, need 6 downlights in the lounge. What's it cost?"
  }, {
    from: 'quotemax',
    text: 'All new fittings, or swapping existing? And is there roof-space access?'
  }, {
    from: 'customer',
    text: 'All new. Roof access is easy.'
  }, {
    from: 'quotemax',
    text: 'Beauty. Drafting three options now — Dave will confirm and send shortly.'
  }];
  const QUOTES = [{
    id: 'Q-1043',
    name: 'Sarah Whitlam',
    suburb: 'Ashfield',
    job: '6× LED downlights — lounge',
    value: 1180,
    status: 'review',
    updated: '4 min ago',
    detail: true
  }, {
    id: 'Q-1042',
    name: 'Marco Felipe',
    suburb: 'Marrickville',
    job: '2× ceiling fans + 3 GPOs',
    value: 940,
    status: 'sent',
    updated: '1 hr ago'
  }, {
    id: 'Q-1041',
    name: 'The Dorrigo Hotel',
    suburb: 'Newtown',
    job: 'Switchboard upgrade',
    value: null,
    status: 'sitevisit',
    updated: '3 hr ago'
  }, {
    id: 'Q-1040',
    name: 'Jen Alcorta',
    suburb: 'Petersham',
    job: 'Smoke alarm compliance ×4',
    value: 560,
    status: 'paid',
    updated: 'Yesterday'
  }, {
    id: 'Q-1039',
    name: 'Colin Reedy',
    suburb: 'Stanmore',
    job: 'Outdoor lighting + GPO',
    value: 720,
    status: 'review',
    updated: 'Yesterday'
  }, {
    id: 'Q-1038',
    name: 'Priya Naidu',
    suburb: 'Enmore',
    job: 'Oven + cooktop circuit',
    value: null,
    status: 'declined',
    updated: '2 days ago'
  }];
  const RATES = [['Standard LED downlight — supply + install', 'each', 145], ['Premium CCT downlight — supply + install', 'each', 190], ['Power point / GPO (new)', 'each', 165], ['Ceiling fan install (existing point)', 'each', 240], ['Smoke alarm — 240V photoelectric', 'each', 140], ['Outdoor wall light', 'each', 185], ['Callout + first hour', 'job', 120], ['Site visit — complex jobs', 'fixed', 99]];
  const ACTIVITY = [{
    icon: 'check-check',
    text: 'Jen Alcorta paid a $168 deposit',
    sub: 'Smoke alarm compliance ×4 · booked',
    tone: 'var(--success-bright)'
  }, {
    icon: 'send',
    text: 'Quote sent to Marco Felipe',
    sub: '2× ceiling fans + 3 GPOs · $940',
    tone: 'var(--text-sec)'
  }, {
    icon: 'phone-incoming',
    text: 'Site visit booked — The Dorrigo Hotel',
    sub: 'Switchboard upgrade · $99 paid',
    tone: 'var(--text-sec)'
  }, {
    icon: 'sparkles',
    text: 'QuoteMax drafted a quote for Sarah Whitlam',
    sub: '6× LED downlights · 38s · needs review',
    tone: 'var(--accent)'
  }];
  const px = n => `${n}px`;
  const mono = (extra = {}) => ({
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    ...extra
  });

  /* ─── Sidebar ─────────────────────────────────────────────────────── */
  function Sidebar({
    view,
    setView
  }) {
    return /*#__PURE__*/React.createElement("aside", {
      className: "qm-dash-side",
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--ink-line)',
        background: 'var(--ink)',
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '20px 20px 18px',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement(Logo, {
      size: 32,
      sub: "Dashboard"
    })), /*#__PURE__*/React.createElement("nav", {
      style: {
        display: 'grid',
        gap: 4,
        padding: 12,
        flex: 1
      }
    }, NAV.map(n => {
      const active = n.id === view;
      return /*#__PURE__*/React.createElement("button", {
        key: n.id,
        type: "button",
        onClick: () => setView(n.id),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          border: '1px solid',
          borderColor: active ? 'color-mix(in srgb, var(--accent) 40%, var(--ink-line))' : 'transparent',
          background: active ? 'var(--ink-card)' : 'transparent',
          color: active ? 'var(--text-pri)' : 'var(--text-sec)',
          padding: '11px 12px',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          fontWeight: active ? 700 : 500,
          position: 'relative'
        }
      }, /*#__PURE__*/React.createElement("span", {
        "aria-hidden": "true",
        style: {
          position: 'absolute',
          left: 0,
          top: 8,
          bottom: 8,
          width: 2,
          background: active ? 'var(--accent)' : 'transparent'
        }
      }), /*#__PURE__*/React.createElement(Icon, {
        name: n.icon,
        size: 18,
        color: active ? 'var(--accent)' : 'var(--text-dim)'
      }), /*#__PURE__*/React.createElement("span", {
        style: {
          flex: 1
        }
      }, n.label), n.badge ? /*#__PURE__*/React.createElement("span", {
        style: mono({
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--accent-ink)',
          background: 'var(--accent)',
          padding: '2px 7px'
        })
      }, n.badge) : null);
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        borderTop: '1px solid var(--ink-line)',
        padding: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      name: BIZ.owner,
      tone: "accent",
      size: 40
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        fontSize: 14,
        color: 'var(--text-pri)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    }, BIZ.name), /*#__PURE__*/React.createElement("div", {
      style: mono({
        fontSize: 10,
        color: 'var(--text-dim)'
      })
    }, BIZ.licence)))));
  }

  /* ─── Top bar ─────────────────────────────────────────────────────── */
  function ThemeToggle() {
    const [t, setT] = useState('dark');
    React.useEffect(() => {
      document.documentElement.setAttribute('data-theme', t);
    }, [t]);
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      "aria-label": "Toggle theme",
      onClick: () => setT(p => p === 'dark' ? 'light' : 'dark'),
      style: {
        display: 'inline-grid',
        placeItems: 'center',
        width: 40,
        height: 40,
        border: '1px solid var(--ink-line)',
        background: 'transparent',
        color: 'var(--text-sec)',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: t === 'dark' ? 'sun' : 'moon',
      size: 17
    }));
  }
  function Topbar({
    title,
    sub
  }) {
    return /*#__PURE__*/React.createElement("header", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        borderBottom: '1px solid var(--ink-line)',
        padding: '16px 28px',
        background: 'color-mix(in srgb, var(--ink-deep) 80%, transparent)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 20
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
      className: "qm-display",
      style: {
        margin: 0,
        fontSize: 26,
        color: 'var(--text-pri)'
      }
    }, title), sub ? /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '4px 0 0',
        fontSize: 13,
        color: 'var(--text-dim)'
      }
    }, sub) : null), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid var(--ink-line)',
        padding: '9px 13px',
        color: 'var(--text-sec)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "phone",
      size: 15,
      color: "var(--accent)"
    }), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 12,
        color: 'var(--text-pri)',
        letterSpacing: '0.1em'
      })
    }, BIZ.number)), /*#__PURE__*/React.createElement(ThemeToggle, null), /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      size: "md",
      withArrow: true
    }, "New quote")));
  }

  /* ─── KPI row ──────────────────────────────────────────────────────── */
  const KPIS = [{
    value: '23',
    label: 'Quotes this week'
  }, {
    value: '2',
    label: 'Awaiting review',
    accent: 'var(--warning-bright)'
  }, {
    value: '$3,240',
    label: 'Deposits collected'
  }, {
    value: '38s',
    label: 'Avg draft time'
  }];
  function KpiRow() {
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-kpi-row",
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        gap: 1,
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-line)'
      }
    }, KPIS.map(k => /*#__PURE__*/React.createElement("div", {
      key: k.label,
      className: "qm-edge-lit",
      style: {
        background: 'var(--ink-card)',
        padding: '22px 24px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 36,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        fontVariantNumeric: 'tabular-nums',
        color: k.accent || 'var(--accent)'
      }
    }, k.value), /*#__PURE__*/React.createElement("div", {
      style: mono({
        marginTop: 10,
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-dim)'
      })
    }, k.label))));
  }

  /* ─── Queue row ───────────────────────────────────────────────────── */
  function QueueRow({
    q,
    active,
    onClick
  }) {
    const [h, setH] = useState(false);
    const s = STATUS[q.status];
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: onClick,
      onMouseEnter: () => setH(true),
      onMouseLeave: () => setH(false),
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 14,
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        border: 0,
        borderLeft: '2px solid',
        borderLeftColor: active ? 'var(--accent)' : 'transparent',
        borderBottom: '1px solid var(--ink-line)',
        background: active ? 'var(--ink)' : h ? 'color-mix(in srgb, var(--ink) 55%, transparent)' : 'transparent',
        padding: '16px 20px',
        transition: 'background-color .15s ease'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        fontSize: 15,
        color: 'var(--text-pri)'
      }
    }, q.name), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 10,
        color: 'var(--text-dim)'
      })
    }, q.id)), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 4,
        fontSize: 13.5,
        color: 'var(--text-sec)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    }, q.job), /*#__PURE__*/React.createElement("div", {
      style: mono({
        marginTop: 7,
        fontSize: 10,
        color: 'var(--text-dim)'
      })
    }, q.suburb, " \xB7 ", q.updated)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 16,
        color: q.value ? 'var(--text-pri)' : 'var(--text-dim)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, q.value ? aud(q.value) : '—'), /*#__PURE__*/React.createElement(StatusPill, {
      tone: s.tone,
      pulse: q.status === 'review'
    }, s.label)));
  }

  /* ─── Quote detail (Good / Better / Best review) ──────────────────── */
  function ReviewTier({
    t
  }) {
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-edge-lit",
      style: {
        position: 'relative',
        background: 'var(--ink-card)',
        border: '1px solid',
        borderColor: t.recommended ? 'var(--accent)' : 'var(--ink-line)',
        padding: '18px 18px 20px'
      }
    }, t.recommended ? /*#__PURE__*/React.createElement("span", {
      style: mono({
        position: 'absolute',
        top: -1,
        left: 0,
        fontSize: 9,
        fontWeight: 700,
        color: 'var(--accent-ink)',
        background: 'var(--accent)',
        padding: '4px 9px'
      })
    }, "Recommended") : null, /*#__PURE__*/React.createElement("div", {
      style: mono({
        marginTop: t.recommended ? 12 : 0,
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--accent)'
      })
    }, t.tier), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 24,
        color: 'var(--text-pri)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, aud(t.price)), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 3,
        fontSize: 12,
        color: 'var(--text-dim)'
      }
    }, "Deposit ", aud(t.deposit), " \xB7 30%"), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '12px 0 0',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--text-sec)'
      }
    }, t.what));
  }
  function QuoteDetail({
    q
  }) {
    const [sent, setSent] = useState(false);
    if (!q || !q.detail) {
      return /*#__PURE__*/React.createElement("div", {
        className: "qm-dash-detail",
        style: {
          borderLeft: '1px solid var(--ink-line)',
          display: 'grid',
          placeItems: 'center',
          padding: 40,
          minHeight: 400
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: 'center',
          maxWidth: 280
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "file-text",
        size: 30,
        color: "var(--text-dim)"
      }), /*#__PURE__*/React.createElement("p", {
        style: {
          margin: '14px 0 0',
          fontSize: 14,
          color: 'var(--text-dim)'
        }
      }, "Select a quote from the queue to review the Good / Better / Best options QuoteMax drafted.")));
    }
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-dash-detail qm-scroll",
      style: {
        borderLeft: '1px solid var(--ink-line)',
        overflowY: 'auto',
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '22px 24px',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Eyebrow, {
      color: "var(--accent)",
      style: {
        fontSize: 10
      }
    }, "Drafted \xB7 38s \xB7 ", q.id), /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: '8px 0 0',
        fontSize: 24,
        color: 'var(--text-pri)'
      }
    }, q.name), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '4px 0 0',
        fontSize: 13.5,
        color: 'var(--text-sec)'
      }
    }, q.job, " \xB7 ", q.suburb)), /*#__PURE__*/React.createElement(StatusPill, {
      tone: "review",
      pulse: true
    }, "Review"))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '22px 24px',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 10
      }
    }, "Options drafted from your pricing book"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14,
        display: 'grid',
        gridTemplateColumns: 'repeat(3,1fr)',
        gap: 12
      }
    }, TIERS.map(t => /*#__PURE__*/React.createElement(ReviewTier, {
      key: t.tier,
      t: t
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '22px 24px',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 10
      }
    }, "Recommended \u2014 line items"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12,
        border: '1px solid var(--ink-line)'
      }
    }, LINE_ITEMS.map((li, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        alignItems: 'center',
        gap: 16,
        padding: '12px 16px',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13.5,
        color: 'var(--text-sec)'
      }
    }, li.d), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 11,
        color: 'var(--text-dim)'
      })
    }, li.q, " \xD7 ", aud(li.rate)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 13.5,
        color: 'var(--text-pri)',
        fontVariantNumeric: 'tabular-nums',
        minWidth: 56,
        textAlign: 'right'
      }
    }, aud(li.q * li.rate)))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '13px 16px',
        background: 'var(--ink)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-dim)'
      })
    }, "Total inc GST"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 18,
        color: 'var(--accent)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, aud(1180))))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '22px 24px',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 10
      }
    }, "How QuoteMax intook the job"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement(Thread, {
      messages: TRANSCRIPT,
      header: false
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '20px 24px',
        position: 'sticky',
        bottom: 0,
        background: 'var(--ink-deep)',
        borderTop: '1px solid var(--ink-line)'
      }
    }, sent ? /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)',
        background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)',
        color: 'var(--success-bright)',
        padding: '14px',
        ...mono({
          fontSize: 12,
          fontWeight: 700
        })
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check-check",
      size: 16
    }), " Sent to ", q.name.split(' ')[0]) : /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      withArrow: true,
      fullWidth: true,
      onClick: () => setSent(true)
    }, "Approve & send"), /*#__PURE__*/React.createElement(Btn, {
      variant: "secondary"
    }, "Edit"))));
  }

  /* ─── Quotes view (master / detail) ───────────────────────────────── */
  function QuotesView() {
    const [sel, setSel] = useState('Q-1043');
    const active = QUOTES.find(q => q.id === sel);
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-dash-main",
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(380px, 0.85fr) 1.15fr',
        minHeight: 0,
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "qm-scroll",
      style: {
        overflowY: 'auto',
        borderRight: '0',
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: '1px solid var(--ink-line)',
        position: 'sticky',
        top: 0,
        background: 'var(--ink-deep)',
        zIndex: 5
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 11
      }
    }, "Quote queue \xB7 ", QUOTES.length), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 10,
        color: 'var(--text-dim)'
      })
    }, "Newest first")), QUOTES.map(q => /*#__PURE__*/React.createElement(QueueRow, {
      key: q.id,
      q: q,
      active: q.id === sel,
      onClick: () => setSel(q.id)
    }))), /*#__PURE__*/React.createElement(QuoteDetail, {
      q: active
    }));
  }

  /* ─── Overview view ───────────────────────────────────────────────── */
  function Overview() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 28,
        display: 'grid',
        gap: 24
      }
    }, /*#__PURE__*/React.createElement(KpiRow, null), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1.3fr 1fr',
        gap: 24
      },
      className: "qm-overview-grid"
    }, /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 11
      }
    }, "Needs your review"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14,
        border: '1px solid var(--ink-line)'
      }
    }, QUOTES.filter(q => q.status === 'review').map(q => /*#__PURE__*/React.createElement("div", {
      key: q.id,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '16px 18px',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        fontSize: 15,
        color: 'var(--text-pri)'
      }
    }, q.name), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 3,
        fontSize: 13,
        color: 'var(--text-sec)'
      }
    }, q.job, " \xB7 ", q.suburb)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 15,
        color: 'var(--text-pri)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, aud(q.value)), /*#__PURE__*/React.createElement(Btn, {
      variant: "secondary",
      size: "sm"
    }, "Review")))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '14px 18px',
        background: 'var(--ink)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 11,
        color: 'var(--text-dim)'
      })
    }, "QuoteMax answered 11 messages while you were on the tools today.")))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 11
      }
    }, "This week"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14,
        display: 'grid',
        gap: 1,
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-line)'
      }
    }, ACTIVITY.map((a, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        gap: 13,
        padding: '15px 16px',
        background: 'var(--ink-card)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-grid',
        placeItems: 'center',
        width: 30,
        height: 30,
        flexShrink: 0,
        border: '1px solid var(--ink-line)',
        color: a.tone
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: a.icon,
      size: 15
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        color: 'var(--text-pri)',
        lineHeight: 1.4
      }
    }, a.text), /*#__PURE__*/React.createElement("div", {
      style: mono({
        marginTop: 4,
        fontSize: 10,
        color: 'var(--text-dim)'
      })
    }, a.sub))))))));
  }

  /* ─── Pricing book view ───────────────────────────────────────────── */
  function PricingView() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 28
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        maxWidth: '52ch',
        fontSize: 15,
        lineHeight: 1.6,
        color: 'var(--text-sec)'
      }
    }, "Your rates, your call. QuoteMax only ever quotes from this book \u2014 nothing leaves without your prices behind it."), /*#__PURE__*/React.createElement(Btn, {
      variant: "secondary",
      size: "md"
    }, "Edit rates")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 24,
        border: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: 16,
        padding: '13px 20px',
        background: 'var(--ink)',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-dim)'
      })
    }, "Service"), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-dim)'
      })
    }, "Unit"), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-dim)',
        minWidth: 90,
        textAlign: 'right'
      })
    }, "Rate inc GST")), RATES.map(([d, unit, rate], i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        alignItems: 'center',
        gap: 16,
        padding: '14px 20px',
        borderBottom: i < RATES.length - 1 ? '1px solid var(--ink-line)' : 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        color: 'var(--text-pri)'
      }
    }, d), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 11,
        color: 'var(--text-dim)'
      })
    }, unit), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 15,
        fontWeight: 700,
        color: 'var(--accent)',
        fontVariantNumeric: 'tabular-nums',
        minWidth: 90,
        textAlign: 'right'
      }
    }, aud(rate))))));
  }

  /* ─── Services view ───────────────────────────────────────────────── */
  function ServiceCard({
    label,
    region,
    live,
    auto,
    visit
  }) {
    const [on, setOn] = useState(live);
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-edge-lit",
      style: {
        background: 'var(--ink-card)',
        border: '1px solid var(--ink-line)',
        padding: 28,
        opacity: on ? 1 : 0.62
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
      className: "qm-display",
      style: {
        margin: 0,
        fontSize: 24,
        color: 'var(--text-pri)'
      }
    }, label), /*#__PURE__*/React.createElement("span", {
      style: mono({
        fontSize: 11,
        color: 'var(--text-dim)'
      })
    }, region)), /*#__PURE__*/React.createElement("button", {
      type: "button",
      role: "switch",
      "aria-checked": on,
      onClick: () => setOn(v => !v),
      style: {
        width: 52,
        height: 28,
        border: '1px solid var(--ink-line)',
        background: on ? 'var(--accent)' : 'var(--ink)',
        cursor: 'pointer',
        position: 'relative',
        padding: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true",
      style: {
        position: 'absolute',
        top: 2,
        left: on ? 26 : 2,
        width: 22,
        height: 22,
        background: on ? 'var(--accent-ink)' : 'var(--text-dim)',
        transition: 'left .2s var(--ease-out-expo)'
      }
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 22
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      color: "var(--accent)",
      style: {
        fontSize: 10
      }
    }, "Auto-quoted"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8
      }
    }, auto.map(a => /*#__PURE__*/React.createElement(Badge, {
      key: a,
      tone: "neutral"
    }, a)))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 18
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 10
      }
    }, "Books a $99 site visit"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8
      }
    }, visit.map(a => /*#__PURE__*/React.createElement(Badge, {
      key: a,
      tone: "neutral"
    }, a)))));
  }
  function ServicesView() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 28,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 20
      },
      className: "qm-services-grid"
    }, /*#__PURE__*/React.createElement(ServiceCard, {
      label: "Electrical",
      region: "NSW \xB7 Live",
      live: true,
      auto: ['Downlights', 'GPOs', 'Ceiling fans', 'Smoke alarms', 'Outdoor lighting'],
      visit: ['Switchboard upgrade', 'EV charger', 'Fault finding', 'Oven / cooktop']
    }), /*#__PURE__*/React.createElement(ServiceCard, {
      label: "Plumbing",
      region: "Add a second trade",
      live: false,
      auto: ['Blocked drains', 'Hot water', 'Tap repair', 'Toilet repair'],
      visit: ['Gas fitting', 'Burst pipe', 'Bathroom reno']
    }));
  }

  /* ─── Chats view ──────────────────────────────────────────────────── */
  const CHATS = {
    'Sarah Whitlam': [...TRANSCRIPT],
    'Marco Felipe': [{
      from: 'customer',
      text: 'After 2 ceiling fans in the bedrooms and a few extra power points.'
    }, {
      from: 'quotemax',
      text: 'How many GPOs, and are the fan points already there?'
    }, {
      from: 'customer',
      text: '3 points. Fan wiring is in, just need the fans hung.'
    }, {
      from: 'quotemax',
      text: "Got it. Quote's drafted — $940. Dave will send it through shortly."
    }],
    'Colin Reedy': [{
      from: 'customer',
      text: 'Need some lights out the back and a weatherproof power point.'
    }, {
      from: 'quotemax',
      text: 'How many lights, and is there power nearby to run off?'
    }, {
      from: 'customer',
      text: '2 wall lights and 1 outdoor GPO. Power is in the shed.'
    }]
  };
  function ChatsView() {
    const names = Object.keys(CHATS);
    const [sel, setSel] = useState(names[0]);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(240px, 0.7fr) 1.3fr',
        minHeight: 0,
        flex: 1
      },
      className: "qm-chats-grid"
    }, /*#__PURE__*/React.createElement("div", {
      className: "qm-scroll",
      style: {
        borderRight: '1px solid var(--ink-line)',
        overflowY: 'auto',
        minHeight: 0
      }
    }, names.map(n => {
      const last = CHATS[n][CHATS[n].length - 1];
      const active = n === sel;
      return /*#__PURE__*/React.createElement("button", {
        key: n,
        type: "button",
        onClick: () => setSel(n),
        style: {
          display: 'block',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          border: 0,
          borderLeft: '2px solid',
          borderLeftColor: active ? 'var(--accent)' : 'transparent',
          borderBottom: '1px solid var(--ink-line)',
          background: active ? 'var(--ink)' : 'transparent',
          padding: '16px 18px'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 11
        }
      }, /*#__PURE__*/React.createElement(Avatar, {
        name: n,
        tone: active ? 'accent' : 'ink',
        size: 34
      }), /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: 'var(--font-sans)',
          fontWeight: 700,
          fontSize: 14,
          color: 'var(--text-pri)'
        }
      }, n)), /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: 8,
          fontSize: 12.5,
          color: 'var(--text-dim)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }
      }, last.from === 'quotemax' ? 'QuoteMax: ' : '', last.text));
    })), /*#__PURE__*/React.createElement("div", {
      className: "qm-scroll",
      style: {
        overflowY: 'auto',
        padding: 24,
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement(Thread, {
      messages: CHATS[sel],
      label: `${sel} · SMS intake`
    })));
  }

  /* ─── Shell ───────────────────────────────────────────────────────── */
  const VIEWS = {
    overview: {
      title: 'Overview',
      sub: `${BIZ.name} · ${BIZ.region}`,
      comp: Overview
    },
    quotes: {
      title: 'Quotes',
      sub: 'Review what QuoteMax drafted, then approve & send',
      comp: QuotesView
    },
    pricing: {
      title: 'Pricing book',
      sub: 'The rates every quote is built from',
      comp: PricingView
    },
    services: {
      title: 'Services',
      sub: 'What auto-quotes and what books a site visit',
      comp: ServicesView
    },
    chats: {
      title: 'Chats',
      sub: 'Every conversation QuoteMax handled for you',
      comp: ChatsView
    }
  };
  function Dashboard() {
    const [view, setView] = useState('quotes');
    useLucide(view);
    const V = VIEWS[view];
    const Body = V.comp;
    const flush = view === 'quotes' || view === 'chats';
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-dash-shell qm-grain",
      style: {
        display: 'grid',
        gridTemplateColumns: '248px 1fr',
        height: '100%',
        background: 'var(--ink-deep)',
        color: 'var(--text-pri)'
      }
    }, /*#__PURE__*/React.createElement(Sidebar, {
      view: view,
      setView: setView
    }), /*#__PURE__*/React.createElement("main", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement(Topbar, {
      title: V.title,
      sub: V.sub
    }), flush ? /*#__PURE__*/React.createElement(Body, null) : /*#__PURE__*/React.createElement("div", {
      className: "qm-scroll",
      style: {
        overflowY: 'auto',
        flex: 1
      }
    }, /*#__PURE__*/React.createElement(Body, null))));
  }
  ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(Dashboard, null));
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/marketing.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* QuoteMax — Marketing / pricing site recreation. Composes window.QMUI. */
(function () {
  const {
    useState,
    useEffect,
    useRef
  } = React;
  const {
    Logo,
    Eyebrow,
    Btn,
    Badge,
    StatusPill,
    Stat,
    Card,
    NumberedCard,
    Segmented,
    Marquee,
    Topography,
    Icon,
    useLucide
  } = window.QMUI;
  const MAXW = 1408; // 88rem

  /* ─── Theme toggle — demonstrates the warm-paper light flip ───────── */
  function ThemeToggle() {
    const [theme, setTheme] = useState('dark');
    useEffect(() => {
      document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      "aria-label": "Toggle theme",
      onClick: () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
      style: {
        display: 'inline-grid',
        placeItems: 'center',
        width: 44,
        height: 44,
        border: '1px solid var(--ink-line)',
        background: 'transparent',
        color: 'var(--text-sec)',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: theme === 'dark' ? 'sun' : 'moon',
      size: 18
    }));
  }

  /* ─── Nav ─────────────────────────────────────────────────────────── */
  function Nav() {
    const link = {
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--text-sec)',
      textDecoration: 'none'
    };
    return /*#__PURE__*/React.createElement("nav", {
      style: {
        position: 'sticky',
        top: 0,
        zIndex: 50,
        borderBottom: '1px solid var(--ink-line)',
        background: 'color-mix(in srgb, var(--ink-deep) 85%, transparent)',
        backdropFilter: 'blur(12px)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px'
      }
    }, /*#__PURE__*/React.createElement(Logo, {
      size: 36
    }), /*#__PURE__*/React.createElement("div", {
      className: "qm-nav-links",
      style: {
        display: 'flex',
        gap: 32
      }
    }, /*#__PURE__*/React.createElement("a", {
      href: "#how",
      className: "qm-link-underline",
      style: link
    }, "How"), /*#__PURE__*/React.createElement("a", {
      href: "#trades",
      className: "qm-link-underline",
      style: link
    }, "Trades"), /*#__PURE__*/React.createElement("a", {
      href: "#pricing",
      className: "qm-link-underline",
      style: link
    }, "Pricing"), /*#__PURE__*/React.createElement("a", {
      href: "#faq",
      className: "qm-link-underline",
      style: link
    }, "FAQ")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(ThemeToggle, null), /*#__PURE__*/React.createElement(Btn, {
      variant: "ghost",
      size: "sm",
      href: "#"
    }, "Sign in"), /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      size: "sm",
      withArrow: true,
      href: "#pricing"
    }, "Get started"))));
  }

  /* ─── Animated SMS demo ───────────────────────────────────────────── */
  const DEMO = [{
    from: 'customer',
    text: "Hey mate, need 6 downlights in the lounge. What's it cost?",
    at: 500
  }, {
    from: 'quotemax',
    text: 'All new fittings, or swapping existing? And is there roof-space access?',
    at: 1300
  }, {
    from: 'customer',
    text: 'All new. Roof access is easy.',
    at: 2200
  }];
  function AnimatedSms() {
    const [step, setStep] = useState(0); // messages revealed
    const [typing, setTyping] = useState(false);
    const [quote, setQuote] = useState(false);
    useEffect(() => {
      const timers = [];
      DEMO.forEach((m, i) => timers.push(setTimeout(() => setStep(i + 1), m.at)));
      timers.push(setTimeout(() => setTyping(true), 2900));
      timers.push(setTimeout(() => {
        setTyping(false);
        setQuote(true);
      }, 4200));
      return () => timers.forEach(clearTimeout);
    }, []);
    return /*#__PURE__*/React.createElement("div", {
      className: "qm-edge-lit",
      style: {
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-card)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--ink-line)',
        padding: '12px 16px'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 10,
        letterSpacing: '0.16em'
      }
    }, "Live example \xB7 SMS intake"), /*#__PURE__*/React.createElement(StatusPill, {
      tone: "live",
      pulse: true
    }, "Online")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gap: 12,
        padding: '20px 16px',
        minHeight: 220
      }
    }, DEMO.slice(0, step).map((m, i) => /*#__PURE__*/React.createElement(Bubble, _extends({
      key: i
    }, m))), typing ? /*#__PURE__*/React.createElement(Typing, null) : null), quote ? /*#__PURE__*/React.createElement("div", {
      style: {
        borderTop: '1px solid var(--ink-line)',
        background: 'color-mix(in srgb, var(--ink-deep) 50%, transparent)',
        padding: 16,
        animation: 'qm-rise 640ms var(--ease-out-expo) both'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      color: "var(--accent)",
      style: {
        fontSize: 10,
        letterSpacing: '0.16em'
      }
    }, "Quote drafted \xB7 under a minute"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--text-dim)'
      }
    }, "Sample")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12,
        position: 'relative',
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-card)',
        padding: 16,
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true",
      style: {
        position: 'absolute',
        insetInline: 0,
        top: 0,
        height: 2,
        background: 'var(--accent)'
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 22,
        color: 'var(--accent)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, "$890"))) : null);
  }
  function Bubble({
    from,
    text
  }) {
    const inbound = from === 'customer';
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: inbound ? 'flex-start' : 'flex-end',
        animation: 'qm-pop-in 420ms var(--ease-out-expo) both'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '86%',
        border: '1px solid',
        borderColor: inbound ? 'var(--ink-line)' : 'color-mix(in srgb, var(--accent) 35%, transparent)',
        background: inbound ? 'var(--ink-deep)' : 'color-mix(in srgb, var(--accent) 10%, transparent)',
        color: inbound ? 'var(--text-sec)' : 'var(--text-pri)',
        padding: '10px 14px',
        fontSize: 14,
        lineHeight: 1.45
      }
    }, !inbound ? /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        marginBottom: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.16em',
        color: 'var(--accent)'
      }
    }, "QuoteMax") : null, text));
  }
  function Typing() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'qm-pop-in 420ms var(--ease-out-expo) both'
      }
    }, /*#__PURE__*/React.createElement("div", {
      role: "status",
      "aria-label": "QuoteMax is drafting",
      style: {
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
        padding: '12px 14px'
      }
    }, [0, 1, 2].map(d => /*#__PURE__*/React.createElement("span", {
      key: d,
      "aria-hidden": "true",
      style: {
        width: 6,
        height: 6,
        borderRadius: 9999,
        background: 'var(--accent-soft)',
        animation: 'qm-typing-bounce 1.3s ease-in-out infinite',
        animationDelay: `${d * 160}ms`
      }
    }))));
  }

  /* ─── Hero ────────────────────────────────────────────────────────── */
  function HeroTile({
    src,
    caption
  }) {
    return /*#__PURE__*/React.createElement("figure", {
      className: "qm-duotone qm-edge-lit",
      style: {
        margin: 0,
        position: 'relative',
        border: '1px solid var(--ink-line)',
        aspectRatio: '4/5'
      }
    }, /*#__PURE__*/React.createElement("img", {
      className: "qm-duotone__img",
      src: src,
      alt: caption
    }), /*#__PURE__*/React.createElement("figcaption", {
      className: "qm-photo-caption",
      style: {
        position: 'absolute',
        insetInline: 0,
        bottom: 0,
        padding: '24px 10px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.16em'
      }
    }, caption));
  }
  function Hero() {
    const flag = /*#__PURE__*/React.createElement("img", {
      src: "../../assets/icons/au-flag.svg",
      alt: "Australia",
      style: {
        height: 13,
        border: '1px solid color-mix(in srgb, var(--text-pri) 15%, transparent)',
        display: 'block'
      }
    });
    return /*#__PURE__*/React.createElement("section", {
      style: {
        position: 'relative',
        overflow: 'hidden',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement(Topography, null), /*#__PURE__*/React.createElement("div", {
      className: "qm-hero-grid",
      style: {
        position: 'relative',
        zIndex: 1,
        maxWidth: MAXW,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: '1.05fr 0.95fr',
        alignItems: 'center',
        gap: 64,
        padding: '80px 24px'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 20
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      icon: flag
    }, "Built for Australian tradies")), /*#__PURE__*/React.createElement(Eyebrow, null, "QuoteMax \xB7 We do the quoting for you"), /*#__PURE__*/React.createElement("h1", {
      className: "qm-display",
      style: {
        margin: '20px 0 0',
        fontSize: 'var(--display-hero)',
        color: 'var(--text-pri)'
      }
    }, "Drafts your ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "quote"), /*#__PURE__*/React.createElement("br", null), "before they ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "hang up.")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '28px 0 0',
        maxWidth: '34ch',
        fontSize: 18,
        lineHeight: 1.6,
        color: 'var(--text-sec)'
      }
    }, "Customers text your QuoteMax number. QuoteMax asks the right questions, applies your pricing book, and drafts a clean quote in under a minute. You review, tweak, send."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 36
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      size: "lg",
      withArrow: true,
      href: "#pricing"
    }, "Get my QuoteMax"), /*#__PURE__*/React.createElement(Btn, {
      variant: "secondary",
      size: "lg",
      href: "#how"
    }, "See how it works")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3,1fr)',
        gap: 10,
        marginTop: 40
      }
    }, /*#__PURE__*/React.createElement(HeroTile, {
      src: "../../assets/photos/trade-electrical.jpg",
      caption: "Electrical"
    }), /*#__PURE__*/React.createElement(HeroTile, {
      src: "../../assets/photos/trade-plumbing.jpg",
      caption: "Plumbing"
    }), /*#__PURE__*/React.createElement(HeroTile, {
      src: "../../assets/photos/trade-solar.jpg",
      caption: "Solar"
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(AnimatedSms, null))));
  }

  /* ─── Trust strip + powered-by ────────────────────────────────────── */
  function TrustStrip() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        borderBottom: '1px solid var(--ink-line)',
        background: 'color-mix(in srgb, var(--ink) 40%, transparent)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        padding: '28px 24px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Badge, null, "Built in Australia"), /*#__PURE__*/React.createElement(Badge, null, "Electrical pilot \xB7 NSW"), /*#__PURE__*/React.createElement(Badge, null, "Plumbing pilot \xB7 QLD"), /*#__PURE__*/React.createElement(Badge, null, "Free trial \xB7 Starter Monthly")), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--text-dim)'
      }
    }, "Runs on Twilio")));
  }
  const PARTNERS = ['anthropic', 'gemini', 'twilio', 'deepgram', 'vapi', 'voyage'];
  function PoweredBy() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        padding: '56px 24px'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.24em',
        color: 'var(--text-dim)',
        margin: 0
      }
    }, "Powered by"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '28px 56px',
        marginTop: 32
      }
    }, PARTNERS.map(p => /*#__PURE__*/React.createElement("img", {
      key: p,
      src: `../../assets/partners/${p}.svg`,
      alt: p,
      className: "qm-partner",
      style: {
        height: 30,
        width: 'auto'
      }
    })))));
  }

  /* ─── How it works ────────────────────────────────────────────────── */
  function HowItWorks() {
    return /*#__PURE__*/React.createElement("section", {
      id: "how",
      style: {
        borderBottom: '1px solid var(--ink-line)',
        scrollMarginTop: 80
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        padding: '120px 24px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '48rem'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, null, "How it works"), /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: '12px 0 0',
        fontSize: 'var(--display-section)',
        lineHeight: 1,
        color: 'var(--text-pri)'
      }
    }, "Three steps. ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "You stay on the tools."))), /*#__PURE__*/React.createElement("div", {
      className: "qm-how-grid",
      style: {
        marginTop: 56,
        display: 'grid',
        gridTemplateColumns: '1.4fr 1fr',
        gap: 56,
        alignItems: 'start'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative',
        display: 'grid',
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "qm-spine",
      style: {
        position: 'absolute',
        left: 34,
        top: 40,
        bottom: 40,
        width: 1,
        background: 'linear-gradient(180deg, var(--accent) 0%, var(--ink-line) 72%, transparent 100%)'
      },
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement(NumberedCard, {
      num: "01",
      title: "Customer texts your number",
      body: "Each tradie gets a dedicated AU number. Voice or SMS, both feed QuoteMax while you stay on the tools."
    }), /*#__PURE__*/React.createElement(NumberedCard, {
      num: "02",
      title: "QuoteMax drafts the quote",
      body: "QuoteMax asks the right questions for the job type, applies your pricing book, and writes the line items in under a minute."
    }), /*#__PURE__*/React.createElement(NumberedCard, {
      num: "03",
      title: "You review, send, get paid",
      body: "The quote lands in your dashboard. Approve as-is or tweak it. The customer pays a deposit and the job is booked."
    })), /*#__PURE__*/React.createElement("figure", {
      className: "qm-duotone qm-edge-lit qm-how-photo",
      style: {
        margin: 0,
        position: 'relative',
        border: '1px solid var(--ink-line)',
        aspectRatio: '3/4'
      }
    }, /*#__PURE__*/React.createElement("img", {
      className: "qm-duotone__img",
      src: "../../assets/photos/trade-carpentry.jpg",
      alt: "Tradesperson at a workshop bench",
      style: {
        objectPosition: 'center 30%'
      }
    }), /*#__PURE__*/React.createElement("figcaption", {
      className: "qm-photo-caption",
      style: {
        position: 'absolute',
        insetInline: 0,
        bottom: 0,
        padding: '48px 20px 20px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.16em'
      }
    }, "You stay on the tools")))));
  }

  /* ─── Trades ──────────────────────────────────────────────────────── */
  function TradePanel({
    label,
    state,
    src,
    auto,
    inspection
  }) {
    return /*#__PURE__*/React.createElement(Card, {
      padding: 0,
      interactive: true,
      sweep: true,
      style: {
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative'
      }
    }, /*#__PURE__*/React.createElement("figure", {
      className: "qm-duotone",
      style: {
        margin: 0,
        aspectRatio: '16/9',
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("img", {
      className: "qm-duotone__img",
      src: src,
      alt: label,
      style: {
        objectPosition: 'center 28%'
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "qm-photo-caption",
      style: {
        position: 'absolute',
        insetInline: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 12,
        padding: '48px 24px 20px'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "qm-display",
      style: {
        margin: 0,
        fontSize: 30
      }
    }, label), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'rgba(255,255,255,0.9)',
        paddingBottom: 4
      }
    }, state))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 32
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      color: "var(--accent)",
      style: {
        fontSize: 11,
        letterSpacing: '0.16em'
      }
    }, "Auto-quoted"), /*#__PURE__*/React.createElement("ul", {
      style: {
        listStyle: 'none',
        margin: '12px 0 0',
        padding: 0,
        display: 'grid',
        gap: 8
      }
    }, auto.map(it => /*#__PURE__*/React.createElement("li", {
      key: it,
      style: {
        display: 'flex',
        gap: 12,
        fontSize: 15,
        color: 'var(--text-sec)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        color: 'var(--accent)'
      },
      "aria-hidden": "true"
    }, "\u2192"), it))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 28,
        borderTop: '1px solid var(--ink-line)',
        paddingTop: 28
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 11,
        letterSpacing: '0.16em'
      }
    }, "$99 site visit"), /*#__PURE__*/React.createElement("ul", {
      style: {
        listStyle: 'none',
        margin: '12px 0 0',
        padding: 0,
        display: 'grid',
        gap: 8
      }
    }, inspection.map(it => /*#__PURE__*/React.createElement("li", {
      key: it,
      style: {
        display: 'flex',
        gap: 12,
        fontSize: 15,
        color: 'var(--text-sec)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)'
      },
      "aria-hidden": "true"
    }, "\u25CB"), it))))));
  }
  function Trades() {
    return /*#__PURE__*/React.createElement("section", {
      id: "trades",
      style: {
        borderBottom: '1px solid var(--ink-line)',
        scrollMarginTop: 80
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        padding: '120px 24px'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: 0,
        maxWidth: '52rem',
        fontSize: 'var(--display-section)',
        lineHeight: 1,
        color: 'var(--text-pri)'
      }
    }, "Straightforward jobs ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "auto-quote"), ".", /*#__PURE__*/React.createElement("br", null), "The tricky ones book a site visit."), /*#__PURE__*/React.createElement("div", {
      className: "qm-trades-grid",
      style: {
        marginTop: 56,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 32
      }
    }, /*#__PURE__*/React.createElement(TradePanel, {
      label: "Electrical",
      state: "NSW \xB7 Pilot",
      src: "../../assets/photos/trade-electrical.jpg",
      auto: ['Downlights', 'Power points (GPOs)', 'Ceiling fans', 'Smoke alarms', 'Outdoor lighting'],
      inspection: ['Switchboard upgrade', 'EV charger', 'Fault finding', 'Oven / cooktop']
    }), /*#__PURE__*/React.createElement(TradePanel, {
      label: "Plumbing",
      state: "QLD \xB7 Pilot",
      src: "../../assets/photos/trade-plumbing.jpg",
      auto: ['Blocked drains', 'Hot water replacement', 'Tap repair', 'Tap replacement', 'Toilet repair'],
      inspection: ['Gas fitting', 'Burst pipe', 'Bathroom renovation']
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 32
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, {
      style: {
        fontSize: 11,
        letterSpacing: '0.16em'
      }
    }, "Next in line"), /*#__PURE__*/React.createElement("div", {
      className: "qm-upcoming",
      style: {
        marginTop: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(3,1fr)',
        gap: 16
      }
    }, [['Roofing', 'trade-roofing'], ['Solar', 'trade-solar'], ['Painting', 'trade-painting']].map(([label, img]) => /*#__PURE__*/React.createElement("figure", {
      key: label,
      className: "qm-duotone qm-edge-lit",
      style: {
        margin: 0,
        position: 'relative',
        border: '1px solid var(--ink-line)',
        aspectRatio: '4/3'
      }
    }, /*#__PURE__*/React.createElement("img", {
      className: "qm-duotone__img",
      src: `../../assets/photos/${img}.jpg`,
      alt: label
    }), /*#__PURE__*/React.createElement("figcaption", {
      className: "qm-photo-caption",
      style: {
        position: 'absolute',
        insetInline: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        padding: '40px 16px 14px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "qm-display",
      style: {
        fontSize: 18
      }
    }, label), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.16em',
        color: 'rgba(255,255,255,0.9)'
      }
    }, "Coming soon"))))))));
  }

  /* ─── The shift ───────────────────────────────────────────────────── */
  function Shift() {
    const rows = [['Misses the call while you\u2019re up a ladder', 'Answers every text and call the second it lands'], ['Quotes typed up at 11pm, after dinner', 'A clean quote drafted in under a minute'], ['Job goes to whoever\u2019s free to reply', 'A clean quote in their hand while you\u2019re still on the job']];
    return /*#__PURE__*/React.createElement("section", {
      style: {
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        padding: '120px 24px'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: 0,
        maxWidth: '52rem',
        fontSize: 'var(--display-section)',
        lineHeight: 1,
        color: 'var(--text-pri)'
      }
    }, "The job goes to whoever quotes first. ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "Now that\\u2019s you.")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 56,
        display: 'grid',
        gap: 1,
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "qm-shift-head",
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 24,
        background: 'var(--ink-deep)',
        padding: '16px 24px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.16em',
        color: 'var(--text-dim)'
      }
    }, "The usual"), /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.16em',
        color: 'var(--accent)'
      }
    }, "With QuoteMax")), rows.map(([a, b], i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "qm-shift-row",
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 24,
        background: 'var(--ink-card)',
        padding: '24px'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: 17,
        color: 'var(--text-dim)',
        textDecoration: 'line-through',
        textDecorationColor: 'color-mix(in srgb, var(--text-dim) 40%, transparent)'
      }
    }, a), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        color: 'var(--accent)'
      },
      "aria-hidden": "true"
    }, "\u2192"), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: 17,
        fontWeight: 500,
        color: 'var(--text-pri)'
      }
    }, b))))));
  }

  /* ─── Numbers ─────────────────────────────────────────────────────── */
  function Numbers() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "qm-numbers",
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        gap: '48px 24px',
        padding: '80px 24px'
      }
    }, /*#__PURE__*/React.createElement(Stat, {
      value: "< 1 min",
      label: "Per quote drafted"
    }), /*#__PURE__*/React.createElement(Stat, {
      value: "24/7",
      label: "Line always answered"
    }), /*#__PURE__*/React.createElement(Stat, {
      value: "$0",
      label: "Cut of your jobs"
    }), /*#__PURE__*/React.createElement(Stat, {
      value: "$99",
      label: "Locked site-visit price"
    })));
  }

  /* ─── Pricing ─────────────────────────────────────────────────────── */
  const PLANS = [{
    id: 'starter',
    name: 'Starter',
    tagline: 'Sole trader · SMS receptionist',
    monthly: 49,
    annual: 490,
    highlights: ['SMS & WhatsApp receptionist', '~40 quotes a month', 'Clean quotes + deposits collected', '1 trade · 1 dedicated AU number']
  }, {
    id: 'pro',
    name: 'Pro',
    tagline: 'Busy sole trader / small crew',
    monthly: 129,
    annual: 1290,
    featured: true,
    inheritsFrom: 'Starter',
    highlights: ['Voice receptionist — 300 mins / mo', '~150 quotes a month', 'Up to 2 trades · 2 dashboard seats', 'Your branding + 1 specialised estimator']
  }, {
    id: 'crew',
    name: 'Crew',
    tagline: 'Multi-trade teams',
    monthly: 299,
    annual: 2990,
    inheritsFrom: 'Pro',
    highlights: ['Voice receptionist — 1,000 mins / mo', '~400 quotes a month', 'Up to 4 trades · 5 seats · 3 numbers', 'All estimators, custom domain & priority support']
  }];
  const aud = n => '$' + n.toLocaleString('en-AU');
  function PlanCard({
    plan,
    annual
  }) {
    const perMonth = annual ? Math.round(plan.annual / 12) : plan.monthly;
    const saving = plan.monthly * 12 - plan.annual;
    return /*#__PURE__*/React.createElement(Card, {
      accentTop: plan.featured,
      sweep: true,
      padding: 32,
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderColor: plan.featured ? 'color-mix(in srgb, var(--accent) 50%, var(--ink-line))' : 'var(--ink-line)'
      }
    }, plan.featured ? /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        right: 20,
        top: 20,
        background: 'var(--accent)',
        color: 'var(--accent-ink)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        padding: '5px 10px'
      }
    }, "Most popular") : null, /*#__PURE__*/React.createElement("h3", {
      className: "qm-display",
      style: {
        margin: 0,
        fontSize: 24,
        color: 'var(--text-pri)'
      }
    }, plan.name), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '6px 0 0',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--text-dim)'
      }
    }, plan.tagline), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 24,
        display: 'flex',
        alignItems: 'baseline',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 48,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
        color: plan.featured ? 'var(--accent)' : 'var(--text-pri)'
      }
    }, aud(perMonth)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--text-dim)'
      }
    }, "/ mo")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '8px 0 0',
        minHeight: 20,
        fontSize: 14,
        color: 'var(--text-sec)'
      }
    }, annual ? /*#__PURE__*/React.createElement(React.Fragment, null, "Billed ", aud(plan.annual), "/yr \xB7 ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--accent)'
      }
    }, "save ", aud(saving))) : /*#__PURE__*/React.createElement(React.Fragment, null, "Billed monthly \xB7 or ", aud(plan.annual), "/yr")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 28
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: plan.featured ? 'primary' : 'secondary',
      fullWidth: true,
      href: "#"
    }, plan.id === 'starter' ? 'Start free trial' : 'Get started')), plan.inheritsFrom ? /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '28px 0 0',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: 'var(--text-dim)'
      }
    }, "Everything in ", plan.inheritsFrom, ", plus:") : null, /*#__PURE__*/React.createElement("ul", {
      style: {
        listStyle: 'none',
        margin: plan.inheritsFrom ? '12px 0 0' : '28px 0 0',
        padding: 0,
        display: 'grid',
        gap: 10
      }
    }, plan.highlights.map(h => /*#__PURE__*/React.createElement("li", {
      key: h,
      style: {
        display: 'flex',
        gap: 12,
        fontSize: 14,
        lineHeight: 1.5,
        color: 'var(--text-sec)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--accent)'
      },
      "aria-hidden": "true"
    }, "\u2192"), h))));
  }
  function Pricing() {
    const [annual, setAnnual] = useState(true);
    return /*#__PURE__*/React.createElement("section", {
      id: "pricing",
      style: {
        borderBottom: '1px solid var(--ink-line)',
        scrollMarginTop: 80
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        padding: '120px 24px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '48rem'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, null, "Pricing"), /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: '12px 0 0',
        fontSize: 'var(--display-sub)',
        lineHeight: 1.05,
        color: 'var(--text-pri)'
      }
    }, "Costs less than ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "one missed job.")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '24px 0 0',
        maxWidth: '46rem',
        fontSize: 18,
        lineHeight: 1.6,
        color: 'var(--text-sec)'
      }
    }, "Pick a plan and QuoteMax is quoting the same day. Starter Monthly comes with a 14-day free trial. We never take a cut of your jobs.")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement(Segmented, {
      ariaLabel: "Billing period",
      value: annual ? 'annual' : 'monthly',
      onChange: v => setAnnual(v === 'annual'),
      options: [{
        label: 'Monthly',
        value: 'monthly'
      }, {
        label: 'Annual',
        value: 'annual'
      }]
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--accent)'
      }
    }, "Save ~17% \u2014 2 months free")), /*#__PURE__*/React.createElement("div", {
      className: "qm-plans",
      style: {
        marginTop: 40,
        display: 'grid',
        gridTemplateColumns: 'repeat(3,1fr)',
        gap: 16
      }
    }, PLANS.map(p => /*#__PURE__*/React.createElement(PlanCard, {
      key: p.id,
      plan: p,
      annual: annual
    })))));
  }

  /* ─── FAQ ─────────────────────────────────────────────────────────── */
  const FAQ = [['Do I lose control of my pricing?', 'No. QuoteMax only ever uses your pricing book. Every quote lands in your dashboard for you to approve or tweak before it goes out.'], ['What about complex jobs?', 'Anything non-standard books a $99 site visit instead of auto-quoting. You quote those the way you always have, with the deposit already paid.'], ['Whose number is it?', 'Yours. Each tradie gets a dedicated Australian number. Customers text or call it; you stay on the tools.'], ['Which trades are live?', 'Electrical in NSW and plumbing in QLD are piloting now. More trades are being onboarded, so tell us yours.']];
  function Faq() {
    return /*#__PURE__*/React.createElement("section", {
      id: "faq",
      style: {
        borderBottom: '1px solid var(--ink-line)',
        scrollMarginTop: 80
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        padding: '120px 24px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '48rem'
      }
    }, /*#__PURE__*/React.createElement(Eyebrow, null, "Good questions"), /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: '12px 0 0',
        fontSize: 'var(--display-section)',
        lineHeight: 1,
        color: 'var(--text-pri)'
      }
    }, "The stuff tradies ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "actually"), " ask.")), /*#__PURE__*/React.createElement("dl", {
      className: "qm-faq",
      style: {
        marginTop: 56,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '40px 48px',
        margin: '56px 0 0'
      }
    }, FAQ.map(([q, a]) => /*#__PURE__*/React.createElement("div", {
      key: q,
      style: {
        borderTop: '1px solid var(--ink-line)',
        paddingTop: 24
      }
    }, /*#__PURE__*/React.createElement("dt", {
      className: "qm-display",
      style: {
        fontSize: 18,
        color: 'var(--text-pri)'
      }
    }, q), /*#__PURE__*/React.createElement("dd", {
      style: {
        margin: '12px 0 0',
        maxWidth: '46ch',
        fontSize: 15,
        lineHeight: 1.6,
        color: 'var(--text-sec)'
      }
    }, a))))));
  }

  /* ─── Closing CTA + footer + marquee ──────────────────────────────── */
  function ClosingCta() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        borderBottom: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '56rem',
        margin: '0 auto',
        padding: '112px 24px'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      className: "qm-display",
      style: {
        margin: 0,
        fontSize: 'var(--display-sub)',
        lineHeight: 1.05,
        color: 'var(--text-pri)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-accent)'
      }
    }, "Both pilots"), " are live.", /*#__PURE__*/React.createElement("br", null), "Your turn is next."), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '24px 0 0',
        maxWidth: '46rem',
        fontSize: 18,
        lineHeight: 1.6,
        color: 'var(--text-sec)'
      }
    }, "Each tradie gets their own number, pricing book, and QuoteMax tuned to their brand voice. Setup takes about three minutes."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 40
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      size: "lg",
      withArrow: true,
      href: "#pricing"
    }, "Get my QuoteMax"), /*#__PURE__*/React.createElement(Btn, {
      variant: "secondary",
      size: "lg",
      href: "#how"
    }, "See how it works"))));
  }
  function Footer() {
    const cols = [['Product', ['How it works', 'Pricing', 'FAQ']], ['Trades', ['Electrical', 'Plumbing', 'Roofing', 'Solar', 'Painting']], ['Account', ['Sign in', 'Get started']], ['Legal', ['Privacy policy', 'Terms & conditions', 'Cookie policy']]];
    return /*#__PURE__*/React.createElement("footer", null, /*#__PURE__*/React.createElement("div", {
      className: "qm-footer-grid",
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr',
        gap: 40,
        padding: '64px 24px'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Logo, {
      size: 36
    }), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '16px 0 0',
        maxWidth: '24ch',
        fontSize: 14,
        lineHeight: 1.6,
        color: 'var(--text-dim)'
      }
    }, "QuoteMax drafts clean quotes for Australian electricians and plumbers.")), cols.map(([title, links]) => /*#__PURE__*/React.createElement("div", {
      key: title
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.16em',
        color: 'var(--text-dim)'
      }
    }, title), /*#__PURE__*/React.createElement("ul", {
      style: {
        listStyle: 'none',
        margin: '16px 0 0',
        padding: 0,
        display: 'grid',
        gap: 10
      }
    }, links.map(l => /*#__PURE__*/React.createElement("li", {
      key: l
    }, /*#__PURE__*/React.createElement("a", {
      href: "#",
      className: "qm-link-underline",
      style: {
        fontSize: 14,
        color: 'var(--text-sec)',
        textDecoration: 'none'
      }
    }, l))))))), /*#__PURE__*/React.createElement("div", {
      style: {
        borderTop: '1px solid var(--ink-line)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: MAXW,
        margin: '0 auto',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 8,
        padding: '20px 24px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--text-dim)'
      }
    }, "\xA9 2026 QuoteMax"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--text-dim)'
      }
    }, "Electrical NSW \xB7 Plumbing QLD"))));
  }
  function MarketingPage() {
    useLucide();
    return /*#__PURE__*/React.createElement("div", {
      id: "top",
      className: "qm-marketing-canvas qm-grain",
      style: {
        minHeight: '100vh'
      }
    }, /*#__PURE__*/React.createElement(Nav, null), /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(TrustStrip, null), /*#__PURE__*/React.createElement(PoweredBy, null), /*#__PURE__*/React.createElement(HowItWorks, null), /*#__PURE__*/React.createElement(Trades, null), /*#__PURE__*/React.createElement(Shift, null), /*#__PURE__*/React.createElement(Numbers, null), /*#__PURE__*/React.createElement(Pricing, null), /*#__PURE__*/React.createElement(Faq, null), /*#__PURE__*/React.createElement(ClosingCta, null), /*#__PURE__*/React.createElement(Footer, null), /*#__PURE__*/React.createElement(Marquee, {
      items: ['QuoteMax', 'Built in Australia', 'For tradies, by tradies', 'Quote drafted in under a minute', 'Electrical NSW', 'Plumbing QLD']
    }));
  }
  ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(MarketingPage, null));
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/marketing.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.Stat = __ds_scope.Stat;

__ds_ns.StatusPill = __ds_scope.StatusPill;

__ds_ns.SegmentedToggle = __ds_scope.SegmentedToggle;

__ds_ns.TextField = __ds_scope.TextField;

__ds_ns.SmsThread = __ds_scope.SmsThread;

__ds_ns.TierCard = __ds_scope.TierCard;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Marquee = __ds_scope.Marquee;

__ds_ns.NumberedCard = __ds_scope.NumberedCard;

})();
