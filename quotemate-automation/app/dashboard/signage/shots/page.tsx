'use client'

// /dashboard/signage/shots — edit the brand's guided photo shots.
// Shots are per-brand DATA, so HQ can add/rename/remove the surfaces it
// asks locations to photograph with no code change. Maintain design system.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from '../_components/BrandTabs'

type Shot = { slot: string; label: string; instruction: string }

export default function SignageShotsPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')
  const [brandName, setBrandName] = useState('')
  const [brands, setBrands] = useState<BrandTab[]>([])
  const [brandSlug, setBrandSlug] = useState<string | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async (t: string, brandParam: string | null) => {
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
        setMsg(`Saved ${json.brand.shots.length} shots.`)
        setShots(json.brand.shots.map((s: Shot) => ({ slot: s.slot, label: s.label, instruction: s.instruction ?? '' })))
      }
    } finally {
      setBusy(false)
    }
  }, [token, shots, brandSlug])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="relative z-10 mx-auto max-w-4xl px-6 pt-14 pb-8 sm:px-10 md:pt-16">
        <Breadcrumb brandSlug={brandSlug} />
        <h1 className="mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.25rem)]">
          Photo <span className="text-accent">shots</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-text-sec">
          These are the photos {brandName || 'the brand'} asks each location to take. Add, rename, or remove
          surfaces — the slot id is snake_case and auto-cleaned on save.
        </p>
        {authState === 'ready' && brands.length > 1 && (
          <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
        )}
      </section>

      {authState === 'signed-out' && (
        <section className="mx-auto max-w-4xl px-6 pb-20 sm:px-10"><p className="text-text-sec">Sign in to edit shots.</p></section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto max-w-4xl px-6 pb-24 sm:px-10">
          <div className="grid gap-3">
            {shots.map((s, i) => (
              <div key={i} className="grid gap-3 border border-ink-line bg-ink-card p-4 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
                <div>
                  <Label>Slot id</Label>
                  <input value={s.slot} onChange={(e) => setShot(i, { slot: e.target.value })} placeholder="window_wrap" className={INPUT} />
                </div>
                <div>
                  <Label>Label</Label>
                  <input value={s.label} onChange={(e) => setShot(i, { label: e.target.value })} placeholder="Window wrap" className={INPUT} />
                </div>
                <div>
                  <Label>Instruction</Label>
                  <input value={s.instruction} onChange={(e) => setShot(i, { instruction: e.target.value })} placeholder="What to capture" className={INPUT} />
                </div>
                <button
                  type="button"
                  onClick={() => removeShot(i)}
                  className="h-[46px] border border-ink-line px-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:border-warning hover:text-warning"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={addShot} className="border border-ink-line px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri hover:border-accent hover:text-accent">
              + Add shot
            </button>
            <button type="button" onClick={save} disabled={busy || shots.length === 0} className="bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-50">
              {busy ? 'Saving…' : 'Save shots'}
            </button>
            {msg && <span className="font-mono text-sm text-text-sec">{msg}</span>}
          </div>
        </section>
      )}
    </main>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">{children}</div>
}
function Breadcrumb({ brandSlug }: { brandSlug: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/dashboard" className="hover:text-text-pri">Dashboard</Link>
      <span className="text-ink-line">/</span>
      <Link href={withBrand('/dashboard/signage', brandSlug)} className="hover:text-text-pri">Signage</Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Shots</span>
    </div>
  )
}
const INPUT = 'w-full border border-ink-line bg-ink-deep px-3 py-2.5 font-mono text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
