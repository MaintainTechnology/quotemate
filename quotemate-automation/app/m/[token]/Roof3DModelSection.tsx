'use client'

// /m/[token] — interactive 3D model of the property (Track B: VISUAL only).
//
// Optional, tradie-initiated. The button runs the whole pipeline:
//   1. CAPTURE  — CesiumJS renders the Google Photorealistic 3D tiles and
//                 orbits the camera through 4 stops (front/left/back/right),
//                 screenshotting the canvas at each stop.
//   2. GENERATE — POST /api/roofing/model3d/[token]; the server enhances the
//                 captures (Gemini nano-banana) and reconstructs a textured
//                 GLB via Tripo3D. We poll GET for progress (1–3 min).
//   3. VIEW     — three.js viewer: drag to rotate, scroll to zoom, plus
//                 live roof / wall recolouring (normal-based tint).
//
// The model never feeds measurements or pricing — ridge/hip/valley numbers
// stay on the measured-geometry path. This section is presentation only.
//
// ⚠ Licensing note: the captures are screenshots of Google's 3D tiles fed
// to a third-party reconstruction API. Confirm this use is within the
// Google Maps Platform terms before enabling in production.

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadCesium } from '@/app/dashboard/_components/loadCesium'
import { HouseViewer } from '@/app/q/_chrome/HouseViewer'

type Props = {
  measureToken: string
  /** Primary structure centroid — the Cesium capture target. Null hides the section. */
  center: { lat: number; lng: number } | null
  /** Camera orbit range in metres (derived from the footprint bbox server-side). */
  captureRangeM: number
  initialStatus: string | null
}

type Phase = 'idle' | 'capturing' | 'manual' | 'upload' | 'submitting' | 'generating' | 'ready' | 'failed'

const MAPS_3D_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_3D_KEY ?? ''

// Orbit stops, in Tripo's canonical view order. "front" is the first stop —
// for a house there is no semantic front; a consistent 90° orbit is what the
// reconstruction needs. ponytail: heading→view-label handedness unverified
// against Tripo's convention; a mirrored assumption only skews the prior,
// the overlap reconciles geometry either way.
const VIEWS = [
  { name: 'front', heading: 0 },
  { name: 'left', heading: 90 },
  { name: 'back', heading: 180 },
  { name: 'right', heading: 270 },
] as const

const POLL_MS = 5000
// Google 3D tiles keep refining detail after tilesLoaded fires — hold each
// camera stop this long before capturing so the screenshot is fully sharp.
const CAPTURE_SETTLE_MS = 5000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Centre-crop a wide canvas to 3:2 — the capture container is a letterbox
 *  strip, so an uncropped shot drags the neighbours in at the sides; the
 *  enhancement pass removes any remaining edge slivers. Auto captures only;
 *  manual keeps exactly what the tradie framed. */
function cropCenterDataUrl(source: HTMLCanvasElement, quality = 0.88): string {
  const h = source.height
  const w = Math.min(source.width, Math.round(h * 1.5))
  if (w >= source.width) return source.toDataURL('image/jpeg', quality)
  const x = Math.round((source.width - w) / 2)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(source, x, 0, w, h, 0, 0, w, h)
  return c.toDataURL('image/jpeg', quality)
}

/** Read a picked photo, downscale to maxDim, return a JPEG data URL —
 *  phone/drone photos are 10 MB+; the route caps captures at 8 MB. */
async function fileToDataUrl(file: File, maxDim = 1600): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.88)
}

// Anatomy legend — must match the colours ANATOMY_USER asks Gemini to draw.
const ANATOMY_LEGEND = [
  ['Ridge', '#3b82f6'],
  ['Hip', '#ef4444'],
  ['Valley', '#22c55e'],
  ['Eave', '#d946ef'],
  ['Gutter', '#f97316'],
] as const

// Manual capture slots — the tradie frames each one by hand. Tripo consumes
// front/left/right/back; 'top' is enhanced + cached only (no Tripo slot).
// Declared locally so the client bundle doesn't pull the server cache lib.
const MANUAL_VIEWS = ['front', 'left', 'right', 'back', 'top'] as const
type ManualView = (typeof MANUAL_VIEWS)[number]

/** Resolve when the tileset has loaded the current view (or timeout). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function waitForTiles(tileset: any, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      if (tileset.tilesLoaded || Date.now() - start > timeoutMs) {
        // Small settle so the last-loaded tiles actually rasterise.
        setTimeout(resolve, 600)
        return
      }
      setTimeout(tick, 300)
    }
    tick()
  })
}

/**
 * Cesium viewer over the Google Photorealistic 3D tiles, framed on the
 * property with the ground height sampled from the tileset itself. Shared by
 * the auto orbit capture and the manual capture mode.
 */
async function createCaptureViewer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Cesium: any,
  container: HTMLDivElement,
  center: { lat: number; lng: number },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ viewer: any; tileset: any; target: any; groundH: number }> {
  Cesium.GoogleMaps.defaultApiKey = MAPS_3D_KEY
  const viewer = new Cesium.Viewer(container, {
    globe: false,
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    // Required so canvas.toDataURL sees the rendered frame.
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
  })
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2)

  const tileset = await Cesium.createGooglePhotorealistic3DTileset(
    { key: MAPS_3D_KEY },
    { showCreditsOnScreen: true },
  )
  viewer.scene.primitives.add(tileset)
  tileset.maximumScreenSpaceError = 4 // sharper tiles than the fly-around; captures deserve it

  // Ground height from the tileset itself (no extra API call). The sample
  // promise only resolves during render frames — in a throttled/background
  // tab that can be never, so it races a hard timeout to the 25 m fallback.
  let groundH = 25
  try {
    const carto = Cesium.Cartographic.fromDegrees(center.lng, center.lat)
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, 400) })
    await waitForTiles(tileset)
    const sampled = await Promise.race([
      viewer.scene.sampleHeightMostDetailed([carto]).then((r: { height?: number }[]) => r[0]),
      sleep(15_000).then(() => null),
    ])
    if (sampled && Number.isFinite(sampled.height)) groundH = sampled.height
  } catch {
    /* fall back to 25 m */
  }
  // Aim just above ground level — aiming at roof height pushed the house to
  // the bottom of the frame on downhill sides (terrain slope moves the roof
  // relative to the sampled centroid height).
  const target = Cesium.Cartesian3.fromDegrees(center.lng, center.lat, groundH + 2)
  return { viewer, tileset, target, groundH }
}

export function Roof3DModelSection({ measureToken, center, captureRangeM, initialStatus }: Props) {
  const captureRef = useRef<HTMLDivElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [phase, setPhase] = useState<Phase>(
    initialStatus === 'generating' ? 'generating' : initialStatus === 'ready' ? 'ready' : 'idle',
  )
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Signed GLB URL from the state endpoint — handed to the shared viewer. */
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  // Manual capture mode — the tradie frames each view by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manualViewerRef = useRef<any>(null)
  const [manualShots, setManualShots] = useState<Partial<Record<ManualView, string>>>({})
  // Upload-your-own-photos source (drone shots, saved screenshots).
  const [uploadShots, setUploadShots] = useState<Partial<Record<ManualView, string>>>({})
  // Roof-anatomy overlays (all sources) — view → signed image URL.
  const [anatomy, setAnatomy] = useState<Record<string, string> | null>(null)
  // Gemini-polished captures for this property — view → signed image URL.
  const [polished, setPolished] = useState<Record<string, string> | null>(null)
  // The two synthesised studio renders the model was reconstructed from.
  const [synth, setSynth] = useState<Record<string, string> | null>(null)
  const [roofColor, setRoofColor] = useState('#8a4b32')
  const [wallColor, setWallColor] = useState('#d8d2c4')
  const [tinting, setTinting] = useState({ roof: false, walls: false })

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // The three.js viewer itself lives in app/q/_chrome/HouseViewer.tsx — the
  // customer thank-you page renders the same component, so the GLB load, the
  // orbit controls and the roof/wall tint shader cannot drift between the two
  // surfaces. Only the colour pickers below stay tradie-side.

  // ── polling ───────────────────────────────────────────────────────
  const fetchStateOnce = useCallback(async (opts: { metaOnly?: boolean } = {}): Promise<void> => {
    const res = await fetch(`/api/roofing/model3d/${encodeURIComponent(measureToken)}`)
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; status?: string; progress?: number | null; modelUrl?: string | null; error?: string | null; anatomy?: Record<string, string> | null; polished?: Record<string, string> | null; synth?: Record<string, string> | null }
      | null
    if (!json?.ok) return
    // Mirror the server, including null — keeping stale panels (e.g. anatomy
    // drawn over a previous generation's captures) is worse than a gap.
    setAnatomy(json.anatomy ?? null)
    setPolished(json.polished ?? null)
    setSynth(json.synth ?? null)
    // The signed GLB URL rides on every response, including the mount fetch —
    // keeping it means an already-ready model is viewable without a second
    // round trip. Nothing downloads until the viewer's own button is tapped.
    setModelUrl(json.modelUrl ?? null)
    // Metadata-only (page mount): populate the image panels but never touch
    // the phase — an async response must not undo a click (e.g. Regenerate).
    if (opts.metaOnly) return
    if (json.status === 'ready') {
      stopPolling()
      setPhase('ready')
    } else if (json.status === 'failed') {
      stopPolling()
      setPhase('failed')
      setError(json.error ?? 'Model generation failed.')
    } else if (json.status === 'generating') {
      setProgress(json.progress ?? null)
    }
  }, [measureToken, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(() => void fetchStateOnce(), POLL_MS)
  }, [fetchStateOnce, stopPolling])

  // Resume an in-flight generation after a page reload, and populate the
  // polished/anatomy panels on load (without downloading the heavy model).
  useEffect(() => {
    if (phase === 'generating' && !pollRef.current) startPolling()
    void fetchStateOnce({ metaOnly: true })
    return () => {
      stopPolling()
      try {
        manualViewerRef.current?.destroy()
      } catch {
        /* already gone */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── submit (shared by auto orbit + manual mode) ───────────────────
  const submitCaptures = useCallback(
    async (captures: { view: string; image: string }[], mode: 'auto' | 'manual') => {
      setPhase('submitting')
      setStage('Enhancing captures and starting the 3D build…')
      const res = await fetch(`/api/roofing/model3d/${encodeURIComponent(measureToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captures, mode }),
      })
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null
      if (!json?.ok) throw new Error(json?.error ?? `Generation failed (HTTP ${res.status})`)
      setPhase('generating')
      setProgress(0)
      setStage('')
      startPolling()
    },
    [measureToken, startPolling],
  )

  // ── manual capture mode ───────────────────────────────────────────
  const destroyManualViewer = useCallback(() => {
    try {
      manualViewerRef.current?.destroy()
    } catch {
      /* already gone */
    }
    manualViewerRef.current = null
  }, [])

  const openManual = useCallback(async () => {
    if (!center) return
    setError(null)
    setManualShots({})
    setPhase('manual')
    setStage('Loading the 3D view…')
    try {
      const Cesium = await loadCesium()
      if (!captureRef.current) throw new Error('capture container missing')
      const { viewer, tileset, target } = await createCaptureViewer(
        Cesium,
        captureRef.current,
        center,
      )
      manualViewerRef.current = viewer
      viewer.camera.lookAt(
        target,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(15),
          Cesium.Math.toRadians(-32),
          captureRangeM,
        ),
      )
      // Release the camera lock — the tradie orbits/zooms/tilts freely.
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
      await waitForTiles(tileset)
      setStage('')
    } catch (e) {
      destroyManualViewer()
      setPhase('failed')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [center, captureRangeM, destroyManualViewer])

  /** Snapshot the current manual view into its slot (click again = retake). */
  const captureManualShot = useCallback((view: ManualView) => {
    const viewer = manualViewerRef.current
    if (!viewer) return
    viewer.scene.render()
    const image = viewer.canvas.toDataURL('image/jpeg', 0.88)
    setManualShots((s) => ({ ...s, [view]: image }))
  }, [])

  const cancelManual = useCallback(() => {
    destroyManualViewer()
    setManualShots({})
    setStage('')
    setPhase('idle')
  }, [destroyManualViewer])

  const buildFromManual = useCallback(async () => {
    const captures = MANUAL_VIEWS.filter((v) => manualShots[v]).map((v) => ({
      view: v as string,
      image: manualShots[v]!,
    }))
    destroyManualViewer()
    try {
      await submitCaptures(captures, 'manual')
    } catch (e) {
      setPhase('failed')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [manualShots, destroyManualViewer, submitCaptures])

  // ── upload-your-own-photos source ─────────────────────────────────
  const pickUploadFile = useCallback(async (view: ManualView, file: File | null) => {
    if (!file) return
    try {
      const image = await fileToDataUrl(file)
      setUploadShots((s) => ({ ...s, [view]: image }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const buildFromUpload = useCallback(async () => {
    const captures = MANUAL_VIEWS.filter((v) => uploadShots[v]).map((v) => ({
      view: v as string,
      image: uploadShots[v]!,
    }))
    try {
      // Tradie-supplied images: same server path as manual capture — Gemini
      // enhancement, cache write, Tripo build; no cache read, no anatomy pass.
      await submitCaptures(captures, 'manual')
    } catch (e) {
      setPhase('failed')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [uploadShots, submitCaptures])

  // ── capture + submit ──────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!center) return
    setError(null)
    setPhase('capturing')
    setStage('Loading the 3D view…')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null
    try {
      const Cesium = await loadCesium()
      if (!captureRef.current) throw new Error('capture container missing')
      setStage('Loading Google 3D tiles…')
      const created = await createCaptureViewer(Cesium, captureRef.current, center)
      viewer = created.viewer
      const { tileset, groundH } = created
      // Steep oblique (drone-style): mostly roof, no horizon — the capture
      // should be the house, not the neighbourhood. −50° also foreshortens
      // the near-far extent so the whole roof fits the tight orbit range.
      const pitch = Cesium.Math.toRadians(-50)
      // At an oblique pitch the roof sprawls toward the camera and clips the
      // bottom of the frame. Pulling the aim point TOWARD each view's camera
      // (by a fraction of the range) recentres the house from every heading.
      const latRad = (center.lat * Math.PI) / 180
      // ponytail: constant fraction tuned on real captures (0.12 clipped the
      // near eave, 0.22 clipped the far ridge on offset-centroid lots); a
      // bbox-projection solve is the upgrade path if more properties misframe.
      const aimFor = (headingRad: number) => {
        const pullM = captureRangeM * 0.16
        return Cesium.Cartesian3.fromDegrees(
          center.lng - (Math.sin(headingRad) * pullM) / (111_320 * Math.cos(latRad)),
          center.lat - (Math.cos(headingRad) * pullM) / 110_540,
          groundH + 2,
        )
      }
      const captures: { view: string; image: string }[] = []
      const total = VIEWS.length + 1 // + the nadir top capture below
      for (let i = 0; i < VIEWS.length; i++) {
        const v = VIEWS[i]
        setStage(`View ${i + 1}/${total} (${v.name}) — loading tiles…`)
        const headingRad = Cesium.Math.toRadians(v.heading)
        viewer.camera.lookAt(
          aimFor(headingRad),
          new Cesium.HeadingPitchRange(headingRad, pitch, captureRangeM),
        )
        await waitForTiles(tileset)
        // Hold the view — tiles keep sharpening after they report loaded.
        setStage(`View ${i + 1}/${total} (${v.name}) — letting detail sharpen…`)
        await sleep(CAPTURE_SETTLE_MS)
        setStage(`View ${i + 1}/${total} (${v.name}) — capturing…`)
        viewer.scene.render()
        captures.push({ view: v.name, image: cropCenterDataUrl(viewer.canvas) })
      }

      // Nadir shot — the roof plan the synthesis pass needs to get the plane
      // layout right. Straight down, aimed at the true centroid (no aim-point
      // pull: there is no oblique foreshortening to correct). −89.9° rather
      // than −90° keeps Cesium's up-vector well defined.
      setStage(`View ${total}/${total} (top) — loading tiles…`)
      viewer.camera.lookAt(
        Cesium.Cartesian3.fromDegrees(center.lng, center.lat, groundH + 2),
        new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-89.9), captureRangeM),
      )
      await waitForTiles(tileset)
      setStage(`View ${total}/${total} (top) — letting detail sharpen…`)
      await sleep(CAPTURE_SETTLE_MS)
      setStage(`View ${total}/${total} (top) — capturing…`)
      viewer.scene.render()
      captures.push({ view: 'top', image: cropCenterDataUrl(viewer.canvas) })

      await submitCaptures(captures, 'auto')
    } catch (e) {
      setPhase('failed')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      try {
        viewer?.destroy()
      } catch {
        /* already gone */
      }
    }
  }, [center, captureRangeM, submitCaptures])

  // No geometry to aim the capture at, or no browser Maps key → hide (same
  // rule as the layout section: the feature is optional).
  if (!center || !MAPS_3D_KEY) return null

  const busy = phase === 'capturing' || phase === 'submitting'

  return (
    <section className="mt-8">
      <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
        3D model
      </div>

      <div className="mt-3 border border-ink-line bg-ink-card">
        {phase !== 'ready' && (
          <div className="p-6">
            <p className="max-w-2xl text-sm leading-relaxed text-text-sec">
              Build an interactive 3D model of this property — choose your source: automated
              flyover captures (with AI roof-anatomy markup), your own framed shots in the 3D
              view, or uploaded photos. Every image is AI-polished, then reconstructed into a
              model you can rotate, zoom and recolour. Visual aid only — measurements and
              pricing always come from the measured geometry.
            </p>

            {(phase === 'idle' || phase === 'failed') && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={busy}
                  aria-busy={busy}
                  className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-60"
                >
                  {phase === 'failed' ? 'Retry 3D model' : 'Generate 3D model'}
                </button>
                <button
                  type="button"
                  onClick={() => void openManual()}
                  disabled={busy}
                  aria-busy={busy}
                  className="inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-pri hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  Manual capture
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setUploadShots({})
                    setPhase('upload')
                  }}
                  disabled={busy}
                  aria-busy={busy}
                  className="inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-pri hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  Upload photos
                </button>
              </div>
            )}

            {phase === 'upload' && (
              <div className="mt-4">
                <p className="max-w-2xl text-sm leading-relaxed text-text-sec">
                  Use your own images — drone shots, saved screenshots, or site photos. Add the
                  front plus at least one other side; all five give the best model. Each image is
                  polished by AI before the build.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {MANUAL_VIEWS.map((v) => (
                    <label
                      key={v}
                      className={`flex cursor-pointer flex-col items-stretch border transition-colors ${
                        uploadShots[v]
                          ? 'border-accent bg-accent/10'
                          : 'border-ink-line hover:border-accent'
                      }`}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void pickUploadFile(v, e.target.files?.[0] ?? null)}
                      />
                      {uploadShots[v] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={uploadShots[v]}
                          alt={`${v} view`}
                          className="h-20 w-full border-b border-ink-line object-cover"
                        />
                      ) : (
                        <span className="flex h-20 items-center justify-center border-b border-ink-line text-2xl text-text-dim">
                          +
                        </span>
                      )}
                      <span
                        className={`px-2 py-1.5 text-center font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] ${
                          uploadShots[v] ? 'text-accent' : 'text-text-sec'
                        }`}
                      >
                        {uploadShots[v] ? '✓ ' : ''}
                        {v}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void buildFromUpload()}
                    disabled={
                      !uploadShots.front ||
                      !(uploadShots.left || uploadShots.right || uploadShots.back)
                    }
                    className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-50"
                  >
                    Build 3D model ({Object.keys(uploadShots).length}/5 views)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadShots({})
                      setPhase('idle')
                    }}
                    className="inline-flex items-center gap-2 border border-ink-line px-3 py-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim hover:border-accent hover:text-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {phase === 'manual' && (
              <div className="mt-4">
                <p className="max-w-2xl text-sm leading-relaxed text-text-sec">
                  Frame each side yourself: drag to orbit, scroll to zoom, Ctrl+drag to tilt
                  (tilt down for the top view). Line up a side, then tap its button below to
                  capture — tap again to retake. Front plus one other side is the minimum;
                  all five give the best model.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {MANUAL_VIEWS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => captureManualShot(v)}
                      className={`inline-flex items-center gap-2 border px-3 py-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-colors ${
                        manualShots[v]
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-ink-line text-text-sec hover:border-accent hover:text-accent'
                      }`}
                    >
                      {manualShots[v] ? '✓ ' : ''}
                      {v}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void buildFromManual()}
                    disabled={
                      !manualShots.front ||
                      !(manualShots.left || manualShots.right || manualShots.back)
                    }
                    className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-50"
                  >
                    Build 3D model ({Object.keys(manualShots).length}/5 views)
                  </button>
                  <button
                    type="button"
                    onClick={cancelManual}
                    className="inline-flex items-center gap-2 border border-ink-line px-3 py-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim hover:border-accent hover:text-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(busy || (phase === 'manual' && stage)) && (
              <p className="mt-4 inline-flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-sec">
                <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/40 border-t-accent" aria-hidden="true" />
                {stage}
              </p>
            )}

            {phase === 'generating' && (
              <div className="mt-4">
                <p className="inline-flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-sec">
                  <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/40 border-t-accent" aria-hidden="true" />
                  Building the 3D model{typeof progress === 'number' ? ` — ${progress}%` : '…'}
                </p>
                <p className="mt-2 text-xs text-text-dim">
                  Reconstruction takes a minute or three. You can leave this page — it keeps
                  building and will be here when you come back.
                </p>
              </div>
            )}

            {error && <p className="mt-3 font-mono text-xs text-warning-bright">{error}</p>}

            {/* Cesium capture stage — visible during the auto orbit AND in
                manual mode (where the tradie drives it). Collapsed otherwise. */}
            <div
              ref={captureRef}
              className={`mt-4 w-full overflow-hidden border border-ink-line bg-ink-deep ${
                phase === 'capturing' || phase === 'manual' ? 'h-96' : 'h-0 border-0'
              }`}
            />
          </div>
        )}

        {phase === 'ready' && (
          <div>
            <div className="relative h-[28rem] w-full bg-ink-deep">
              {modelUrl ? (
                <HouseViewer
                  modelUrl={modelUrl}
                  // Empty hex = leave that surface alone, so "Reset colours"
                  // and the untouched initial state stay untinted as before.
                  roofHex={tinting.roof ? roofColor : ''}
                  wallHex={tinting.walls ? wallColor : ''}
                  posterUrl={synth?.front ?? null}
                  label="Interactive 3D model of the property"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => void fetchStateOnce()}
                    className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-accent-ink hover:bg-accent-press"
                  >
                    View 3D model
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-5 border-t border-ink-line px-5 py-4">
              <label className="inline-flex items-center gap-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-sec">
                Roof colour
                <input
                  type="color"
                  value={roofColor}
                  onChange={(e) => {
                    setRoofColor(e.target.value)
                    setTinting((t) => ({ ...t, roof: true }))
                  }}
                  className="h-7 w-10 cursor-pointer border border-ink-line bg-transparent"
                />
              </label>
              <label className="inline-flex items-center gap-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-sec">
                Walls / trim
                <input
                  type="color"
                  value={wallColor}
                  onChange={(e) => {
                    setWallColor(e.target.value)
                    setTinting((t) => ({ ...t, walls: true }))
                  }}
                  className="h-7 w-10 cursor-pointer border border-ink-line bg-transparent"
                />
              </label>
              <button
                type="button"
                onClick={() => setTinting({ roof: false, walls: false })}
                className="inline-flex items-center gap-2 border border-ink-line px-3 py-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-pri hover:border-accent hover:text-accent"
              >
                Reset colours
              </button>
              <button
                type="button"
                onClick={() => setPhase('idle')}
                className="ml-auto inline-flex items-center gap-2 border border-ink-line px-3 py-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim hover:border-accent hover:text-accent"
              >
                Regenerate
              </button>
            </div>
            {error && (
              <p className="border-t border-ink-line px-5 py-3 font-mono text-xs text-warning-bright">{error}</p>
            )}
            <p className="border-t border-ink-line px-5 py-3 text-xs text-text-dim">
              AI-reconstructed visual — drag to rotate, scroll to zoom. Colours are a preview
              aid; measurements and pricing come from the measured geometry, never this model.
            </p>
          </div>
        )}

        {/* Polished captures — the Gemini-enhanced views this property's
            model is built from (address cache, so they show on repeats too). */}
        {polished && Object.keys(polished).length > 0 && (
          <div className="border-t border-ink-line px-5 py-4">
            <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              Polished captures (AI-enhanced)
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {MANUAL_VIEWS.filter((v) => polished[v]).map((v) => (
                <figure key={v}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={polished[v]}
                    alt={`Polished ${v} view of the property`}
                    className="w-full border border-ink-line object-cover"
                  />
                  <figcaption className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                    {v}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-dim">
              The AI-polished aerial views the 3D model is built from.
            </p>
          </div>
        )}

        {/* Roof anatomy — Gemini-annotated overlays from the automated
            captures (ridge/hip/valley/eave lines). Identification aid only:
            the counts the quote uses come from the measured geometry. */}
        {anatomy && Object.keys(anatomy).length > 0 && (
          <div className="border-t border-ink-line px-5 py-4">
            <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              Roof anatomy (AI-annotated)
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {MANUAL_VIEWS.filter((v) => anatomy[v]).map((v) => (
                <figure key={v}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={anatomy[v]}
                    alt={`Roof anatomy — ${v} view with ridge, hip, valley and eave lines`}
                    className="w-full border border-ink-line object-cover"
                  />
                  <figcaption className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                    {v}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
              {ANATOMY_LEGEND.map(([label, colour]) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-4"
                    style={{ background: colour }}
                  />
                  {label}
                </span>
              ))}
            </p>
            <p className="mt-2 text-xs text-text-dim">
              Visual identification aid drawn by AI over the aerial captures. The hip and valley
              counts used for pricing come from the measured geometry, not these drawings.
            </p>
          </div>
        )}

        {/* Synthesised renders — the two studio images actually fed to the
            reconstruction. Last in the strip: the captures above are the
            inputs, these are what they became, and a wrong 3D model is
            diagnosed here before anywhere else. */}
        {synth && (synth.front || synth.back) && (
          <div className="border-t border-ink-line px-5 py-4">
            <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              3D renders (AI-generated)
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(['front', 'back'] as const)
                .filter((v) => synth[v])
                .map((v) => (
                  <figure key={v}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={synth[v]}
                      alt={`AI-generated 3D ${v} view of the house`}
                      className="w-full border border-ink-line object-cover"
                    />
                    <figcaption className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                      {v}
                    </figcaption>
                  </figure>
                ))}
            </div>
            <p className="mt-2 text-xs text-text-dim">
              Built from the five polished captures above, then reconstructed into the 3D model.
              These two images are what the model was made from.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
