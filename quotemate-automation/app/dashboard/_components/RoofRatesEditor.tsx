'use client'

// /dashboard Pricing tab — per-tenant "Roof rates" editor.
//
// Five inputs (one per editable material). Each shows the canonical
// default as placeholder + tiny caption. Saving PATCHes
// /api/tenant/roofing-rates, which writes pricing_book.overlays
// .roofing_rate_card. Blank inputs clear that material's override (the
// global default takes over). Validation: positive number ≤ $500/m².
//
// Forward-only: existing quotes don't re-price; only NEW measurements
// pick up the change.

import { useCallback, useEffect, useState } from 'react'

const MATERIALS = [
  ['colorbond_trimdek',  'Colorbond Trimdek'],
  ['colorbond_kliplok',  'Colorbond Klip-Lok 700'],
  ['concrete_tile',      'Concrete tile'],
  ['terracotta_tile',    'Terracotta tile'],
  ['cement_sheet',       'Cement sheet (asbestos-suspect)'],
] as const

type MaterialKey = (typeof MATERIALS)[number][0]

type GetResponse =
  | {
      ok: true
      materials: readonly MaterialKey[]
      defaults: Record<MaterialKey, number>
      overrides: Partial<Record<MaterialKey, number>>
      has_pricing_book: boolean
    }
  | { ok: false; error: string }

type PatchResponse =
  | {
      ok: true
      overrides: Partial<Record<MaterialKey, number>>
      effective_rate_per_m2: Record<MaterialKey, number>
    }
  | { ok: false; error: string; issues?: Array<{ field: string; message: string }> }

type Props = {
  accessToken: string | null
}

export function RoofRatesEditor({ accessToken }: Props) {
  const [defaults, setDefaults] = useState<Record<MaterialKey, number> | null>(null)
  const [values, setValues] = useState<Record<MaterialKey, string>>({
    colorbond_trimdek: '',
    colorbond_kliplok: '',
    concrete_tile: '',
    terracotta_tile: '',
    cement_sheet: '',
  })
  const [hasPricingBook, setHasPricingBook] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MaterialKey, string>>>({})
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setErrMsg(null)
    try {
      const res = await fetch('/api/tenant/roofing-rates', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as GetResponse
      if (!json.ok) {
        setErrMsg(json.error)
        return
      }
      setDefaults(json.defaults)
      setHasPricingBook(json.has_pricing_book)
      setValues({
        colorbond_trimdek: stringify(json.overrides.colorbond_trimdek),
        colorbond_kliplok: stringify(json.overrides.colorbond_kliplok),
        concrete_tile: stringify(json.overrides.concrete_tile),
        terracotta_tile: stringify(json.overrides.terracotta_tile),
        cement_sheet: stringify(json.overrides.cement_sheet),
      })
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!accessToken) return
      setSaving(true)
      setErrMsg(null)
      setFieldErrors({})
      try {
        const res = await fetch('/api/tenant/roofing-rates', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reroof_rate_per_m2: {
              colorbond_trimdek: values.colorbond_trimdek === '' ? null : values.colorbond_trimdek,
              colorbond_kliplok: values.colorbond_kliplok === '' ? null : values.colorbond_kliplok,
              concrete_tile: values.concrete_tile === '' ? null : values.concrete_tile,
              terracotta_tile: values.terracotta_tile === '' ? null : values.terracotta_tile,
              cement_sheet: values.cement_sheet === '' ? null : values.cement_sheet,
            },
          }),
        })
        const json = (await res.json()) as PatchResponse
        if (!json.ok) {
          if (json.issues && json.issues.length > 0) {
            const fe: Partial<Record<MaterialKey, string>> = {}
            for (const i of json.issues) {
              const k = i.field.split('.').pop() as MaterialKey | undefined
              if (k) fe[k] = i.message
            }
            setFieldErrors(fe)
            setErrMsg('Fix the highlighted fields and try again.')
          } else {
            setErrMsg(json.error || 'Failed to save.')
          }
          return
        }
        setSavedAt(Date.now())
        // Refresh values so blanks show the cleared state.
        await load()
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [accessToken, values, load],
  )

  if (!hasPricingBook) {
    return (
      <div className="border border-ink-line bg-ink-card p-6">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
          Roof rates · pricing book missing
        </div>
        <p className="mt-2 text-base text-text-sec">
          Complete onboarding for your primary trade first — roofing rate overrides
          piggyback on the same pricing-book row.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={save}
      className="border border-ink-line bg-ink-card p-7 sm:p-8"
      aria-busy={loading || saving}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Roof rates
          </div>
          <h3 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">
            Your $/m² per material
          </h3>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
            Override the global defaults the roofing estimator uses. Blank fields
            fall back to the default. New measurements use the updated rates
            instantly; existing quotes don&apos;t re-price.
          </p>
        </div>
        {savedAt && !errMsg && (
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-teal-glow">
            ✓ Saved
          </span>
        )}
      </div>

      {errMsg && (
        <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">
            Could not save
          </div>
          <p className="mt-1 text-sm text-text-sec">{errMsg}</p>
        </div>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {MATERIALS.map(([key, label]) => {
          const def = defaults?.[key]
          const fe = fieldErrors[key]
          return (
            <label key={key} className="block">
              <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                {label}
              </div>
              <div className="relative mt-2">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-base text-text-dim"
                >
                  $
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={500}
                  step={1}
                  value={values[key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                  placeholder={def !== undefined ? String(def) : ''}
                  disabled={loading || saving}
                  aria-label={`${label} $/m²`}
                  className={`w-full border bg-ink-deep px-8 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${
                    fe ? 'border-warning' : 'border-ink-line focus:border-accent'
                  }`}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-text-dim">
                  /m²
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-text-dim">
                <span>
                  {def !== undefined ? `Default $${def}/m²` : 'Default unavailable'}
                </span>
                {fe && <span className="text-warning">{fe}</span>}
              </div>
            </label>
          )
        })}
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={loading || saving || !accessToken}
          className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <>
              <span
                className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              Saving…
            </>
          ) : (
            <>
              Save rates <span aria-hidden="true">&rarr;</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() =>
            setValues({
              colorbond_trimdek: '',
              colorbond_kliplok: '',
              concrete_tile: '',
              terracotta_tile: '',
              cement_sheet: '',
            })
          }
          disabled={loading || saving}
          className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-accent disabled:opacity-50"
        >
          Reset all to default
        </button>
      </div>
    </form>
  )
}

function stringify(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v)
}
