'use client'

// /dashboard/signage/shots — edit the brand's guided photo shots.
// Shots are per-brand DATA, so HQ can add/rename/remove the surfaces it
// asks locations to photograph with no code change. Maintain design system.

import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from '../_components/BrandTabs'
import {
  BTN_DANGER_SM,
  BTN_GHOST,
  BTN_PRIMARY,
  Crumbs,
  delay,
  EmptyState,
  INPUT_SM,
  Label,
  Notice,
  REVEAL,
  SignageNav,
  TopoBackdrop,
} from '../_components/ui'

type Shot = { slot: string; label: string; instruction: string }

export default function SignageShotsPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'error' | 'ready'>('loading')
  const [brandName, setBrandName] = useState('')
  const [brands, setBrands] = useState<BrandTab[]>([])
  const [brandSlug, setBrandSlug] = useState<string | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async (t: string, brandParam: string | null) => {
    try {
      const q = brandParam ? `?brand=${encodeURIComponent(brandParam)}` : ''
      const res = await fetch(`/api/signage/brand${q}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' })
      if (res.status === 401) return setAuthState('signed-out')
      const json = await res.json()
      if (json.ok) {
        setBrandName(json.brand?.name ?? 'Brand')
        setBrands(json.brands ?? [])
        setBrandSlug(json.selected ?? null)
        setShots(
          (json.brand?.shots ?? []).map((s: Shot) => ({ slot: s.slot, label: s.label, instruction: s.instruction ?? '' })),
        )
        setAuthState('ready')
      } else {
        setAuthState((s) => (s === 'ready' ? s : 'error'))
      }
    } catch {
      setAuthState((s) => (s === 'ready' ? s : 'error'))
    }
  }, [])

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const t = session?.access_token ?? null
        setToken(t)
        if (!t) return setAuthState('signed-out')
        void load(t, brandFromUrl())
      })
  }, [load])

  const switchBrand = useCallback(
    (slug: string) => {
      if (!token || slug === brandSlug) return
      syncBrandInUrl(slug)
      setBrandSlug(slug)
      setMsg(null)
      void load(token, slug)
    },
    [token, brandSlug, load],
  )

  const setShot = (i: number, patch: Partial<Shot>) => setShots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const addShot = () => setShots((prev) => [...prev, { slot: '', label: '', instruction: '' }])
  const removeShot = (i: number) => setShots((prev) => prev.filter((_, j) => j !== i))

  const save = useCallback(async () => {
    if (!token) return
    setBusy(true)
    setMsg(null)
    try {
      const q = brandSlug ? `?brand=${encodeURIComponent(brandSlug)}` : ''
      const res = await fetch(`/api/signage/brand${q}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shots }),
      })
      const json = await res.json()
      if (!json.ok) setMsg(`Save failed: ${json.error}`)
      else {
        setMsg(`Saved ${json.brand.shots.length} shot${json.brand.shots.length === 1 ? '' : 's'}.`)
        setShots(json.brand.shots.map((s: Shot) => ({ slot: s.slot, label: s.label, instruction: s.instruction ?? '' })))
      }
    } catch {
      setMsg('Save failed: network error — please try again.')
    } finally {
      setBusy(false)
    }
  }, [token, shots, brandSlug])

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <TopoBackdrop />

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 sm:px-10 md:pt-16">
        <div className={REVEAL}>
          <Crumbs
            trail={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Signage', href: withBrand('/dashboard/signage', brandSlug) },
              { label: 'Shots' },
            ]}
          />
        </div>
        <h1 className={`mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.25rem)] ${REVEAL}`} style={delay(60)}>
          Photo <span className="text-accent">shots</span>
        </h1>
        <p className={`mt-4 max-w-2xl text-base leading-relaxed text-text-sec ${REVEAL}`} style={delay(120)}>
          These are the photos {brandName || 'the brand'} asks each location to take. Add, rename, or remove
          surfaces — the slot id is snake_case and auto-cleaned on save.
        </p>
        {authState === 'ready' && brands.length > 1 && (
          <div className={`mt-7 ${REVEAL}`} style={delay(160)}>
            <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
          </div>
        )}
        {authState === 'ready' && (
          <div className={`mt-8 ${REVEAL}`} style={delay(200)}>
            <SignageNav active="shots" brandSlug={brandSlug} />
          </div>
        )}
      </section>

      {authState === 'signed-out' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <p className="text-text-sec">Sign in to edit shots.</p>
        </section>
      )}

      {authState === 'error' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <Notice tone="warn">Couldn&rsquo;t load the shot list — check your connection and refresh the page.</Notice>
        </section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-24 sm:px-10">
          {shots.length === 0 ? (
            <EmptyState
              title="No shots yet"
              body={`${brandName || 'This brand'} has no guided photo shots configured. Add the first surface you want every location to photograph.`}
            />
          ) : (
            <div className="grid gap-3">
              {shots.map((s, i) => (
                <div
                  key={i}
                  className={`grid gap-4 border border-ink-line bg-ink-card p-5 md:grid-cols-[auto_1fr_1fr_2fr_auto] md:items-end ${REVEAL}`}
                  style={delay(Math.min(i, 8) * 40)}
                >
                  <span className="hidden font-mono text-3xl font-bold leading-none text-accent md:block md:self-center" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <Label htmlFor={`shot-slot-${i}`}>Slot id</Label>
                    <input id={`shot-slot-${i}`} value={s.slot} onChange={(e) => setShot(i, { slot: e.target.value })} placeholder="window_wrap" className={INPUT_SM} />
                  </div>
                  <div>
                    <Label htmlFor={`shot-label-${i}`}>Label</Label>
                    <input id={`shot-label-${i}`} value={s.label} onChange={(e) => setShot(i, { label: e.target.value })} placeholder="Window wrap" className={INPUT_SM} />
                  </div>
                  <div>
                    <Label htmlFor={`shot-instruction-${i}`}>Instruction</Label>
                    <input id={`shot-instruction-${i}`} value={s.instruction} onChange={(e) => setShot(i, { instruction: e.target.value })} placeholder="What to capture" className={INPUT_SM} />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeShot(i)}
                    aria-label={`Remove shot ${s.label || i + 1}`}
                    className={`h-[42px] ${BTN_DANGER_SM}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ink-line pt-6">
            <button type="button" onClick={addShot} className={BTN_GHOST}>
              + Add shot
            </button>
            <button type="button" onClick={save} disabled={busy || shots.length === 0} className={BTN_PRIMARY}>
              {busy ? 'Saving…' : 'Save shots'}
            </button>
            {msg && (
              <span aria-live="polite" className="font-mono text-sm text-text-sec">{msg}</span>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
