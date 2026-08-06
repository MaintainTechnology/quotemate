'use client'

// Pylon hardware supplement settings (build 2026-06-13) — rendered in
// the Solar tab's Instant-estimate view. The tradie nominates their
// standard panel / inverter / battery once (Pylon component SKUs);
// every instant estimate then carries manufacturer datasheet cards and
// the hardware-floor guardrail. Renders nothing when the Pylon
// integration is off (route answers pylon_disabled).

import { useCallback, useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import { getAuthToken } from '@/lib/auth/client-token'

type Settings = {
  module_sku?: string | null
  inverter_sku?: string | null
  battery_sku?: string | null
}

const FIELDS: Array<{ key: keyof Settings; label: string; hint: string }> = [
  { key: 'module_sku', label: 'Panel SKU', hint: 'Your standard solar module' },
  { key: 'inverter_sku', label: 'Inverter SKU', hint: 'Your standard inverter' },
  { key: 'battery_sku', label: 'Battery SKU', hint: 'Optional — battery add-on' },
]

export function PylonHardwareCard({ accessToken }: { accessToken: string | null }) {
  const [enabled, setEnabled] = useState(false)
  const [values, setValues] = useState<Settings>({})
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    void (async () => {
      try {
        const token = (await getAuthToken()) ?? accessToken
        const res = await fetch('/api/tenant/pylon/settings', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (cancelled) return
        if (!res.ok) return // disabled / unauthorized → render nothing
        const json = (await res.json()) as { ok?: boolean; settings?: Settings }
        if (json.ok) {
          setEnabled(true)
          setValues(json.settings ?? {})
        }
      } catch {
        /* integration unreachable → keep hidden */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken])

  const save = useCallback(async () => {
    if (!accessToken) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const token = (await getAuthToken()) ?? accessToken
      const res = await fetch('/api/tenant/pylon/settings', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        resolved?: Record<string, string>
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setResolved(json.resolved ?? {})
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [accessToken, values])

  if (!enabled) return null

  return (
    <div className="rounded-card border border-ink-line bg-ink-card p-7 sm:p-9">
      <div className="flex items-center gap-3 text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-accent">
        <Cpu className="h-4 w-4" aria-hidden="true" />
        Your standard hardware
      </div>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
        Nominate the hardware you install as standard (Pylon component SKUs).
        Every instant estimate then shows the customer real brand, model and
        manufacturer datasheets &mdash; and your own Pylon prices guard
        against a tier quoted below hardware cost.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className=" text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-text-dim">
              {f.label}
            </span>
            <input
              type="text"
              value={values[f.key] ?? ''}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value || null }))
              }
              placeholder={f.hint}
              className="rounded-ctl mt-1.5 w-full border border-ink-line bg-ink-deep px-3 py-2.5 font-mono text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
            {resolved[f.key] && (
              <span className="mt-1 block text-xs text-success-bright">✓ {resolved[f.key]}</span>
            )}
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-warning">{error}</p>}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-busy={saving}
          className="rounded-ctl inline-flex items-center gap-2 bg-accent px-5 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-accent-press disabled:opacity-60"
        >
          {saving ? 'Checking with Pylon\u2026' : 'Save hardware'}
        </button>
        {saved && (
          <span className=" text-xs uppercase tracking-[0.08em] text-success-bright">
            Saved · SKUs verified
          </span>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-dim">
        Find a SKU in Pylon: open any design&rsquo;s component, or copy it from
        a datasheet URL (the UUID segment).
      </p>
    </div>
  )
}
