'use client'

// The tradie-typed job quoter for electrical + plumbing. Pick a job type, the
// form re-renders with that job's fields (lib/quote/job-fields.ts), submit, and
// you land on the drafted quote.
//
// Never sends anything to the customer — /api/tenant/job-quote drafts with
// tradieDrafted:true, which forces the review gate on. The customer only hears
// from us when the tradie presses Send on the quote page.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthToken } from '@/lib/auth/client-token'
import { IntakeSchema, deriveTradeFromJobType } from '@/lib/intake/schema'
import { formatJobType } from '@/lib/historical-quotes/job-types'
import { fieldsForJobType } from '@/lib/quote/job-fields'

const INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
const LABEL = 'block font-mono text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-text-dim'

const JOB_TYPES = IntakeSchema.shape.job_type.options as readonly string[]

/** "an electrical job" / "a plumbing job" — the trades are a closed set, so
 *  spell the article out rather than guessing from the first letter. */
const ARTICLE: Record<string, string> = { electrical: 'an', plumbing: 'a' }

type CatalogueRow = { id: string; name: string; category: string | null; trade: string | null }

export default function JobQuoteForm({ trade }: { trade: 'electrical' | 'plumbing' }) {
  const router = useRouter()

  // Offer exactly the job types the server will gate to this trade. Using the
  // same function the route uses means the dropdown can't drift from the
  // feature gate — including 'other', which derives to electrical, so it
  // shows on the electrical form only.
  const jobTypes = useMemo(
    () => JOB_TYPES.filter((jt) => deriveTradeFromJobType(jt) === trade),
    [trade],
  )

  const [jobType, setJobType] = useState<string>(jobTypes[0] ?? '')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [address, setAddress] = useState('')
  const [suburb, setSuburb] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerMobile, setCustomerMobile] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [productName, setProductName] = useState('')
  const [catalogue, setCatalogue] = useState<CatalogueRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spec = useMemo(() => fieldsForJobType(jobType), [jobType])

  // Changing job type discards the previous job's answers — the field codes
  // differ per job, so carrying them over would smuggle a stale answer into
  // the transcript under a code the new job doesn't render.
  function pickJobType(next: string) {
    setJobType(next)
    setAnswers({})
    setProductName('')
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = await getAuthToken()
      if (!token) return
      try {
        const res = await fetch('/api/tenant/catalogue', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const json = (await res.json()) as { ok?: boolean; catalogue?: CatalogueRow[] }
        if (!cancelled && json.ok) setCatalogue(json.catalogue ?? [])
      } catch {
        /* the product picker is optional — a catalogue fetch failure just hides it */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Only worth showing when there's an actual choice to make.
  const products = useMemo(() => {
    if (!spec.catalogueCategory) return []
    return catalogue.filter((c) => c.category === spec.catalogueCategory)
  }, [catalogue, spec.catalogueCategory])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!address.trim() || !suburb.trim()) {
      setError('Address and suburb are required — the estimator prices by location.')
      return
    }
    setBusy(true)
    try {
      const token = await getAuthToken()
      if (!token) {
        setError('Your session expired. Reload the page and sign in again.')
        return
      }
      const res = await fetch('/api/tenant/job-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          job_type: jobType,
          address: address.trim(),
          suburb: suburb.trim(),
          answers,
          notes: notes.trim(),
          customer_name: customerName.trim(),
          customer_mobile: customerMobile.trim(),
          customer_email: customerEmail.trim(),
          ...(productName ? { product_name: productName } : {}),
        }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        shareToken?: string | null
        error?: string
        reason?: string
        issues?: string[]
      }
      if (!json.ok || !json.shareToken) {
        setError(
          json.issues?.join(', ') ??
            (json.error === 'not_entitled'
              ? `Quoting is not enabled on your plan${json.reason ? ` (${json.reason})` : ''}.`
              : `Could not draft the quote${json.error ? ` — ${json.error}` : ''}.`),
        )
        return
      }
      router.push(`/dashboard/quote/${json.shareToken}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong drafting the quote.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
        <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
          <Link href="/dashboard" className="transition-colors hover:text-text-pri">
            Dashboard
          </Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">{formatJobType(trade)} job quote</span>
        </div>

        <h1 className="mt-6 text-3xl font-extrabold uppercase tracking-[-0.02em] sm:text-4xl">
          Quote {ARTICLE[trade]} {trade} job
        </h1>
        <p className="mt-4 text-base leading-relaxed text-text-sec">
          Pick the job type, fill in what you know, and we&rsquo;ll draft the quote. Nothing is sent
          to the customer until you press Send on the quote.
        </p>

        <form onSubmit={submit} className="rounded-card mt-8 border border-ink-line bg-ink-card p-6 sm:p-9">
          <div className="space-y-6">
            <div>
              <label htmlFor="job-type" className={LABEL}>
                Job type
              </label>
              <select
                id="job-type"
                value={jobType}
                onChange={(e) => pickJobType(e.target.value)}
                className={`${INPUT} mt-2`}
              >
                {jobTypes.map((jt) => (
                  <option key={jt} value={jt}>
                    {formatJobType(jt)}
                  </option>
                ))}
              </select>
              {spec.usuallyInspection && (
                <p className="mt-3 border-l-2 border-l-accent pl-3 text-sm leading-relaxed text-text-sec">
                  This job type has no standard priced assembly, so unless you&rsquo;ve added your
                  own it will usually come back as an on-site inspection quote rather than a price.
                </p>
              )}
            </div>

            {spec.fields.map((f) => (
              <div key={f.code}>
                <label htmlFor={`f-${f.code}`} className={LABEL}>
                  {f.label}
                </label>
                {f.type === 'select' ? (
                  <select
                    id={`f-${f.code}`}
                    value={answers[f.code] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.code]: e.target.value }))}
                    className={`${INPUT} mt-2`}
                  >
                    <option value="">Not specified</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`f-${f.code}`}
                    type={f.type === 'number' ? 'number' : 'text'}
                    min={f.type === 'number' ? 1 : undefined}
                    value={answers[f.code] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.code]: e.target.value }))}
                    className={`${INPUT} mt-2`}
                  />
                )}
              </div>
            ))}

            {products.length >= 2 && (
              <div>
                <label htmlFor="product" className={LABEL}>
                  Product from your catalogue (optional)
                </label>
                <select
                  id="product"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className={`${INPUT} mt-2`}
                >
                  <option value="">Let the estimator choose</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="address" className={LABEL}>
                  Address
                </label>
                <input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={`${INPUT} mt-2`}
                  placeholder="12 Smith St"
                />
              </div>
              <div>
                <label htmlFor="suburb" className={LABEL}>
                  Suburb
                </label>
                <input
                  id="suburb"
                  value={suburb}
                  onChange={(e) => setSuburb(e.target.value)}
                  className={`${INPUT} mt-2`}
                  placeholder="Newtown"
                />
              </div>
            </div>

            <div>
              <label htmlFor="notes" className={LABEL}>
                Anything else about the job
              </label>
              <textarea
                id="notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${INPUT} mt-2`}
                placeholder="Access, existing wiring, age of the property, anything that changes the price."
              />
            </div>

            <fieldset className="border-t border-ink-line pt-6">
              <legend className="sr-only">Customer contact</legend>
              <p className="text-sm leading-relaxed text-text-sec">
                Customer details are optional. Adding them now means sending the quote later is one
                click — we still won&rsquo;t contact them until you do.
              </p>
              <div className="mt-5 grid gap-6 sm:grid-cols-3">
                <div>
                  <label htmlFor="cname" className={LABEL}>
                    Name
                  </label>
                  <input
                    id="cname"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className={`${INPUT} mt-2`}
                  />
                </div>
                <div>
                  <label htmlFor="cmobile" className={LABEL}>
                    Mobile
                  </label>
                  <input
                    id="cmobile"
                    type="tel"
                    value={customerMobile}
                    onChange={(e) => setCustomerMobile(e.target.value)}
                    className={`${INPUT} mt-2`}
                    placeholder="04.."
                  />
                </div>
                <div>
                  <label htmlFor="cemail" className={LABEL}>
                    Email
                  </label>
                  <input
                    id="cemail"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className={`${INPUT} mt-2`}
                  />
                </div>
              </div>
            </fieldset>

            {error && (
              <p
                role="alert"
                className="border-l-2 border-l-accent bg-ink-deep px-4 py-3 text-sm leading-relaxed text-text-pri"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-accent px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.14em] text-ink-deep transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Drafting the quote…' : 'Draft the quote'}
            </button>
            {busy && (
              <p aria-live="polite" className="text-center text-sm text-text-sec">
                Pricing the job — this takes up to a couple of minutes. Don&rsquo;t close the tab.
              </p>
            )}
          </div>
        </form>
      </div>
    </main>
  )
}
