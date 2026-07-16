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

type Props = {
  measureToken: string
  /** Primary structure centroid — the Cesium capture target. Null hides the section. */
  center: { lat: number; lng: number } | null
  /** Camera orbit range in metres (derived from the footprint bbox server-side). */
  captureRangeM: number
  initialStatus: string | null
}

type Phase = 'idle' | 'capturing' | 'submitting' | 'generating' | 'ready' | 'failed'

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

export function Roof3DModelSection({ measureToken, center, captureRangeM, initialStatus }: Props) {
  const captureRef = useRef<HTMLDivElement | null>(null)
  const viewerBoxRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const materialsRef = useRef<any[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [phase, setPhase] = useState<Phase>(
    initialStatus === 'generating' ? 'generating' : initialStatus === 'ready' ? 'ready' : 'idle',
  )
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelLoaded, setModelLoaded] = useState(false)
  const [viewerLoading, setViewerLoading] = useState(false)
  const [roofColor, setRoofColor] = useState('#8a4b32')
  const [wallColor, setWallColor] = useState('#d8d2c4')
  const [tinting, setTinting] = useState({ roof: false, walls: false })

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // ── viewer (three.js) ─────────────────────────────────────────────
  const loadModel = useCallback(async (url: string) => {
    const box = viewerBoxRef.current
    if (!box) return
    setViewerLoading(true)
    const THREE = await import('three')
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(box.clientWidth, box.clientHeight)
    // The host div is a React-empty node — appendChild only, NEVER
    // replaceChildren (mutating React-managed children crashes reconciliation
    // with "removeChild … not a child of this node").
    cleanupRef.current?.()
    box.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#14100d')
    const camera = new THREE.PerspectiveCamera(45, box.clientWidth / box.clientHeight, 0.1, 1000)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444433, 2.4))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(1, 2, 1.2)
    scene.add(sun)

    const gltf = await new GLTFLoader().loadAsync(url)
    const model = gltf.scene

    // Frame the model: centre at origin, camera pulled back by its size.
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const centre = bounds.getCenter(new THREE.Vector3())
    model.position.sub(centre)
    scene.add(model)
    const dim = Math.max(size.x, size.y, size.z) || 1
    camera.position.set(dim * 1.2, dim * 0.8, dim * 1.2)

    // Recolour hook: tint fragments by WORLD normal — sloped-up normals are
    // roof, near-horizontal are walls. Injected into every material so the
    // pickers work on Tripo's single baked-texture output.
    // ponytail: normal-heuristic zones; true per-surface repaint would need
    // Tripo's /models/texture re-texture task (paid, slow) or segmentation.
    const uniforms = {
      uRoofColor: { value: new THREE.Color(roofColor) },
      uRoofMix: { value: 0 },
      uWallColor: { value: new THREE.Color(wallColor) },
      uWallMix: { value: 0 },
    }
    materialsRef.current = []
    model.traverse((obj) => {
      const mesh = obj as InstanceType<typeof THREE.Mesh>
      if (!mesh.isMesh || !mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms)
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
               uniform vec3 uRoofColor; uniform float uRoofMix;
               uniform vec3 uWallColor; uniform float uWallMix;`,
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
               {
                 vec3 worldN = inverseTransformDirection(normalize(vNormal), viewMatrix);
                 float up = worldN.y;
                 float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                 // Sloped upward faces = roof (excludes flat ground at up≈1).
                 float roofMask = step(0.35, up) * (1.0 - step(0.985, up));
                 float wallMask = 1.0 - step(0.35, abs(up));
                 vec3 roofTint = uRoofColor * (0.25 + lum * 1.5);
                 vec3 wallTint = uWallColor * (0.25 + lum * 1.5);
                 diffuseColor.rgb = mix(diffuseColor.rgb, roofTint, roofMask * uRoofMix);
                 diffuseColor.rgb = mix(diffuseColor.rgb, wallTint, wallMask * uWallMix);
               }`,
            )
        }
        mat.needsUpdate = true
      }
    })
    materialsRef.current = [uniforms]

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)

    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      if (!viewerBoxRef.current) return
      const w = viewerBoxRef.current.clientWidth
      const h = viewerBoxRef.current.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    cleanupRef.current = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      cleanupRef.current = null
    }
    setModelLoaded(true)
    setViewerLoading(false)
    // roofColor/wallColor deliberately not deps — uniforms update via the picker effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push picker changes into the shader uniforms.
  useEffect(() => {
    void (async () => {
      const u = materialsRef.current[0]
      if (!u) return
      const THREE = await import('three')
      u.uRoofColor.value = new THREE.Color(roofColor)
      u.uWallColor.value = new THREE.Color(wallColor)
      u.uRoofMix.value = tinting.roof ? 0.85 : 0
      u.uWallMix.value = tinting.walls ? 0.85 : 0
    })()
  }, [roofColor, wallColor, tinting])

  // ── polling ───────────────────────────────────────────────────────
  const fetchStateOnce = useCallback(async (): Promise<void> => {
    const res = await fetch(`/api/roofing/model3d/${encodeURIComponent(measureToken)}`)
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; status?: string; progress?: number | null; modelUrl?: string | null; error?: string | null }
      | null
    if (!json?.ok) return
    if (json.status === 'ready') {
      stopPolling()
      setPhase('ready')
      if (json.modelUrl) {
        try {
          await loadModel(json.modelUrl)
        } catch (e) {
          setViewerLoading(false)
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    } else if (json.status === 'failed') {
      stopPolling()
      setPhase('failed')
      setError(json.error ?? 'Model generation failed.')
    } else if (json.status === 'generating') {
      setProgress(json.progress ?? null)
    }
  }, [measureToken, loadModel, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(() => void fetchStateOnce(), POLL_MS)
  }, [fetchStateOnce, stopPolling])

  // Resume an in-flight generation after a page reload.
  useEffect(() => {
    if (phase === 'generating' && !pollRef.current) startPolling()
    return () => {
      stopPolling()
      cleanupRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      Cesium.GoogleMaps.defaultApiKey = MAPS_3D_KEY

      viewer = new Cesium.Viewer(captureRef.current, {
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

      setStage('Loading Google 3D tiles…')
      const tileset = await Cesium.createGooglePhotorealistic3DTileset(
        { key: MAPS_3D_KEY },
        { showCreditsOnScreen: true },
      )
      viewer.scene.primitives.add(tileset)
      tileset.maximumScreenSpaceError = 4 // sharper tiles than the fly-around; captures deserve it

      // Ground height from the tileset itself (no extra API call).
      let groundH = 25
      try {
        const carto = Cesium.Cartographic.fromDegrees(center.lng, center.lat)
        const first = Cesium.Cartesian3.fromDegrees(center.lng, center.lat, 400)
        viewer.camera.setView({ destination: first })
        await waitForTiles(tileset)
        const [sampled] = await viewer.scene.sampleHeightMostDetailed([carto])
        if (sampled && Number.isFinite(sampled.height)) groundH = sampled.height
      } catch {
        /* fall back to 25 m */
      }

      const target = Cesium.Cartesian3.fromDegrees(center.lng, center.lat, groundH + 4)
      const pitch = Cesium.Math.toRadians(-32)
      const captures: { view: string; image: string }[] = []
      for (let i = 0; i < VIEWS.length; i++) {
        const v = VIEWS[i]
        setStage(`View ${i + 1}/4 (${v.name}) — loading tiles…`)
        viewer.camera.lookAt(
          target,
          new Cesium.HeadingPitchRange(Cesium.Math.toRadians(v.heading), pitch, captureRangeM),
        )
        await waitForTiles(tileset)
        // Hold the view — tiles keep sharpening after they report loaded.
        setStage(`View ${i + 1}/4 (${v.name}) — letting detail sharpen…`)
        await sleep(CAPTURE_SETTLE_MS)
        setStage(`View ${i + 1}/4 (${v.name}) — capturing…`)
        viewer.scene.render()
        captures.push({ view: v.name, image: viewer.canvas.toDataURL('image/jpeg', 0.88) })
      }

      setPhase('submitting')
      setStage('Enhancing captures and starting the 3D build…')
      const res = await fetch(`/api/roofing/model3d/${encodeURIComponent(measureToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captures, mode: 'auto' }),
      })
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null
      if (!json?.ok) throw new Error(json?.error ?? `Generation failed (HTTP ${res.status})`)

      setPhase('generating')
      setProgress(0)
      setStage('')
      startPolling()
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
  }, [center, captureRangeM, measureToken, startPolling])

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
              Build an interactive 3D model of this property: four aerial views are captured
              from the photorealistic 3D map, enhanced, and reconstructed into a model you can
              rotate, zoom and recolour. Visual aid only — measurements and pricing always come
              from the measured geometry.
            </p>

            {(phase === 'idle' || phase === 'failed') && (
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy}
                className="mt-4 inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-60"
              >
                {phase === 'failed' ? 'Retry 3D model' : 'Generate 3D model'}
              </button>
            )}

            {busy && (
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

            {/* Cesium capture stage — visible while orbiting so the tradie sees
                the views being taken. Collapsed otherwise. */}
            <div
              ref={captureRef}
              className={`mt-4 w-full overflow-hidden border border-ink-line bg-ink-deep ${phase === 'capturing' ? 'h-80' : 'h-0 border-0'}`}
            />
          </div>
        )}

        {phase === 'ready' && (
          <div>
            <div className="relative h-[28rem] w-full bg-ink-deep">
              {/* Canvas host — React renders NOTHING inside; three.js appends
                  its canvas imperatively. Keeping it childless in JSX is what
                  makes the imperative appendChild safe. */}
              <div ref={viewerBoxRef} className="absolute inset-0" />
              {!modelLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => void fetchStateOnce()}
                    disabled={viewerLoading}
                    className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-60"
                  >
                    {viewerLoading ? (
                      <>
                        <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" />
                        Loading model…
                      </>
                    ) : (
                      'View 3D model'
                    )}
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
                onClick={() => {
                  cleanupRef.current?.()
                  setModelLoaded(false)
                  setPhase('idle')
                }}
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
      </div>
    </section>
  )
}
