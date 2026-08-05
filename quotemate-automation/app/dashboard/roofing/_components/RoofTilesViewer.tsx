'use client'

// Roofing — interactive 3D fly-around of the property (the AU-working
// "aerial / immersive" view; Google's Aerial View API is US-only).
//
// Renders Google Photorealistic 3D Tiles in CesiumJS so the tradie can
// orbit the roof + surroundings for access, complexity, tree overhang and
// neighbour context. No recolour (roof stays as-is); adds an optional
// cinematic AUTO-ORBIT. Cesium is heavy + WebGL, so it loads lazily only
// when the tradie clicks "Fly around in 3D". Mirrors the painting viewer's
// proven setup (official Google-tiles helper + baseLayer:false).

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'
import { loadCesium } from '../../_components/loadCesium'

type Props = {
  token: string | null
  address: string
  postcode: string
  state: string
}

type Loc = { lat: number; lng: number; boundingBox: { south: number; west: number; north: number; east: number } | null; groundHeight?: number | null }

const MAPS_3D_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_3D_KEY ?? ''
const ION_TOKEN = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? ''

export function RoofTilesViewer({ token, address, postcode, state }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cesiumRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orbitTargetRef = useRef<any>(null)
  const orbitRef = useRef({ on: false, heading: 0, pitch: -0.45, range: 90 })

  const [active, setActive] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading')
  const [stage, setStage] = useState('Starting…')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [orbiting, setOrbiting] = useState(false)

  useEffect(() => {
    if (!active) return
    if (!MAPS_3D_KEY) {
      setStatus('unsupported')
      setErrMsg('Set NEXT_PUBLIC_GOOGLE_MAPS_3D_KEY (a browser Maps key with the Map Tiles API enabled) to use the 3D view.')
      return
    }
    if (!token || address.trim().length < 3) return

    let cancelled = false
    setStatus('loading')
    setStage('Locating property…')
    setErrMsg(null)
    const watchdog = setTimeout(() => {
      if (cancelled) return
      setStatus((s) => (s === 'loading' ? 'error' : s))
      setErrMsg((m) => m ?? 'Still loading after 3 min. In dev the first open compiles the CesiumJS engine (1–2 min) — try once more; it caches after. If it persists, open DevTools → Console for errors.')
    }, 180_000)

    void (async () => {
      try {
        const authToken = (await getAuthToken()) ?? token
        const locRes = await fetch('/api/painting/3d-location', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, postcode, state }),
        })
        const loc = (await locRes.json()) as ({ ok: true } & Loc) | { ok: false; code?: string; detail?: string }
        if (!loc.ok) throw new Error(loc.detail ?? loc.code ?? 'Could not locate the property.')
        if (cancelled) return

        setStage('Loading 3D engine…')
        console.log('[roof-3d] loading CesiumJS from CDN…')
        const Cesium = await loadCesium()
        if (cancelled || !containerRef.current) return
        cesiumRef.current = Cesium
        if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN
        Cesium.GoogleMaps.defaultApiKey = MAPS_3D_KEY

        const viewer = new Cesium.Viewer(containerRef.current, {
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
        })
        viewerRef.current = viewer
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
        try {
          viewer.scene.msaaSamples = 4
          if (viewer.scene.postProcessStages?.fxaa) viewer.scene.postProcessStages.fxaa.enabled = true
          viewer.resolutionScale = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2)
        } catch {
          /* older WebGL — keep defaults */
        }

        setStage('Loading Google 3D tiles…')
        const tileset = await Cesium.createGooglePhotorealistic3DTileset({ key: MAPS_3D_KEY }, { showCreditsOnScreen: true })
        if (cancelled) {
          viewer.destroy()
          return
        }
        viewer.scene.primitives.add(tileset)
        tileset.maximumScreenSpaceError = 8
        setStage('Framing the roof…')

        const groundH = typeof loc.groundHeight === 'number' ? loc.groundHeight : 25
        const target = Cesium.Cartesian3.fromDegrees(loc.lng, loc.lat, groundH + 4)
        let range = 90
        if (loc.boundingBox) {
          const sw = Cesium.Cartesian3.fromDegrees(loc.boundingBox.west, loc.boundingBox.south)
          const ne = Cesium.Cartesian3.fromDegrees(loc.boundingBox.east, loc.boundingBox.north)
          range = Math.max(70, (Cesium.Cartesian3.distance(sw, ne) / 2 + 4) * 4)
        }
        orbitTargetRef.current = target
        orbitRef.current = { on: false, heading: Cesium.Math.toRadians(15), pitch: Cesium.Math.toRadians(-30), range }
        viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(orbitRef.current.heading, orbitRef.current.pitch, range))
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

        // Auto-orbit tick — advances the heading while enabled.
        viewer.clock.onTick.addEventListener(() => {
          const o = orbitRef.current
          if (!o.on || cancelled) return
          o.heading += 0.0035
          viewer.camera.lookAt(orbitTargetRef.current, new Cesium.HeadingPitchRange(o.heading, o.pitch, o.range))
        })

        if (!cancelled) {
          clearTimeout(watchdog)
          setStatus('ready')
        }
      } catch (e) {
        if (!cancelled) {
          clearTimeout(watchdog)
          setStatus('error')
          setErrMsg(e instanceof Error ? e.message : String(e))
        }
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy()
        } catch {
          /* already torn down */
        }
        viewerRef.current = null
      }
    }
  }, [active, token, address, postcode, state])

  const toggleOrbit = useCallback(() => {
    setOrbiting((wasOn) => {
      const nowOn = !wasOn
      orbitRef.current.on = nowOn
      const viewer = viewerRef.current
      const Cesium = cesiumRef.current
      // Release the camera lock when stopping so the user can free-orbit.
      if (!nowOn && viewer && Cesium) viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
      return nowOn
    })
  }, [])

  return (
    <div className="rounded-card border border-ink-line bg-ink-card p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-meta font-semibold uppercase tracking-[0.16em] text-accent">Fly around in 3D</div>
          <p className="mt-1 max-w-2xl text-sm text-text-sec">
            Orbit the property in Google&rsquo;s photorealistic 3D model — see the whole roof, access,
            tree overhang and neighbours. Drag to orbit, scroll to zoom.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {active && status === 'ready' && (
            <button type="button" onClick={toggleOrbit} className="rounded-ctl inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent">
              {orbiting ? 'Stop orbit' : 'Auto-orbit'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setActive((v) => !v)}
            disabled={address.trim().length < 3}
            className="rounded-ctl inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
          >
            {active ? 'Hide 3D' : (<>Fly around in 3D <span aria-hidden="true">&rarr;</span></>)}
          </button>
        </div>
      </div>

      {active && (
        <div className="relative mt-4">
          <div ref={containerRef} className="rounded-card h-[28rem] w-full overflow-hidden border border-ink-line bg-ink-deep" />
          {status === 'loading' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="inline-flex items-center gap-3 bg-ink-deep/80 px-4 py-2 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec">
                <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/40 border-t-accent" aria-hidden="true" />
                {stage}
              </span>
            </div>
          )}
          {(status === 'error' || status === 'unsupported') && errMsg && (
            <div className="absolute inset-x-0 bottom-0 bg-ink-deep/90 px-4 py-3 text-sm text-warning">{errMsg}</div>
          )}
          <p className="mt-2 text-xs text-text-dim">3D imagery © Google. Aerial-derived — detail softens up close.</p>
        </div>
      )}
    </div>
  )
}

