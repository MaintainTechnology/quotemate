'use client'

// Flyer Designer — dashboard tab orchestrator.
//
// Owns all server IO (list / create / open / save / delete / upload / QR /
// export) and the DOM toolbar + properties panel. The interactive canvas is
// the Konva component, dynamically imported (ssr:false) since it needs the
// browser. Brand auto-fill happens server-side on create.

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type Konva from 'konva'
import type { FlyerDocument, FlyerElement } from '@/lib/flyer/schema'
import { FLYER_FONTS } from '@/lib/flyer/schema'
import { FLYER_TEMPLATES } from '@/lib/flyer/templates'
import { FLYER_IMAGE_ACCEPT, validateFlyerImage } from '@/lib/flyer/upload'
import { customerQrs, flyerQrAction } from '@/lib/flyer/qr-presence'
import { pdfPageSpec } from '@/lib/flyer/pdf'

const FlyerCanvasEditor = dynamic(
  () => import('@/app/dashboard/flyer/_components/FlyerCanvasEditor'),
  { ssr: false },
)

type FlyerListItem = {
  id: string
  name: string
  template_id: string
  png_path: string | null
  pdf_path: string | null
  updated_at: string
}

type ExistingQr = { id: string; label: string; url: string }

function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function safeName(name: string): string {
  return (name || 'flyer').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'flyer'
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export default function FlyerDesignerTab({ accessToken }: { accessToken: string | null }) {
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [flyers, setFlyers] = useState<FlyerListItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Editor state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [doc, setDoc] = useState<FlyerDocument | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stage, setStage] = useState<Konva.Stage | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  // QR state
  const [qrAction, setQrAction] = useState<'generate' | 'insert'>('generate')
  const [existingQrs, setExistingQrs] = useState<ExistingQr[]>([])
  const [qrBusy, setQrBusy] = useState(false)

  const authHeaders = useCallback(
    (): Record<string, string> => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    [accessToken],
  )

  const loadFlyers = useCallback(async () => {
    // No synchronous setState here — the first state write lands after the
    // fetch await so this stays clean under react-hooks/set-state-in-effect
    // when called from the mount effect. loadingList starts true.
    try {
      const res = await fetch('/api/dashboard/flyer', { headers: authHeaders(), cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'load_failed')
      setFlyers(json.flyers ?? [])
      setError(null)
    } catch {
      setError('Could not load your flyers.')
    } finally {
      setLoadingList(false)
    }
  }, [authHeaders])

  const loadQrState = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/marketing/qr', { headers: authHeaders(), cache: 'no-store' })
      const json = await res.json()
      const qrs = (json.qrs ?? []) as { id: string; label: string; destination_type: string }[]
      setQrAction(flyerQrAction(qrs))
      setExistingQrs(
        customerQrs(qrs).map((q) => ({
          id: q.id,
          label: q.label,
          url: `/api/dashboard/marketing/qr/${q.id}/image?format=png`,
        })),
      )
    } catch {
      /* non-fatal — the editor stays usable without the QR helper */
    }
  }, [authHeaders])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await loadFlyers()
    })()
    return () => {
      cancelled = true
    }
  }, [loadFlyers])

  const selected = useMemo(
    () => doc?.elements.find((e) => e.id === selectedId) ?? null,
    [doc, selectedId],
  )

  function updateElements(elements: FlyerElement[]) {
    setDoc((d) => (d ? { ...d, elements } : d))
  }

  function patchSelected(patch: Partial<FlyerElement>) {
    if (!doc || !selectedId) return
    updateElements(
      doc.elements.map((e) => (e.id === selectedId ? ({ ...e, ...patch } as FlyerElement) : e)),
    )
  }

  function setQrSrc(url: string) {
    if (!doc) return
    const hasSlot = doc.elements.some((e) => e.kind === 'image' && e.role === 'qr')
    if (hasSlot) {
      updateElements(
        doc.elements.map((e) =>
          e.kind === 'image' && e.role === 'qr' ? ({ ...e, src: url } as FlyerElement) : e,
        ),
      )
    } else {
      updateElements([
        ...doc.elements,
        { id: newId('qr'), kind: 'image', role: 'qr', src: url, x: 48, y: 48, width: 160, height: 160 },
      ])
    }
  }

  async function createFromTemplate(templateId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/flyer', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'create_failed')
      await openFlyer(json.id)
    } catch {
      setError('Could not create the flyer.')
    } finally {
      setBusy(false)
    }
  }

  async function openFlyer(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/flyer/${id}`, { headers: authHeaders(), cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'open_failed')
      setEditingId(json.flyer.id)
      setName(json.flyer.name)
      setDoc(json.flyer.document as FlyerDocument)
      setSelectedId(null)
      setView('edit')
      void loadQrState()
    } catch {
      setError('Could not open that flyer.')
    } finally {
      setBusy(false)
    }
  }

  async function saveFlyer() {
    if (!editingId || !doc) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/flyer/${editingId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, document: doc }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'save_failed')
      }
      await loadFlyers()
    } catch {
      setError('Could not save — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteFlyer(id: string) {
    setBusy(true)
    try {
      await fetch(`/api/dashboard/flyer/${id}`, { method: 'DELETE', headers: authHeaders() })
      await loadFlyers()
    } finally {
      setBusy(false)
    }
  }

  async function uploadImage(file: File): Promise<string | null> {
    const pre = validateFlyerImage({ mime: file.type, size: file.size })
    if (!pre.ok) {
      setError(pre.message)
      return null
    }
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/dashboard/flyer/upload', { method: 'POST', headers: authHeaders(), body: fd })
    const json = await res.json()
    if (!res.ok) {
      setError(json.message ?? 'Upload failed.')
      return null
    }
    return json.url as string
  }

  async function addUploadedImage(file: File) {
    const url = await uploadImage(file)
    if (!url || !doc) return
    updateElements([
      ...doc.elements,
      { id: newId('img'), kind: 'image', role: 'upload', src: url, x: 80, y: 80, width: 240, height: 240 },
    ])
  }

  async function replaceSelectedImage(file: File) {
    const url = await uploadImage(file)
    if (url) patchSelected({ src: url } as Partial<FlyerElement>)
  }

  function addText() {
    if (!doc) return
    updateElements([
      ...doc.elements,
      {
        id: newId('text'),
        kind: 'text',
        text: 'New text',
        fontFamily: 'Inter',
        fontSize: 32,
        fill: '#FFFFFF',
        align: 'left',
        x: 80,
        y: 80,
        width: 360,
        height: 60,
      },
    ])
  }

  function deleteSelected() {
    if (!doc || !selectedId) return
    updateElements(doc.elements.filter((e) => e.id !== selectedId))
    setSelectedId(null)
  }

  async function generateQr() {
    setQrBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/marketing/qr', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Flyer QR', destination_type: 'landing' }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.message ?? json.error ?? 'Could not generate a QR code.')
        return
      }
      setQrSrc(`/api/dashboard/marketing/qr/${json.id}/image?format=png`)
      await loadQrState()
    } finally {
      setQrBusy(false)
    }
  }

  async function exportFlyer() {
    if (!stage || !doc || !editingId) return
    setExporting(true)
    setError(null)
    try {
      const pixelRatio = stage.width() > 0 ? doc.width / stage.width() : 1
      const png = stage.toDataURL({ pixelRatio, mimeType: 'image/png' })
      const { jsPDF } = await import('jspdf')
      const spec = pdfPageSpec(doc.width, doc.height)
      const pdf = new jsPDF({ orientation: spec.orientation, unit: spec.unit, format: spec.format })
      pdf.addImage(png, 'PNG', 0, 0, spec.format[0], spec.format[1])
      const pdfData = pdf.output('datauristring')

      triggerDownload(png, `${safeName(name)}.png`)
      triggerDownload(pdfData, `${safeName(name)}.pdf`)

      await fetch(`/api/dashboard/flyer/${editingId}/export`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ png, pdf: pdfData }),
      })
      await loadFlyers()
    } catch {
      setError('Export failed — an image on the flyer may be blocking cross-origin export.')
    } finally {
      setExporting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────
  const btn = 'border border-ink-line px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] transition-colors'
  const btnAccent = `${btn} border-accent/70 text-accent hover:bg-accent/10`
  const btnPlain = `${btn} text-text-sec hover:border-accent hover:text-text-pri`

  if (view === 'list') {
    return (
      <div className="space-y-8">
        {error && <p className="border border-warning-bright/50 bg-warning-bright/5 px-4 py-3 text-sm text-warning-bright">{error}</p>}

        <section>
          <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">Start a new flyer</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FLYER_TEMPLATES.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                onClick={() => createFromTemplate(t.id)}
                className="group flex flex-col items-start gap-3 border border-ink-line bg-ink-card p-5 text-left transition-colors hover:border-accent disabled:opacity-50"
              >
                <span className="font-extrabold uppercase tracking-[-0.01em] text-lg text-text-pri">{t.name}</span>
                <span className="text-sm leading-relaxed text-text-sec">{t.description}</span>
                <span className="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-accent group-hover:text-accent-press">
                  Use template &rarr;
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">My flyers</h3>
          {loadingList ? (
            <p className="mt-4 text-sm text-text-dim">Loading…</p>
          ) : flyers.length === 0 ? (
            <p className="mt-4 text-sm text-text-dim">No saved flyers yet — pick a template above to begin.</p>
          ) : (
            <ul className="mt-4 divide-y divide-ink-line border border-ink-line">
              {flyers.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 bg-ink-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text-pri">{f.name}</p>
                    <p className="font-mono text-xs text-text-dim">{f.template_id}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => openFlyer(f.id)} className={btnAccent}>Edit</button>
                    <button onClick={() => deleteFlyer(f.id)} className={btnPlain}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    )
  }

  // Edit view
  return (
    <div className="space-y-5">
      {error && <p className="border border-warning-bright/50 bg-warning-bright/5 px-4 py-3 text-sm text-warning-bright">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { setView('list'); setSelectedId(null) }} className={btnPlain}>&larr; Back</button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 border border-ink-line bg-ink-card px-3 py-2 text-text-pri"
          placeholder="Flyer name"
        />
        <button onClick={saveFlyer} disabled={saving} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={exportFlyer} disabled={exporting} className={btnAccent}>{exporting ? 'Exporting…' : 'Download PNG + PDF'}</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Canvas */}
        <div className="border border-ink-line bg-ink-card p-4">
          {doc && (
            <FlyerCanvasEditor
              document={doc}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={updateElements}
              onStageReady={setStage}
            />
          )}
        </div>

        {/* Properties + tools */}
        <div className="space-y-5">
          <div className="space-y-2 border border-ink-line bg-ink-card p-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">Add</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={addText} className={btnPlain}>+ Text</button>
              <label className={`${btnPlain} cursor-pointer`}>
                + Image
                <input
                  type="file"
                  accept={FLYER_IMAGE_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void addUploadedImage(f)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>

          {/* QR helper */}
          <div className="space-y-3 border border-ink-line bg-ink-card p-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">QR code</p>
            {qrAction === 'generate' ? (
              <>
                <p className="text-sm text-text-sec">You don’t have a customer QR code yet. Generate one and drop it on the flyer — it’s saved to your Marketing tab too.</p>
                <button onClick={generateQr} disabled={qrBusy} className={btnAccent}>
                  {qrBusy ? 'Generating…' : 'Generate QR code'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-text-sec">Insert one of your existing QR codes:</p>
                <div className="flex flex-wrap gap-2">
                  {existingQrs.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setQrSrc(q.url)}
                      className={btnPlain}
                      title={q.label}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Selected element properties */}
          <div className="space-y-3 border border-ink-line bg-ink-card p-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">Selected element</p>
            {!selected ? (
              <p className="text-sm text-text-dim">Click an element on the canvas to edit it.</p>
            ) : (
              <div className="space-y-3">
                {selected.kind === 'text' && (
                  <>
                    <label className="block text-xs text-text-dim">Text
                      <textarea
                        value={selected.text}
                        onChange={(e) => patchSelected({ text: e.target.value })}
                        className="mt-1 w-full border border-ink-line bg-ink-bg px-2 py-1 text-sm text-text-pri"
                        rows={2}
                      />
                    </label>
                    <label className="block text-xs text-text-dim">Font
                      <select
                        value={selected.fontFamily}
                        onChange={(e) => patchSelected({ fontFamily: e.target.value })}
                        className="mt-1 w-full border border-ink-line bg-ink-bg px-2 py-1 text-sm text-text-pri"
                      >
                        {FLYER_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                    <div className="flex gap-3">
                      <label className="block flex-1 text-xs text-text-dim">Size
                        <input
                          type="number"
                          min={8}
                          max={200}
                          value={selected.fontSize}
                          onChange={(e) => patchSelected({ fontSize: Number(e.target.value) || 12 })}
                          className="mt-1 w-full border border-ink-line bg-ink-bg px-2 py-1 text-sm text-text-pri"
                        />
                      </label>
                      <label className="block text-xs text-text-dim">Colour
                        <input
                          type="color"
                          value={selected.fill}
                          onChange={(e) => patchSelected({ fill: e.target.value })}
                          className="mt-1 block h-8 w-12 border border-ink-line bg-ink-bg"
                        />
                      </label>
                    </div>
                    <label className="block text-xs text-text-dim">Align
                      <select
                        value={selected.align ?? 'left'}
                        onChange={(e) => patchSelected({ align: e.target.value as 'left' | 'center' | 'right' })}
                        className="mt-1 w-full border border-ink-line bg-ink-bg px-2 py-1 text-sm text-text-pri"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  </>
                )}
                {selected.kind === 'rect' && (
                  <label className="block text-xs text-text-dim">Fill colour
                    <input
                      type="color"
                      value={selected.fill}
                      onChange={(e) => patchSelected({ fill: e.target.value })}
                      className="mt-1 block h-8 w-12 border border-ink-line bg-ink-bg"
                    />
                  </label>
                )}
                {selected.kind === 'image' && (
                  <label className={`${btnPlain} inline-block cursor-pointer`}>
                    Replace image
                    <input
                      type="file"
                      accept={FLYER_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void replaceSelectedImage(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
                <button onClick={deleteSelected} className={`${btnPlain} w-full`}>Delete element</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
