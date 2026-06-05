'use client'

// /dashboard/signage/studios — manage real locations (replaces demo seeds).
//   • Find a studio by name/area (Google Places) → real address + coords.
//   • Or type an address (Geoscape autocomplete) — geocoded live for a map.
//   • Live Street View + map preview as you fill the form; thumbnails open
//     full-size in a lightbox.
//   • Bulk-import a roster CSV. Delete studios (e.g. the demo rows).
// Maintain Technology design system.

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { AddressAutocomplete } from '@/app/dashboard/roofing/_components/AddressAutocomplete'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from '../_components/BrandTabs'

type Studio = {
  id: string
  name: string
  region: string | null
  status: string
  address: string | null
  state: string | null
  postcode: string | null
  lat: number | null
  lng: number | null
}
type PlaceResult = { place_id: string; name: string; address: string; lat: number | null; lng: number | null }

export default function SignageStudiosPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')
  const [studios, setStudios] = useState<Studio[]>([])
  const [brands, setBrands] = useState<BrandTab[]>([])
  const [brandSlug, setBrandSlug] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [stateCode, setStateCode] = useState<string | null>(null)
  const [postcode, setPostcode] = useState<string | null>(null)
  const [region, setRegion] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const [placeQuery, setPlaceQuery] = useState('')
  const [places, setPlaces] = useState<PlaceResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const geoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (t: string, brandParam: string | null) => {
    const q = brandParam ? `?brand=${encodeURIComponent(brandParam)}` : ''
    const res = await fetch(`/api/signage/studios${q}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' })
    if (res.status === 401) return setAuthState('signed-out')
    const json = await res.json()
    if (json.ok) {
      setStudios(json.studios ?? [])
      setBrands(json.brands ?? [])
      setBrandSlug(json.selected ?? null)
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
      void load(token, slug)
    },
    [token, brandSlug, load],
  )

  // Debounced Places search.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!token || placeQuery.trim().length < 3) {
      setPlaces([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/signage/places/search?q=${encodeURIComponent(placeQuery)}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        setPlaces(json.ok ? (json.results ?? []) : [])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [placeQuery, token])

  // Auto-geocode a typed address so the live map shows (Places picks already
  // carry coords, so this only fires when lat is null).
  useEffect(() => {
    if (geoTimer.current) clearTimeout(geoTimer.current)
    if (!token || lat !== null || address.trim().length < 6) return
    geoTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/signage/geocode?address=${encodeURIComponent(address)}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.ok) {
          setLat(json.lat)
          setLng(json.lng)
        }
      } catch {
        /* best-effort */
      }
    }, 600)
    return () => {
      if (geoTimer.current) clearTimeout(geoTimer.current)
    }
  }, [address, lat, token])

  const pickPlace = (p: PlaceResult) => {
    setName(p.name)
    setAddress(p.address)
    setLat(p.lat)
    setLng(p.lng)
    setPlaceId(p.place_id)
    setStateCode(null)
    setPostcode(null)
    setPlaces([])
    setPlaceQuery('')
  }

  const resetForm = () => {
    setName('')
    setAddress('')
    setStateCode(null)
    setPostcode(null)
    setRegion('')
    setLat(null)
    setLng(null)
    setPlaceId(null)
  }

  const addStudio = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!token) return
      setBusy(true)
      setErr(null)
      try {
        const q = brandSlug ? `?brand=${encodeURIComponent(brandSlug)}` : ''
        const res = await fetch(`/api/signage/studios${q}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            address: address.trim() || undefined,
            state: stateCode || undefined,
            postcode: postcode || undefined,
            region: region.trim() || undefined,
            lat: lat ?? undefined,
            lng: lng ?? undefined,
            place_id: placeId || undefined,
          }),
        })
        const json = await res.json()
        if (!json.ok) setErr(json.error)
        else {
          resetForm()
          await load(token, brandSlug)
        }
      } finally {
        setBusy(false)
      }
    },
    [token, name, address, stateCode, postcode, region, lat, lng, placeId, brandSlug, load],
  )

  const importCsv = useCallback(
    async (file: File) => {
      if (!token) return
      setBusy(true)
      setImportMsg(null)
      try {
        const q = brandSlug ? `?brand=${encodeURIComponent(brandSlug)}` : ''
        const fd = new FormData()
        fd.append('csv', file)
        const res = await fetch(`/api/signage/studios/import${q}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
        const json = await res.json()
        if (!json.ok) setImportMsg(`Import failed: ${(json.issues ?? [json.error]).join('; ')}`)
        else setImportMsg(`Imported ${json.created} studio(s); ${json.skipped_existing} already existed.`)
        await load(token, brandSlug)
      } finally {
        setBusy(false)
      }
    },
    [token, brandSlug, load],
  )

  const deleteStudio = useCallback(
    async (s: Studio) => {
      if (!token) return
      if (!window.confirm(`Delete "${s.name}"? This removes it and any sweep photos/results for it.`)) return
      const res = await fetch(`/api/signage/studios/${s.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) await load(token, brandSlug)
    },
    [token, brandSlug, load],
  )

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-14 pb-8 sm:px-10 md:pt-16">
        <Breadcrumb brandSlug={brandSlug} />
        <h1 className="mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.25rem)]">
          Manage <span className="text-accent">studios</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-text-sec">
          Add your real locations. Search Google for a studio by name/area, or type an address — we
          geocode it, show a live Street View + map, and you can click any image to view it full-size.
        </p>
        {authState === 'ready' && brands.length > 1 && (
          <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
        )}
      </section>

      {authState === 'signed-out' && (
        <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10"><p className="text-text-sec">Sign in to manage studios.</p></section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24 sm:px-10">
          {/* Find on Google */}
          <div className="border border-ink-line bg-ink-card p-7 sm:p-8">
            <Label>Find a studio on Google (name or area)</Label>
            <div className="relative">
              <input value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} placeholder="e.g. F45 Bondi Beach" className={INPUT} />
              {searching && <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[0.7rem] text-text-dim">…</span>}
              {places.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto border border-ink-line bg-ink-card shadow-lg">
                  {places.map((p) => (
                    <li key={p.place_id} onMouseDown={(e) => { e.preventDefault(); pickPlace(p) }} className="cursor-pointer px-4 py-3 hover:bg-ink-line/40">
                      <div className="font-mono text-sm text-text-pri">{p.name}</div>
                      <div className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">{p.address}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-2 text-xs text-text-dim">Picking a result fills the form below with the real name + address + coordinates.</p>
          </div>

          {/* Add a studio */}
          <form onSubmit={addStudio} className="mt-5 grid gap-5 border border-ink-line bg-ink-card p-7 sm:p-8 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label>Studio name</Label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="F45 Bondi" className={INPUT} />
            </div>
            <div className="md:col-span-2">
              <Label>Address {lat !== null && <span className="text-teal-glow">· located</span>}</Label>
              <AddressAutocomplete
                accessToken={token}
                value={address}
                onChange={(v) => { setAddress(v); setLat(null); setLng(null) }}
                onSelect={(s) => { setAddress(s.address); setStateCode(s.state); setPostcode(s.postcode); setLat(null); setLng(null) }}
              />
            </div>

            {/* Live preview — appears as soon as there's an address */}
            {address.trim().length > 5 && (
              <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
                <Preview
                  token={token}
                  label="Storefront (Street View)"
                  url={`/api/signage/street-view?${new URLSearchParams({ address, state: stateCode ?? '', postcode: postcode ?? '' }).toString()}`}
                  onView={setLightbox}
                />
                <Preview
                  token={token}
                  label="Location (map)"
                  url={lat !== null && lng !== null ? `/api/signage/static-map?${new URLSearchParams({ lat: String(lat), lng: String(lng), maptype: 'hybrid' }).toString()}` : null}
                  emptyHint="locating…"
                  onView={setLightbox}
                />
              </div>
            )}

            <div>
              <Label>Region (optional)</Label>
              <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="AU-NSW" className={INPUT} />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={busy || !name.trim()} className="bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-50">
                {busy ? 'Adding…' : 'Add studio'}
              </button>
            </div>
            {err && <p className="md:col-span-2 text-warning">{err}</p>}
          </form>

          {/* CSV import */}
          <div className="mt-5 border border-ink-line bg-ink-card p-7 sm:p-8">
            <Label>Bulk import (CSV)</Label>
            <p className="mb-3 text-sm text-text-sec">Columns: name (required), address, region, state, postcode, contact_phone, contact_email.</p>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Studio roster CSV"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f) }}
              className="block w-full text-sm text-text-sec file:mr-4 file:border-0 file:bg-ink-line file:px-4 file:py-2.5 file:font-mono file:text-xs file:font-semibold file:uppercase file:tracking-[0.12em] file:text-text-pri"
            />
            {importMsg && <p className="mt-3 text-sm text-text-sec">{importMsg}</p>}
          </div>

          {/* List */}
          <h2 className="mt-10 font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
            {studios.length} studio{studios.length === 1 ? '' : 's'}
          </h2>
          <div className="mt-4 grid gap-3">
            {studios.map((s) => (
              <div key={s.id} className="flex items-center gap-3 border border-ink-line bg-ink-card p-4">
                <StreetThumb token={token} studio={s} onView={setLightbox} />
                <StaticMapThumb token={token} studio={s} onView={setLightbox} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm text-text-pri">{s.name}</div>
                  <div className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
                    {[s.region, s.address].filter(Boolean).join(' · ') || 'No address'}
                  </div>
                </div>
                <button type="button" onClick={() => void deleteStudio(s)} className="border border-ink-line px-3 py-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-text-dim hover:border-warning hover:text-warning">
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Preview" className="max-h-[88vh] max-w-[92vw] border border-ink-line object-contain" />
          <button type="button" className="absolute right-6 top-6 border border-ink-line bg-ink-card px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-pri hover:text-accent">
            Close ✕
          </button>
        </div>
      )}
    </main>
  )
}

function useAuthedImage(url: string | null, token: string | null) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (!url || !token) return
    let revoke: string | null = null
    let cancelled = false
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok || cancelled) return
        const blob = await r.blob()
        revoke = URL.createObjectURL(blob)
        if (!cancelled) setSrc(revoke)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [url, token])
  return src
}

/** Larger in-form preview tile. */
function Preview({ token, label, url, emptyHint, onView }: { token: string | null; label: string; url: string | null; emptyHint?: string; onView: (src: string) => void }) {
  const src = useAuthedImage(url, token)
  return (
    <div>
      <div className="mb-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-text-dim">{label}</div>
      <button
        type="button"
        disabled={!src}
        onClick={() => src && onView(src)}
        className="block h-32 w-full overflow-hidden border border-ink-line bg-ink-deep transition-colors enabled:hover:border-accent disabled:cursor-default"
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">{emptyHint ?? 'no imagery'}</div>
        )}
      </button>
    </div>
  )
}

function StreetThumb({ token, studio, onView }: { token: string | null; studio: Studio; onView: (src: string) => void }) {
  const url = studio.address
    ? `/api/signage/street-view?${new URLSearchParams({ address: studio.address, state: studio.state ?? '', postcode: studio.postcode ?? '' }).toString()}`
    : null
  const src = useAuthedImage(url, token)
  return <Thumb src={src} alt={`${studio.name} storefront`} empty={studio.address ? '…' : 'no addr'} onView={onView} />
}

function StaticMapThumb({ token, studio, onView }: { token: string | null; studio: Studio; onView: (src: string) => void }) {
  const url = studio.lat !== null && studio.lng !== null
    ? `/api/signage/static-map?${new URLSearchParams({ lat: String(studio.lat), lng: String(studio.lng) }).toString()}`
    : null
  const src = useAuthedImage(url, token)
  return <Thumb src={src} alt={`${studio.name} map`} empty="no map" onView={onView} />
}

function Thumb({ src, alt, empty, onView }: { src: string | null; alt: string; empty: string; onView: (src: string) => void }) {
  return (
    <button
      type="button"
      disabled={!src}
      onClick={() => src && onView(src)}
      className="h-14 w-20 shrink-0 overflow-hidden border border-ink-line bg-ink-deep transition-colors enabled:hover:border-accent disabled:cursor-default"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-mono text-[0.55rem] uppercase tracking-[0.1em] text-text-dim">{empty}</div>
      )}
    </button>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{children}</div>
}
function Breadcrumb({ brandSlug }: { brandSlug: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/dashboard" className="hover:text-text-pri">Dashboard</Link>
      <span className="text-ink-line">/</span>
      <Link href={withBrand('/dashboard/signage', brandSlug)} className="hover:text-text-pri">Signage</Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Studios</span>
    </div>
  )
}
const INPUT = 'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
