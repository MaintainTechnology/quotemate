import React, { useState } from 'react';

/**
 * TextField — square, hairline-bordered field on the sunken surface. Mono
 * uppercase label above; the border warms to accent on focus. Renders an
 * <input>, <textarea> or <select> via `as`.
 */
export function TextField({
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
    appearance: as === 'select' ? 'none' : undefined,
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
    ...rest,
  };

  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {label ? (
        <label
          htmlFor={fieldId}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-label)',
            color: 'var(--text-dim)',
          }}
        >
          {label}
          {required ? <span style={{ color: 'var(--accent)' }}> *</span> : null}
        </label>
      ) : null}

      {as === 'textarea' ? (
        <textarea rows={rows} placeholder={placeholder} {...shared} />
      ) : as === 'select' ? (
        <div style={{ position: 'relative' }}>
          <select {...shared}>
            {options.map((o) => {
              const opt = typeof o === 'string' ? { label: o, value: o } : o;
              return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })}
          </select>
          <span aria-hidden="true" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>▾</span>
        </div>
      ) : (
        <input type={type} placeholder={placeholder} {...shared} />
      )}

      {error ? (
        <span style={{ fontSize: '12px', color: 'var(--danger-bright)' }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{hint}</span>
      ) : null}
    </div>
  );
}
