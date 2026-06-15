'use client'

// Client lead-capture form for the /t/<slug> landing page. Maintain dark
// styling; the tenant's brand_color is the accent. Photo-first: at least
// one photo is required so the AI has something to work with.
//
// Service selector is driven by the tenant's ENABLED trades (passed from
// the server component). The choice is folded into the free-text
// description so trade detection improves WITHOUT changing the
// /api/t/<slug>/lead contract (it still reads name/mobile/suburb/
// description/photos/company).

import { useState, type CSSProperties, type FormEvent } from 'react'

type Service = { key: string; label: string }

export function LeadForm({
  slug,
  accent,
  services,
}: {
  slug: string
  accent: string
  services: Service[]
}) {
  const [photos, setPhotos] = useState<File[]>([])
  const [service, setService] = useState<string>('') // selected service label
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [suburb, setSuburb] = useState('')
  const [description, setDescription] = useState('')
  const [company, setCompany] = useState('') // honeypot
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Only offer a selector when the tradie does more than one thing.
  const showSelector = services.length > 1

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (photos.length === 0) {
      setError('Please add at least one photo of the job.')
      return
    }
    if (!mobile.trim()) {
      setError('Please add your mobile so we can text your quote.')
      return
    }
    setSubmitting(true)
    try {
      // Fold the chosen service into the description — no route change.
      const composedDescription = service
        ? `Service requested: ${service}.${description.trim() ? ` ${description.trim()}` : ''}`
        : description

      const fd = new FormData()
      photos.forEach((p) => fd.append('photos', p))
      fd.append('name', name)
      fd.append('mobile', mobile)
      fd.append('suburb', suburb)
      fd.append('description', composedDescription)
      fd.append('company', company)
      const res = await fetch(`/api/t/${slug}/lead`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message ?? 'Something went wrong — please try again.')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="py-6 text-center">
        <div
          className="mx-auto grid h-12 w-12 place-items-center text-2xl font-bold text-white"
          style={{ background: accent }}
        >
          ✓
        </div>
        <h2 className="mt-4 text-lg font-extrabold uppercase tracking-tight text-text-pri">
          You&rsquo;re all set
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-sec">
          We&rsquo;ve got your details. You&rsquo;ll get a text with your quote
          shortly.
        </p>
      </div>
    )
  }

  const labelCls =
    'font-mono text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-text-dim'
  const inputCls =
    'mt-2 w-full border border-ink-line bg-ink-deep px-3.5 py-2.5 text-sm text-text-pri placeholder:text-text-dim outline-none transition-colors focus:border-[color:var(--brand)]'
  const brandVar = { ['--brand' as string]: accent } as CSSProperties

  return (
    <form onSubmit={handleSubmit} className="space-y-6" style={brandVar}>
      {showSelector && (
        <div>
          <span className={labelCls}>What do you need?</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {services.map((s) => {
              const selected = service === s.label
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setService(selected ? '' : s.label)}
                  className="border px-3.5 py-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.06em] transition-colors"
                  style={
                    selected
                      ? { background: accent, borderColor: accent, color: '#fff' }
                      : { borderColor: 'var(--color-ink-line, #2D3A4F)', color: 'var(--color-text-sec, #B8C2D1)' }
                  }
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="lf-photos" className={labelCls}>Photo of the job *</label>
        <input
          id="lf-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))}
          className="mt-2 w-full text-sm text-text-sec file:mr-3 file:cursor-pointer file:border-0 file:px-4 file:py-2 file:font-mono file:text-xs file:font-semibold file:uppercase file:tracking-wider file:text-white"
          style={{ ['--file-bg' as string]: accent }}
        />
        {photos.length > 0 && (
          <p className="mt-1.5 text-xs text-text-dim">
            {photos.length} photo{photos.length > 1 ? 's' : ''} selected
          </p>
        )}
      </div>

      <div>
        <label htmlFor="lf-desc" className={labelCls}>Tell us about the job</label>
        <textarea
          id="lf-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="e.g. install 6 downlights, hot water not working, roof leaking after the storm…"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="lf-name" className={labelCls}>Your name</label>
          <input id="lf-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="lf-suburb" className={labelCls}>Suburb</label>
          <input id="lf-suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="lf-mobile" className={labelCls}>Mobile *</label>
        <input
          id="lf-mobile"
          type="tel"
          inputMode="tel"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          placeholder="04xx xxx xxx"
          className={inputCls}
        />
        <p className="mt-1.5 text-xs text-text-dim">We&rsquo;ll text your quote here.</p>
      </div>

      {/* Honeypot — hidden from humans, catches bots. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="hidden"
        aria-hidden="true"
      />

      {error && <p className="text-sm text-warning">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3.5 text-sm font-bold uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: accent }}
      >
        {submitting ? 'Sending…' : 'Get my quote'}
      </button>
    </form>
  )
}
