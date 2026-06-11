'use client'

// /dashboard/signage/studios — manage real locations (replaces demo seeds).
//   • Find a studio by name/area (Google Places) → real address + coords.
//   • Or type an address (Geoscape autocomplete) — geocoded live for a map.
//   • Live Street View + map preview as you fill the form; thumbnails open
//     full-size in a lightbox.
//   • Bulk-import a roster CSV. Delete studios (e.g. the demo rows).
// Maintain Technology design system.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { AddressAutocomplete } from '@/app/dashboard/roofing/_components/AddressAutocomplete'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from '../_components/BrandTabs'
import {
  BTN_DANGER_SM,
  BTN_PRIMARY,
  Crumbs,
  delay,
  EmptyState,
  INPUT,
  Label,
  Lightbox,
  Notice,
  NumberedEyebrow,
  REVEAL,
  SignageNav,
  TopoBackdrop,
} from '../_components/ui'

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
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'error' | 'ready'>('loading')
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
    try {
      const q = brandParam ? `?brand=${encodeURIComponent(brandParam)}` : ''
      const res = await fetch(`/api/signage/studios${q}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' })
      if (res.status === 401) return setAuthState('signed-out')
      const json = await res.json()
      if (json.ok) {
        setStudios(json.studios ?? [])
        setBrands(json.brands ?? [])
        setBrandSlug(json.selected ?? null)
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
      void load(token, slug)
    },
    [token, brandSlug, load],
  )

  // Debounced Places search. (Sub-3-char queries clear the results in the
  // input's onChange handler, so the effect never sets state synchronously.
  // The stale flag stops a slow earlier response overwriting a newer query.)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!token || placeQuery.trim().length < 3) return
    let stale = false
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/signage/places/search?q=${encodeURIComponent(placeQuery)}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (!stale) setPlaces(json.ok ? (json.results ?? []) : [])
      } finally {
        if (!stale) setSearching(false)
      }
    }, 350)
    return () => {
      stale = true
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [placeQuery, token])

  // Auto-geocode a typed address so the live map shows (Places picks already
  // carry coords, so this only fires when lat is null).
  useEffect(() => {
    if (geoTimer.current) clearTimeout(geoTimer.current)
    if (!token || lat !== null || address.trim().length < 6) return
    let stale = false
    geoTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/signage/geocode?address=${encodeURIComponent(address)}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.ok && !stale) {
          setLat(json.lat)
          setLng(json.lng)
        }
      } catch {
        /* best-effort */
      }
    }, 600)
    return () => {
      stale = true
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
      } catch {
        setErr('Network error — please try again.')
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
        else setImportMsg(`Imported ${json.created} studio${json.created === 1 ? '' : 's'}; ${json.skipped_existing} already existed.`)
        await load(token, brandSlug)
      } catch {
        setImportMsg('Import failed: network error — please try again.')
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
      try {
        const res = await fetch(`/api/signage/studios/${s.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) await load(token, brandSlug)
      } catch {
        /* network hiccup — the row simply stays; the next action retries */
      }
    },
    [token, brandSlug, load],
  )

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <TopoBackdrop />

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 sm:px-10 md:pt-16">
        <div className={REVEAL}>
          <Crumbs
            trail={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Signage', href: withBrand('/dashboard/signage', brandSlug) },
              { label: 'Studios' },
            ]}
          />
        </div>
        <h1 className={`mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.25rem)] ${REVEAL}`} style={delay(60)}>
          Manage <span className="text-accent">studios</span>
        </h1>
        <p className={`mt-4 max-w-2xl text-base leading-relaxed text-text-sec ${REVEAL}`} style={delay(120)}>
          Add your real locations. Search Google for a studio by name/area, or type an address — we
          geocode it, show a live Street View + map, and you can click any image to view it full-size.
        </p>
        {authState === 'ready' && brands.length > 1 && (
          <div className={`mt-7 ${REVEAL}`} style={delay(160)}>
            <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
          </div>
        )}
        {authState === 'ready' && (
          <div className={`mt-8 ${REVEAL}`} style={delay(200)}>
            <SignageNav active="studios" brandSlug={brandSlug} />
          </div>
        )}
      </section>

      {authState === 'signed-out' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <p className="text-text-sec">Sign in to manage studios.</p>
        </section>
      )}

      {authState === 'error' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <Notice tone="warn">Couldn&rsquo;t load your studios — check your connection and refresh the page.</Notice>
        </section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-24 sm:px-10">
          {/* 01 · Find on Google */}
          <div className={`border border-ink-line bg-ink-card p-7 sm:p-8 ${REVEAL}`} style={delay(240)}>
            <NumberedEyebrow n="01">Find on Google</NumberedEyebrow>
            <div className="mt-4">
              <Label htmlFor="place-query">Search a studio by name or area</Label>
              <div className="relative">
                <input
                  id="place-query"
                  value={placeQuery}
                  onChange={(e) => {
                    const v = e.target.value
                    setPlaceQuery(v)
                    if (v.trim().length < 3) setPlaces([])
                  }}
                  placeholder="e.g. F45 Bondi Beach"
                  className={INPUT}
                />
                {searching && (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[0.7rem] text-text-dim motion-safe:animate-[pulse-soft_1.2s_ease-in-out_infinite]">
                    searching…
                  </span>
                )}
                {places.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto border border-ink-line bg-ink-card">
                    {places.map((p) => (
                      <li key={p.place_id}>
                        <button
                          type="button"
                          // preventDefault keeps the input focused so the list
                          // doesn't blur-close; onClick works for keyboard too.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickPlace(p)}
                          className="w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-ink-line/40 focus-visible:bg-ink-line/40 focus-visible:outline-none"
                        >
                          <div className="font-mono text-sm text-text-pri">{p.name}</div>
                          <div className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">{p.address}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-2 text-xs text-text-dim">Picking a result fills the form below with the real name + address + coordinates.</p>
            </div>
          </div>

          {/* 02 · Add a studio */}
          <form onSubmit={addStudio} className={`mt-5 border border-ink-line bg-ink-card p-7 sm:p-8 ${REVEAL}`} style={delay(300)}>
            <NumberedEyebrow n="02">Add a studio</NumberedEyebrow>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label htmlFor="studio-name">Studio name</Label>
                <input id="studio-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="F45 Bondi" className={INPUT} />
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
                <Label htmlFor="studio-region">Region (optional)</Label>
                <input id="studio-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="AU-NSW" className={INPUT} />
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={busy || !name.trim()} className={BTN_PRIMARY}>
                  {busy ? 'Adding…' : 'Add studio'}
                </button>
              </div>
              {err && <p role="alert" className="md:col-span-2 text-sm text-warning-bright">{err}</p>}
            </div>
          </form>

          {/* 03 · CSV import */}
          <div className={`mt-5 border border-ink-line bg-ink-card p-7 sm:p-8 ${REVEAL}`} style={delay(360)}>
            <NumberedEyebrow n="03">Bulk import</NumberedEyebrow>
            <p className="mt-4 text-sm leading-relaxed text-text-sec">
              Upload a roster CSV. Columns: name (required), address, region, state, postcode, contact_phone, contact_email.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Studio roster CSV"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f) }}
              className="mt-4 block w-full text-sm text-text-sec file:mr-4 file:cursor-pointer file:border-0 file:bg-ink-line file:px-4 file:py-2.5 file:font-mono file:text-xs file:font-semibold file:uppercase file:tracking-[0.12em] file:text-text-pri"
            />
            {importMsg && <p role="status" className="mt-3 text-sm text-text-sec">{importMsg}</p>}
          </div>

          {/* Roster */}
          <h2 className="mt-12 font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
            Roster · <span className="tabular-nums">{studios.length}</span> studio{studios.length === 1 ? '' : 's'}
          </h2>
          {studios.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No studios yet" body="Add one above — search Google, type an address, or bulk-import your roster CSV." />
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {studios.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-4 border border-ink-line bg-ink-card p-4 transition-colors hover:border-accent/40">
                  <StreetThumb token={token} studio={s} onView={setLightbox} />
                  <StaticMapThumb token={token} studio={s} onView={setLightbox} />
                  <div className="min-w-[12rem] flex-1">
                    <div className="font-mono text-sm text-text-pri">{s.name}</div>
                    <div className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
                      {[s.region, s.address].filter(Boolean).join(' · ') || 'No address'}
                    </div>
                  </div>
                  <button type="button" onClick={() => void deleteStudio(s)} aria-label={`Delete ${s.name}`} className={BTN_DANGER_SM}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </main>
  )
}

function useAuthedImage(url: string | null, token: string | null) {
  // Keyed by source URL so a URL change derives to `null` during render —
  // no synchronous setState inside the effect body.
  const [img, setImg] = useState<{ key: string; src: string } | null>(null)
  useEffect(() => {
    if (!url || !token) return
    let revoke: string | null = null
    let cancelled = false
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok || cancelled) return
        const blob = await r.blob()
        // Re-check after the await so we never mint an object URL the
        // cleanup (which already ran) can't revoke.
        if (cancelled) return
        revoke = URL.createObjectURL(blob)
        setImg({ key: url, src: revoke })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [url, token])
  return img && img.key === url ? img.src : null
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
