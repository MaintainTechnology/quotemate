'use client'

// Client lead-capture form for the /t/<slug> landing page. Photo-first:
// at least one photo is required so the AI has something to work with.
// Posts multipart to /api/t/<slug>/lead, then shows a confirmation panel.

import { useState, type FormEvent } from 'react'

export function LeadForm({ slug, accent, trade }: { slug: string; accent: string; trade: 'electrical' | 'plumbing' }) {
  const [photos, setPhotos] = useState<File[]>([])
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [suburb, setSuburb] = useState('')
  const [description, setDescription] = useState('')
  const [company, setCompany] = useState('') // honeypot
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const jobPlaceholder =
    trade === 'plumbing'
      ? 'e.g. hot water system not working, leaking tap…'
      : 'e.g. install 6 downlights, power point not working…'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (photos.length === 0) { setError('Please add at least one photo of the job.'); return }
    if (!mobile.trim()) { setError('Please add your mobile so we can text your quote.'); return }
    setSubmitting(true)
    try {
      const fd = new FormData()
      photos.forEach((p) => fd.append('photos', p))
      fd.append('name', name)
      fd.append('mobile', mobile)
      fd.append('suburb', suburb)
      fd.append('description', description)
      fd.append('company', company)
      const res = await fetch(`/api/t/${slug}/lead`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message ?? 'Something went wrong — please try again.')
      setDone(true)
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-center py-6">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full text-white text-2xl" style={{ background: accent }}>✓</div>
        <h2 className="mt-4 text-xl font-bold">Thanks — you’re all set!</h2>
        <p className="mt-2 text-neutral-600">We’ve got your details. You’ll get a text with your quote shortly.</p>
      </div>
    )
  }

  const inputCls = 'mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2.5 focus:outline-none focus:ring-2'
  const ring = { ['--tw-ring-color' as string]: accent } as React.CSSProperties

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-semibold">Photo of the job *</label>
        <input
          type="file" accept="image/jpeg,image/png,image/webp" multiple
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))}
          className="mt-1 w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-white file:font-semibold"
          style={{ ['--file-bg' as string]: accent }}
        />
        {photos.length > 0 && <p className="mt-1 text-xs text-neutral-500">{photos.length} photo{photos.length > 1 ? 's' : ''} selected</p>}
      </div>

      <div>
        <label className="text-sm font-semibold">What do you need?</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={jobPlaceholder} className={inputCls} style={ring} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold">Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} style={ring} />
        </div>
        <div>
          <label className="text-sm font-semibold">Suburb</label>
          <input value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputCls} style={ring} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold">Mobile *</label>
        <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="04xx xxx xxx" className={inputCls} style={ring} />
        <p className="mt-1 text-xs text-neutral-500">We’ll text your quote here.</p>
      </div>

      {/* Honeypot — hidden from humans, catches bots. */}
      <input
        type="text" tabIndex={-1} autoComplete="off" value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="hidden" aria-hidden="true"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit" disabled={submitting}
        className="w-full rounded-lg py-3 font-semibold text-white disabled:opacity-50"
        style={{ background: accent }}
      >
        {submitting ? 'Sending…' : 'Get my quote'}
      </button>
    </form>
  )
}
