'use client'

// The tradie-typed job quoter for electrical + plumbing. Pick a job type, the
// form re-renders with that job's fields (lib/quote/job-fields.ts), submit, and
// you land on the drafted quote.
//
// Never sends anything to the customer — /api/tenant/job-quote drafts with
// tradieDrafted:true, which forces the review gate on. The customer only hears
// from us when the tradie presses Send on the quote page.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthToken } from '@/lib/auth/client-token'
import { AddressAutocomplete } from '@/app/dashboard/roofing/_components/AddressAutocomplete'
import { IntakeSchema, deriveTradeFromJobType } from '@/lib/intake/schema'
import { formatJobType } from '@/lib/historical-quotes/job-types'
import {
  allowsPinnedCatalogueProduct,
  fieldsForJobType,
} from '@/lib/quote/job-fields'

const INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
const LABEL = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-text-dim'

const JOB_TYPES = IntakeSchema.shape.job_type.options as readonly string[]

/** Spec ev-charger-location-photo R1 — matches MAX_FILES on
 *  /api/tenant/job-quote/photos and EV_MAX_IMAGES on the estimate document. */
const EV_MAX_PHOTOS = 3
const EV_PHOTO_MIME = 'image/jpeg,image/png,image/webp'

/** "an electrical job" / "a plumbing job" — the trades are a closed set, so
 *  spell the article out rather than guessing from the first letter. */
const ARTICLE: Record<string, string> = { electrical: 'an', plumbing: 'a' }

// Keep the fields the picker actually shows. /api/tenant/catalogue does a
// select('*'), so price/image/brand are already on the wire — the first cut of
// this form threw them away and left the tradie choosing blind between a $36
// and a $287 GPO by name alone.
type CatalogueRow = {
  id: string
  name: string
  category: string | null
  trade: string | null
  brand: string | null
  range_series: string | null
  unit_price_ex_gst: number | string | null
  image_path: string | null
  tier_hint: string | null
  active: boolean | null
}

/**
 * Pull the suburb out of a Geoscape address line. The provider returns no
 * discrete suburb, so this takes the last comma-separated part and strips a
 * trailing state and/or postcode: "12 Smith St, Penrith NSW 2750" → "Penrith".
 * Returns null when it cannot tell, so a wrong guess never overwrites a blank.
 *
 * Exported for the unit test.
 */
export function suburbFromAddress(
  address: string,
  state?: string | null,
  postcode?: string | null,
): string | null {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  let tail = parts[parts.length - 1]
  if (postcode) tail = tail.replace(postcode, '')
  if (state) tail = tail.replace(new RegExp(`\\b${state}\\b`, 'i'), '')
  // Belt and braces for a tail like "Penrith NSW 2750" when the provider gave
  // us neither state nor postcode separately.
  tail = tail.replace(/\b\d{4}\b/g, '')
  tail = tail.replace(/\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/gi, '')
  const suburb = tail.replace(/\s+/g, ' ').trim()
  return suburb.length > 1 ? suburb : null
}

/**
 * Turn the route's failure envelope into something a tradie can act on.
 *
 * Every branch here is a real shape the route or its guard returns. Before this,
 * only `issues` and `not_entitled` were handled and everything else rendered an
 * internal slug — "Could not draft the quote — pipeline_failed" tells a tradie
 * standing in a driveway nothing about whether to retry, fix something, or ring
 * support.
 *
 * Exported for the unit test; pure so it needs no fixtures.
 */
export function explainFailure(
  status: number,
  json: { error?: string; reason?: string; issues?: string[]; intakeId?: string },
): string {
  if (json.issues?.length) return json.issues.join(', ')

  const checkFirst = ' The quote may still have been drafted — check the Quotes tab before retrying.'

  switch (json.error) {
    case 'unauthorized':
      return 'Your session expired. Reload the page and sign in again.'
    case 'no_tenant':
      return 'No tradie account is linked to this login. Ask the QuoteMax team to check your account.'
    case 'feature_not_enabled':
      return "This trade isn't enabled on your account. Ask the QuoteMax team to switch it on."
    case 'not_entitled':
    case 'voice_not_entitled':
      return `Quoting is not enabled on your plan${json.reason ? ` (${json.reason})` : ''}.`
    case 'invalid_body':
      return 'Some answers were rejected. Check the fields and try again.'
    case 'intake_insert_failed':
      return 'The job was priced but could not be saved. Try again — nothing was charged.'
    case 'draft_failed':
    case 'draft_incomplete':
      // The intake exists; the estimator leg failed. Retrying re-drafts from
      // scratch and would leave two intakes behind.
      return `The job was saved but the quote did not finish drafting.${json.intakeId ? checkFirst : ' Try again in a moment.'}`
    case 'pipeline_failed':
      // Usually an upstream model blip (Anthropic 529, embedding provider).
      return `Drafting failed part-way — usually a temporary upstream problem. Wait a moment and try again.${json.intakeId ? checkFirst : ''}`
  }

  if (status === 504 || status === 502) {
    return `The request timed out.${checkFirst}`
  }
  return `Could not draft the quote (${status}).${checkFirst}`
}

/** Ex-GST, whole dollars — matches how the SMS picker presents a product. */
function priceLabel(v: number | string | null): string | null {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return n != null && Number.isFinite(n) ? `$${Math.round(n)}` : null
}

/**
 * Clear a stale EV unit whenever supply changes away from the exact tradie-
 * supplied contract. Exported so the state transition is unit-testable without
 * rendering the authenticated form.
 */
export function productNameAfterAnswerChange(
  jobType: string,
  fieldCode: string,
  nextValue: string,
  currentProductName: string,
): string {
  if (
    jobType === 'ev_charger' &&
    fieldCode === 'charger_supply' &&
    !allowsPinnedCatalogueProduct(jobType, { charger_supply: nextValue })
  ) {
    return ''
  }
  return currentProductName
}

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
  // Spec ev-charger-location-photo R1 — optional photos of the charger spot.
  // Uploaded on pick (so the submit body stays small and validated) and carried
  // into the submit as storage paths. EV charger only.
  const [photoPaths, setPhotoPaths] = useState<string[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [photoBusy, setPhotoBusy] = useState(false)
  // Held only for AddressAutocomplete, which takes a token as a prop. Every
  // actual submit still mints a fresh one — a captured token expires.
  const [token, setToken] = useState<string | null>(null)

  const spec = useMemo(() => fieldsForJobType(jobType), [jobType])

  // Changing job type discards the previous job's answers — the field codes
  // differ per job, so carrying them over would smuggle a stale answer into
  // the transcript under a code the new job doesn't render.
  function pickJobType(next: string) {
    setJobType(next)
    setAnswers({})
    setProductName('')
    // The photo control is EV-only, so leaving paths behind would attach a
    // charger-spot photo to whatever job the tradie switched to.
    setPhotoPaths([])
    setPhotoUrls([])
  }

  /** R1/R2 — upload on pick. An upload failure NEVER blocks the submit: the
   *  photo is optional on this surface, so the tradie still gets their quote. */
  const uploadPhotos = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length === 0) return
    if (picked.length > EV_MAX_PHOTOS) {
      setError(`Up to ${EV_MAX_PHOTOS} photos.`)
      return
    }
    setPhotoBusy(true)
    setError(null)
    try {
      const t = await getAuthToken()
      if (!t) throw new Error('not signed in')
      const fd = new FormData()
      for (const f of picked) fd.append('photos', f, f.name)
      // No Content-Type header — the browser must set the multipart boundary.
      const res = await fetch('/api/tenant/job-quote/photos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
        body: fd,
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setPhotoPaths((prev) => [...prev, ...(j.paths as string[])].slice(0, EV_MAX_PHOTOS))
      setPhotoUrls((prev) => [...prev, ...(j.urls as string[])].slice(0, EV_MAX_PHOTOS))
    } catch (e2) {
      setError(
        `Photos did not upload (${e2 instanceof Error ? e2.message : String(e2)}). You can still send the form.`,
      )
    } finally {
      setPhotoBusy(false)
    }
  }, [])

  function updateAnswer(fieldCode: string, nextValue: string) {
    setAnswers((current) => ({ ...current, [fieldCode]: nextValue }))
    if (jobType === 'ev_charger' && fieldCode === 'charger_supply') {
      setProductName((current) =>
        productNameAfterAnswerChange(jobType, fieldCode, nextValue, current),
      )
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const t = await getAuthToken()
      if (!t) return
      if (!cancelled) setToken(t)
      try {
        const res = await fetch('/api/tenant/catalogue', {
          headers: { Authorization: `Bearer ${t}` },
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

  // Cheapest first, so the list reads like the SMS offer. `active` is filtered
  // here because the API returns every row regardless — an archived product
  // must not be offerable. Shown from ONE match, not two: the SMS picker offers
  // a single product as a "we use X" confirmation, and gating at two hid the
  // picker entirely for every tenant holding one product per category.
  const productSelectionAllowed = allowsPinnedCatalogueProduct(jobType, answers)
  const products = useMemo(() => {
    if (!productSelectionAllowed || !spec.catalogueCategory) return []
    return catalogue
      .filter((c) => c.category === spec.catalogueCategory && c.active !== false)
      .sort((a, b) => {
        const pa = typeof a.unit_price_ex_gst === 'string' ? parseFloat(a.unit_price_ex_gst) : a.unit_price_ex_gst
        const pb = typeof b.unit_price_ex_gst === 'string' ? parseFloat(b.unit_price_ex_gst) : b.unit_price_ex_gst
        return (Number.isFinite(pa as number) ? (pa as number) : Infinity) -
          (Number.isFinite(pb as number) ? (pb as number) : Infinity)
      })
  }, [catalogue, productSelectionAllowed, spec.catalogueCategory])

  const chosenProduct = useMemo(
    () => products.find((p) => p.name === productName) ?? null,
    [products, productName],
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Duplicate-submit guard. `disabled` alone is not enough: the button is
    // re-enabled while router.push is still navigating, and a submit that
    // TIMED OUT client-side may well have succeeded server-side — the draft
    // route runs in its own 300s invocation. A second fire would mint a second
    // intake, a second quote, a second set of Stripe sessions and a second
    // tradie notify.
    if (busy) return
    setError(null)
    if (!address.trim() || !suburb.trim()) {
      setError('Address and suburb are required — the estimator prices by location.')
      return
    }
    // The count drives every line-item quantity. Left blank it collapses to 1
    // (lib/estimate/electrical-prompt.ts:37), so a 12-downlight job quotes ONE
    // downlight and looks entirely normal. The SMS path is protected by
    // evaluateIntakeQuality, which only runs inside /api/intake/structure — a
    // route this form deliberately bypasses — so this check is the replacement.
    const countField = spec.fields.find((f) => f.code === 'count')
    if (countField) {
      const raw = (answers.count ?? '').trim()
      const n = Number(raw)
      if (!raw || !Number.isFinite(n) || n <= 0) {
        setError('Enter how many — without a count the quote prices a single item.')
        return
      }
    }
    setBusy(true)
    try {
      const token = await getAuthToken()
      if (!token) {
        setError('Your session expired. Reload the page and sign in again.')
        // MUST clear busy. This is not the success path — leaving it latched
        // combines with the `if (busy) return` guard above to brick the form
        // permanently (the button reads "Drafting the quote…" forever and the
        // live region announces a two-minute wait that will never end), and
        // only a hard reload recovers. getAuthToken returns null on any lapsed
        // session, so this is a routine exit, not an edge case.
        setBusy(false)
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
          ...(productSelectionAllowed && productName ? { product_name: productName } : {}),
          // The id is what makes the pin binding: the server re-reads the row
          // and forces its price. The name alone is only a prompt hint.
          ...(productSelectionAllowed && chosenProduct ? { product_id: chosenProduct.id } : {}),
          // Spec ev-charger-location-photo R3 — already uploaded, so these are
          // storage paths, not files. Sent only when some landed, so a failed
          // or skipped upload leaves the body exactly as it was before.
          ...(photoPaths.length ? { photo_paths: photoPaths } : {}),
          ...(photoUrls.length ? { photo_urls: photoUrls } : {}),
        }),
      })
      // .catch(() => ({})) because a platform timeout or gateway error returns
      // an HTML body, and res.json() then throws "Unexpected token '<'" — which
      // is what the tradie used to see after waiting two minutes. Same pattern as
      // app/dashboard/quote/[token]/SendQuotePanel.tsx.
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        shareToken?: string | null
        error?: string
        reason?: string
        issues?: string[]
        intakeId?: string
        needsInspection?: boolean
      }

      // A share token means the quote EXISTS. Navigate even if some other part
      // of the envelope looks off — erroring here while the quote sits in the
      // Quotes tab is the worst of both worlds.
      if (json.shareToken) {
        // Deliberately no setBusy(false): the button stays disabled through
        // navigation so it cannot be fired again.
        router.push(`/dashboard/quote/${json.shareToken}`)
        return
      }

      setError(explainFailure(res.status, json))
      setBusy(false)
    } catch (err: unknown) {
      // Network drop / abort. The request may still have completed server-side.
      setError(
        `${err instanceof Error ? err.message : 'The connection dropped'} — the quote may still have been drafted. Check the Quotes tab before trying again.`,
      )
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
        <div className="flex flex-wrap items-center gap-3 text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-text-dim">
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
                    onChange={(e) => updateAnswer(f.code, e.target.value)}
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
                    onChange={(e) => updateAnswer(f.code, e.target.value)}
                    className={`${INPUT} mt-2`}
                  />
                )}
              </div>
            ))}

            {productSelectionAllowed && products.length >= 1 && (
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
                  {products.map((p) => {
                    const price = priceLabel(p.unit_price_ex_gst)
                    return (
                      <option key={p.id} value={p.name}>
                        {p.name}
                        {price ? ` — ${price} ex GST` : ''}
                        {p.tier_hint ? ` (${p.tier_hint})` : ''}
                      </option>
                    )
                  })}
                </select>
                {chosenProduct && (
                  <div className="mt-3 flex items-start gap-4 border border-ink-line bg-ink-deep p-3">
                    {chosenProduct.image_path ? (
                      // catalogue-images is a public bucket — image_path is a
                      // ready-to-use URL, same as the dashboard Catalogue tab.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={chosenProduct.image_path}
                        alt=""
                        className="h-16 w-16 flex-shrink-0 border border-ink-line object-cover"
                      />
                    ) : (
                      <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center border border-ink-line text-[0.6rem] uppercase tracking-[0.08em] text-text-dim">
                        No photo
                      </span>
                    )}
                    <span className="min-w-0 text-sm leading-relaxed text-text-sec">
                      {[chosenProduct.brand, chosenProduct.range_series].filter(Boolean).join(' ') ||
                        chosenProduct.name}
                      {priceLabel(chosenProduct.unit_price_ex_gst) && (
                        <span className="mt-1 block font-mono text-text-pri">
                          {priceLabel(chosenProduct.unit_price_ex_gst)} ex GST
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="address" className={LABEL}>
                  Address
                </label>
                {/* Same Geoscape type-ahead the roofing, painting, aircon and
                    signage tools use. Degrades to a plain input if the provider
                    fails, so a typed address always still submits. */}
                <AddressAutocomplete
                  id="address"
                  accessToken={token}
                  value={address}
                  onChange={setAddress}
                  // Fill Suburb too. Picking a suggestion used to leave Suburb
                  // empty, so a tradie who selected a full address from the
                  // type-ahead then failed the completeness check on submit.
                  // Geoscape returns no discrete suburb field, so take the
                  // second-to-last comma part of "12 Smith St, Penrith NSW 2750"
                  // and drop any trailing state/postcode.
                  onSelect={(s) => {
                    setAddress(s.address)
                    // OVERWRITE on a suggestion pick — the provider is
                    // authoritative for the address it just returned. Guarding
                    // on "only if empty" meant correcting a mis-picked address
                    // left the first suburb behind, and Suburb is the field the
                    // tradie stops watching precisely because it filled itself.
                    // A null guess never clobbers what they typed.
                    const guess = suburbFromAddress(s.address, s.state, s.postcode)
                    if (guess) setSuburb(guess)
                  }}
                  placeholder="12 Smith St"
                  // Spacing only — the component styles its own input, so
                  // passing INPUT here would draw a second bordered box.
                  className="mt-2"
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

            {/* Spec ev-charger-location-photo R1 — EV charger only, and
                optional here (it is REQUIRED over SMS, where the receptionist
                cannot see the site any other way). */}
            {jobType === 'ev_charger' ? (
              <div>
                <span className={LABEL}>Photo of the spot (optional)</span>
                <label
                  htmlFor="ev-photos"
                  className="mt-2 flex cursor-pointer items-center justify-center border border-dashed border-ink-line bg-ink-deep px-4 py-6 text-center font-mono text-sm text-text-dim hover:border-accent hover:text-text-pri"
                >
                  {photoBusy
                    ? 'Uploading...'
                    : photoPaths.length > 0
                      ? `${photoPaths.length} photo${photoPaths.length === 1 ? '' : 's'} added - tap to add more`
                      : `Add up to ${EV_MAX_PHOTOS} photos of where the charger is going`}
                  <input
                    id="ev-photos"
                    type="file"
                    accept={EV_PHOTO_MIME}
                    multiple
                    disabled={photoBusy}
                    onChange={uploadPhotos}
                    className="sr-only"
                  />
                </label>
                <p className="mt-2 font-mono text-xs text-text-dim">
                  Helps the quote show the charger in position. JPEG, PNG or WebP.
                </p>
              </div>
            ) : null}

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
                className="rounded-ctl border border-accent/30 bg-ink-deep px-4 py-3 text-sm leading-relaxed text-text-pri"
              >
                {error}
              </p>
            )}

            {/* aria-disabled, not disabled: `disabled` removes the button from
                the tab order mid-submit, so when drafting fails the tradie's
                focus is thrown to the top of the page and they have to Tab all
                the way back (WCAG 2.4.3). The submit handler's `if (busy) return`
                is what actually prevents the double-fire. */}
            <button
              type="submit"
              aria-disabled={busy} aria-busy={busy}
              className="w-full bg-accent px-6 py-4 text-sm font-bold uppercase tracking-[0.08em] text-ink-deep transition-colors hover:bg-accent-press aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {busy ? 'Drafting the quote…' : 'Draft the quote'}
            </button>
            {/* Always rendered. A live region created in the same tick as its
                text is not announced by screen readers, so the two-minute wait
                was silent — the region must exist first and have its text
                swapped. */}
            <p aria-live="polite" className="min-h-5 text-center text-sm text-text-sec">
              {busy ? 'Pricing the job — this takes up to a couple of minutes. Don’t close the tab.' : ''}
            </p>
          </div>
        </form>
      </div>
    </main>
  )
}
