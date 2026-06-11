'use client'

// /dashboard/signage/audit — the instant AI audit tool.
//   • Upload a standards PDF → the AI deciphers it into rules (review + save).
//   • Upload photos → the AI assesses them against the brand rules inline.
// Maintain Technology design system.

import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from '../_components/BrandTabs'
import {
  BTN_GHOST,
  BTN_PRIMARY,
  Crumbs,
  delay,
  Notice,
  NumberedEyebrow,
  railFor,
  REVEAL,
  SignageNav,
  StateGlyph,
  Tally,
  TopoBackdrop,
} from '../_components/ui'

type ShotDef = { slot: string; label: string; instruction: string }
type Brand = { slug?: string; name: string; location_noun: string; location_noun_plural: string; shots: ShotDef[] }
type ExtractedRule = { rule_key: string; rule_text: string; verdict_mode: string; shot: string }
type IngestResult = { applied: boolean; chars: number; scored: number; tiers: Record<string, number>; shots: ShotDef[]; rules: ExtractedRule[] }
type ReportItem = { rule_key: string; rule_text: string; state: 'compliant' | 'fix' | 'review'; detail: string; source_citation: string | null }
type Report = { counts: { compliant: number; fix: number; review: number }; groups: { group: string; items: ReportItem[] }[]; summary: string; disclaimer: string }

export default function SignageAuditPage() {
  const [token, setToken] = useState<string | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [brands, setBrands] = useState<BrandTab[]>([])
  const [brandSlug, setBrandSlug] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'error' | 'ready'>('loading')

  const load = useCallback(async (t: string, brandParam: string | null) => {
    try {
      const q = brandParam ? `?brand=${encodeURIComponent(brandParam)}` : ''
      const res = await fetch(`/api/signage/sweeps${q}`, { headers: { Authorization: `Bearer ${t}` } })
      const json = await res.json().catch(() => ({}))
      if (json?.ok) {
        setBrand(json.brand ?? null)
        setBrands(json.brands ?? [])
        setBrandSlug(json.selected ?? null)
      }
      setAuthState('ready')
    } catch {
      setAuthState((s) => (s === 'ready' ? s : 'error'))
    }
  }, [])

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
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

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <TopoBackdrop />

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 sm:px-10 md:pt-16">
        <div className={REVEAL}>
          <Crumbs
            trail={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Signage', href: withBrand('/dashboard/signage', brandSlug) },
              { label: 'Instant audit' },
            ]}
          />
        </div>
        <h1 className={`mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.25rem)] ${REVEAL}`} style={delay(60)}>
          Instant <span className="text-accent">audit</span>
        </h1>
        <p className={`mt-4 max-w-2xl text-base leading-relaxed text-text-sec ${REVEAL}`} style={delay(120)}>
          Upload a standards PDF and the AI deciphers it into rules. Upload photos and the AI
          checks them against {brand?.name ?? 'the brand'} standards on the spot. The AI triages — HQ decides.
        </p>
        {authState === 'ready' && brands.length > 1 && (
          <div className={`mt-7 ${REVEAL}`} style={delay(160)}>
            <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
          </div>
        )}
        {authState === 'ready' && (
          <div className={`mt-8 ${REVEAL}`} style={delay(200)}>
            <SignageNav active="audit" brandSlug={brandSlug} />
          </div>
        )}
      </section>

      {authState === 'signed-out' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <p className="text-text-sec">Sign in to run an audit.</p>
        </section>
      )}

      {authState === 'error' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <Notice tone="warn">Couldn&rsquo;t load the audit tool — check your connection and refresh the page.</Notice>
        </section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-24 sm:px-10">
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <div className={REVEAL} style={delay(240)}>
              <IngestCard token={token} brandName={brand?.name ?? 'this brand'} brandSlug={brandSlug} />
            </div>
            <div className={REVEAL} style={delay(300)}>
              <AuditCard token={token} brand={brand} brandSlug={brandSlug} />
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

// ── Card 1: upload a standards PDF, AI deciphers the rules ────────────
function IngestCard({ token, brandName, brandSlug }: { token: string | null; brandName: string; brandSlug: string | null }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'idle' | 'reading' | 'saving'>('idle')
  const [result, setResult] = useState<IngestResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = useCallback(
    async (apply: boolean) => {
      if (!token || !file) return
      setBusy(apply ? 'saving' : 'reading')
      setErr(null)
      try {
        // 1. Try to extract the PDF text in the BROWSER (works for any size).
        //    Sending only the text (~30KB) avoids the platform's request-size
        //    limit, which is what caused the "Request Entity Too Large" /
        //    non-JSON crash when posting the whole 50MB+ file.
        let text = ''
        try {
          const { extractText, getDocumentProxy } = await import('unpdf')
          const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
          const r = await extractText(pdf, { mergePages: true })
          text = Array.isArray(r.text) ? r.text.join('\n') : (r.text as string)
        } catch {
          text = ''
        }

        // 2. Choose the upload path.
        const params = new URLSearchParams()
        if (apply) params.set('apply', '1')
        if (brandSlug) params.set('brand', brandSlug)
        const qs = params.toString() ? `?${params.toString()}` : ''
        let res: Response
        if (text.trim().length >= 200) {
          res = await fetch(`/api/signage/ingest${qs}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
        } else if (file.size <= 4 * 1024 * 1024) {
          // Browser couldn't read it, but it's small — let the server parse it.
          const fd = new FormData()
          fd.append('pdf', file)
          res = await fetch(`/api/signage/ingest${qs}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          })
        } else {
          setErr('Could not read that PDF (a scanned image?) and it is too large to upload directly. Try a text-based PDF.')
          return
        }

        const json = await res.json().catch(() => null)
        if (!json) {
          setErr(`Server error (HTTP ${res.status}). Please try again.`)
          return
        }
        if (!json.ok) setErr(humanIngestErr(json.error))
        else setResult(json)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy('idle')
      }
    },
    [token, file, brandSlug],
  )

  return (
    <div className="border border-ink-line bg-ink-card p-6 sm:p-7">
      <NumberedEyebrow n="01">Upload standards PDF</NumberedEyebrow>
      <h2 className="mt-3 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">Decipher the rules</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-sec">
        Drop a brand standards PDF — the AI reads it and proposes the photo shots + a tagged rule set.
      </p>

      <label className="mt-5 block cursor-pointer border border-dashed border-ink-line bg-ink-deep px-5 py-6 text-center transition-colors hover:border-accent/60 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent">
        <input
          type="file"
          accept="application/pdf"
          aria-label="Standards PDF to decipher"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
          className="sr-only"
        />
        <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          {file ? <span className="text-text-pri">{file.name}</span> : 'Choose a PDF — or replace the current one'}
        </span>
      </label>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => run(false)} disabled={!file || busy !== 'idle'} className={BTN_PRIMARY}>
          {busy === 'reading' ? 'Deciphering…' : 'Decipher PDF'}
        </button>
        {result && !result.applied && (
          <button type="button" onClick={() => run(true)} disabled={busy !== 'idle'} className={BTN_GHOST}>
            {busy === 'saving' ? 'Saving…' : `Save ${result.rules.length} rules to ${brandName}`}
          </button>
        )}
      </div>

      {err && <p role="alert" className="mt-3 text-sm text-warning-bright">{err}</p>}

      {result && (
        <div className={`mt-5 border border-ink-line bg-ink-deep p-5 ${REVEAL}`}>
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {result.applied ? '✓ Saved' : 'AI found'} · {result.rules.length} rule{result.rules.length === 1 ? '' : 's'} ·{' '}
            {result.scored} AI-scorable · {result.shots.length} shot{result.shots.length === 1 ? '' : 's'}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
            {Object.entries(result.tiers).map(([k, v]) => (
              <span key={k} className="border border-ink-line px-2 py-1">
                {k} <span className="tabular-nums text-text-sec">{v}</span>
              </span>
            ))}
          </div>
          <div tabIndex={0} role="region" aria-label="Extracted rules" className="mt-3 max-h-56 overflow-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40">
            {result.rules.slice(0, 30).map((r) => (
              <div key={r.rule_key} className="border-b border-ink-line/60 py-1.5 text-xs leading-relaxed text-text-sec">
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">{r.verdict_mode}</span> {r.rule_text}
              </div>
            ))}
            {result.rules.length > 30 && <p className="mt-2 text-xs text-text-dim">+{result.rules.length - 30} more…</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Card 2: upload photos, AI assesses against the rules ──────────────
function AuditCard({ token, brand, brandSlug }: { token: string | null; brand: Brand | null; brandSlug: string | null }) {
  const [files, setFiles] = useState<Record<string, File[]>>({})
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const total = Object.values(files).reduce((n, f) => n + f.length, 0)

  const run = useCallback(async () => {
    if (!token) return
    setBusy(true); setErr(null); setReport(null)
    try {
      const fd = new FormData()
      for (const [slot, list] of Object.entries(files)) for (const f of list) fd.append(slot, f)
      const q = brandSlug ? `?brand=${encodeURIComponent(brandSlug)}` : ''
      const res = await fetch(`/api/signage/audit${q}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const json = await res.json().catch(() => null)
      if (!json) {
        setErr(res.status === 413 ? 'Those photos are too large to send together — try fewer or smaller images.' : `Server error (HTTP ${res.status}).`)
        return
      }
      if (!json.ok) setErr(json.error)
      else setReport(json.report)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [token, files, brandSlug])

  return (
    <div className="border border-ink-line bg-ink-card p-6 sm:p-7">
      <NumberedEyebrow n="02">Upload photos</NumberedEyebrow>
      <h2 className="mt-3 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">Assess compliance</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-sec">Add a photo per shot; the AI scores them against the rules instantly.</p>

      <div className="mt-5 grid gap-3">
        {(brand?.shots ?? []).map((s) => {
          const picked = files[s.slot]?.length ?? 0
          return (
            <div key={s.slot} className={`border border-ink-line bg-ink-deep px-4 py-3 ${picked > 0 ? 'border-l-2 border-l-teal-glow/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent">{s.label}</span>
                {picked > 0 && (
                  <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-teal-glow">
                    <span className="tabular-nums">{picked}</span> ✓
                  </span>
                )}
              </div>
              <input
                type="file" accept="image/*" multiple
                aria-label={`Photos for ${s.label}`}
                onChange={(e) => setFiles((p) => ({ ...p, [s.slot]: e.target.files ? Array.from(e.target.files) : [] }))}
                className="mt-2 block w-full text-xs text-text-sec file:mr-3 file:cursor-pointer file:border-0 file:bg-ink-line file:px-3 file:py-1.5 file:font-mono file:text-[0.65rem] file:font-semibold file:uppercase file:tracking-[0.1em] file:text-text-pri"
              />
            </div>
          )
        })}
      </div>

      <button type="button" onClick={run} disabled={busy || total === 0} className={`mt-5 ${BTN_PRIMARY}`}>
        {busy ? 'Assessing…' : <>Assess {total} photo{total === 1 ? '' : 's'} <span aria-hidden="true">&rarr;</span></>}
      </button>
      {busy && (
        <p role="status" className="mt-3 text-sm text-text-sec">
          <span className="mr-2 inline-block h-2.5 w-2.5 bg-accent motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]" aria-hidden="true" />
          Scoring your photos against the rule set…
        </p>
      )}
      {err && <p role="alert" className="mt-3 text-sm text-warning-bright">{err}</p>}

      {report && (
        <div className={`mt-6 ${REVEAL}`}>
          <div className="grid grid-cols-3 gap-2">
            <Tally label="Compliant" value={report.counts.compliant} tone="good" />
            <Tally label="To fix" value={report.counts.fix} tone="warn" />
            <Tally label="Needs review" value={report.counts.review} tone="accent" />
          </div>
          <div className="mt-5 grid gap-4">
            {report.groups.map((g) => (
              <div key={g.group}>
                <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{g.group}</div>
                <div className="mt-1.5 grid gap-1.5">
                  {g.items.map((it) => (
                    <div key={it.rule_key} className={`flex items-start gap-2.5 border border-ink-line bg-ink-deep px-3 py-2.5 ${railFor(it.state)}`}>
                      <StateGlyph state={it.state} />
                      <p className="text-xs leading-relaxed text-text-pri">{it.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 border-t border-ink-line pt-4 text-[0.68rem] leading-relaxed text-text-dim">{report.disclaimer}</p>
        </div>
      )}
    </div>
  )
}

function humanIngestErr(code: string): string {
  if (code === 'pdf_too_large') return 'That PDF is over 60MB — please use a smaller file.'
  if (code === 'not_a_pdf') return 'Please upload a PDF file.'
  if (code === 'no_text_extracted') return 'No readable text found (a scanned-image PDF?). Try a text-based PDF.'
  if (code === 'no_rules_extracted') return 'The AI could not extract rules from that document.'
  if (code === 'pdf_parse_failed') return 'Could not read that PDF.'
  return 'Something went wrong — please try again.'
}
