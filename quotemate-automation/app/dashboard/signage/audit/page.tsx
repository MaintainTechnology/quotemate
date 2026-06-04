'use client'

// /dashboard/signage/audit — the instant AI audit tool.
//   • Upload a standards PDF → the AI deciphers it into rules (review + save).
//   • Upload photos → the AI assesses them against the brand rules inline.
// Maintain Technology design system.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'

type ShotDef = { slot: string; label: string; instruction: string }
type Brand = { name: string; location_noun: string; location_noun_plural: string; shots: ShotDef[] }
type ExtractedRule = { rule_key: string; rule_text: string; verdict_mode: string; shot: string }
type IngestResult = { applied: boolean; chars: number; scored: number; tiers: Record<string, number>; shots: ShotDef[]; rules: ExtractedRule[] }
type ReportItem = { rule_key: string; rule_text: string; state: 'compliant' | 'fix' | 'review'; detail: string; source_citation: string | null }
type Report = { counts: { compliant: number; fix: number; review: number }; groups: { group: string; items: ReportItem[] }[]; summary: string; disclaimer: string }

export default function SignageAuditPage() {
  const [token, setToken] = useState<string | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (!t) return setAuthState('signed-out')
      const res = await fetch('/api/signage/sweeps', { headers: { Authorization: `Bearer ${t}` } })
      const json = await res.json().catch(() => ({}))
      if (json?.ok) setBrand(json.brand ?? null)
      setAuthState('ready')
    })
  }, [])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-14 pb-8 sm:px-10 md:pt-16">
        <Breadcrumb />
        <h1 className="mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.25rem)]">
          Instant <span className="text-accent">audit</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-text-sec">
          Upload a standards PDF and the AI deciphers it into rules. Upload photos and the AI
          checks them against {brand?.name ?? 'the brand'} standards on the spot. The AI triages — HQ decides.
        </p>
      </section>

      {authState === 'signed-out' && (
        <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10"><p className="text-text-sec">Sign in to run an audit.</p></section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24 sm:px-10">
          <div className="grid gap-6 lg:grid-cols-2">
            <IngestCard token={token} brandName={brand?.name ?? 'this brand'} />
            <AuditCard token={token} brand={brand} />
          </div>
        </section>
      )}
    </main>
  )
}

// ── Card 1: upload a standards PDF, AI deciphers the rules ────────────
function IngestCard({ token, brandName }: { token: string | null; brandName: string }) {
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
        let res: Response
        if (text.trim().length >= 200) {
          res = await fetch(`/api/signage/ingest${apply ? '?apply=1' : ''}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
        } else if (file.size <= 4 * 1024 * 1024) {
          // Browser couldn't read it, but it's small — let the server parse it.
          const fd = new FormData()
          fd.append('pdf', file)
          res = await fetch(`/api/signage/ingest${apply ? '?apply=1' : ''}`, {
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
    [token, file],
  )

  return (
    <div className="border border-ink-line bg-ink-card p-6 sm:p-7">
      <Eyebrow n="01">Upload standards PDF</Eyebrow>
      <h2 className="mt-2 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">Decipher the rules</h2>
      <p className="mt-2 text-sm text-text-sec">
        Drop a brand standards PDF — the AI reads it and proposes the photo shots + a tagged rule set.
      </p>

      <input
        type="file"
        accept="application/pdf"
        aria-label="Standards PDF to decipher"
        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
        className="mt-4 block w-full text-sm text-text-sec file:mr-4 file:border-0 file:bg-accent file:px-4 file:py-2.5 file:font-mono file:text-xs file:font-semibold file:uppercase file:tracking-[0.12em] file:text-white"
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={!file || busy !== 'idle'}
          className="bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-50"
        >
          {busy === 'reading' ? 'Deciphering…' : 'Decipher PDF'}
        </button>
        {result && !result.applied && (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={busy !== 'idle'}
            className="border border-ink-line px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {busy === 'saving' ? 'Saving…' : `Save ${result.rules.length} rules to ${brandName}`}
          </button>
        )}
      </div>

      {err && <p className="mt-3 text-sm text-warning">{err}</p>}

      {result && (
        <div className="mt-5 border border-ink-line bg-ink-deep p-5">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {result.applied ? '✓ Saved' : 'AI found'} · {result.rules.length} rules · {result.scored} AI-scorable · {result.shots.length} shots
          </div>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
            {Object.entries(result.tiers).map(([k, v]) => <span key={k} className="border border-ink-line px-2 py-1">{k} {v}</span>)}
          </div>
          <div className="mt-3 max-h-56 overflow-auto">
            {result.rules.slice(0, 30).map((r) => (
              <div key={r.rule_key} className="border-b border-ink-line/60 py-1.5 text-xs text-text-sec">
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
function AuditCard({ token, brand }: { token: string | null; brand: Brand | null }) {
  const [files, setFiles] = useState<Record<string, File[]>>({})
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [overall, setOverall] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const total = Object.values(files).reduce((n, f) => n + f.length, 0)

  const run = useCallback(async () => {
    if (!token) return
    setBusy(true); setErr(null); setReport(null)
    try {
      const fd = new FormData()
      for (const [slot, list] of Object.entries(files)) for (const f of list) fd.append(slot, f)
      const res = await fetch('/api/signage/audit', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const json = await res.json().catch(() => null)
      if (!json) {
        setErr(res.status === 413 ? 'Those photos are too large to send together — try fewer or smaller images.' : `Server error (HTTP ${res.status}).`)
        return
      }
      if (!json.ok) setErr(json.error)
      else { setReport(json.report); setOverall(json.overall) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [token, files])

  return (
    <div className="border border-ink-line bg-ink-card p-6 sm:p-7">
      <Eyebrow n="02">Upload photos</Eyebrow>
      <h2 className="mt-2 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">Assess compliance</h2>
      <p className="mt-2 text-sm text-text-sec">Add a photo per shot; the AI scores them against the rules instantly.</p>

      <div className="mt-4 grid gap-3">
        {(brand?.shots ?? []).map((s) => (
          <div key={s.slot} className="border border-ink-line bg-ink-deep px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent">{s.label}</span>
              {(files[s.slot]?.length ?? 0) > 0 && <span className="font-mono text-[0.66rem] text-teal-glow">{files[s.slot].length} ✓</span>}
            </div>
            <input
              type="file" accept="image/*" multiple
              aria-label={`Photos for ${s.label}`}
              onChange={(e) => setFiles((p) => ({ ...p, [s.slot]: e.target.files ? Array.from(e.target.files) : [] }))}
              className="mt-2 block w-full text-xs text-text-sec file:mr-3 file:border-0 file:bg-ink-line file:px-3 file:py-1.5 file:font-mono file:text-[0.65rem] file:font-semibold file:uppercase file:tracking-[0.1em] file:text-text-pri"
            />
          </div>
        ))}
      </div>

      <button
        type="button" onClick={run} disabled={busy || total === 0}
        className="mt-4 inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-50"
      >
        {busy ? 'Assessing…' : <>Assess {total} photo{total === 1 ? '' : 's'} <span aria-hidden="true">&rarr;</span></>}
      </button>
      {err && <p className="mt-3 text-sm text-warning">{err}</p>}

      {report && (
        <div className="mt-5">
          <div className="grid grid-cols-3 gap-2">
            <Tally label="Compliant" value={report.counts.compliant} tone="good" />
            <Tally label="To fix" value={report.counts.fix} tone="warn" />
            <Tally label="Review" value={report.counts.review} tone="accent" />
          </div>
          <div className="mt-4 grid gap-3">
            {report.groups.map((g) => (
              <div key={g.group}>
                <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{g.group}</div>
                <div className="mt-1.5 grid gap-1.5">
                  {g.items.map((it) => (
                    <div key={it.rule_key} className="flex items-start gap-2 border border-ink-line bg-ink-deep px-3 py-2">
                      <Icon state={it.state} />
                      <p className="text-xs text-text-pri">{it.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[0.68rem] leading-relaxed text-text-dim">{report.disclaimer}</p>
        </div>
      )}
    </div>
  )
}

function Icon({ state }: { state: 'compliant' | 'fix' | 'review' }) {
  if (state === 'compliant') return <span className="text-teal-glow">✓</span>
  if (state === 'fix') return <span className="text-warning">✕</span>
  return <span className="text-accent">◑</span>
}
function Tally({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'accent' }) {
  const c = tone === 'good' ? 'text-teal-glow' : tone === 'warn' ? 'text-warning' : 'text-accent'
  return (
    <div className="border border-ink-line bg-ink-deep p-3 text-center">
      <div className={`font-mono text-2xl font-bold tabular-nums ${c}`}>{value}</div>
      <div className="mt-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-text-dim">{label}</div>
    </div>
  )
}
function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-3xl font-bold leading-none text-accent">{n}</span>
      <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-text-dim">{children}</span>
    </div>
  )
}
function Breadcrumb() {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/dashboard" className="hover:text-text-pri">Dashboard</Link>
      <span className="text-ink-line">/</span>
      <Link href="/dashboard/signage" className="hover:text-text-pri">Signage</Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Instant audit</span>
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
