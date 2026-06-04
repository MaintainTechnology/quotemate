'use client'

// Painting — interactive 3D fly-around with the new paint colour.
//
// Renders Google Photorealistic 3D Tiles in CesiumJS (loaded DIRECTLY with
// the Google Maps key — no Cesium Ion needed) and applies a CustomShader
// that tints the building's WALLS toward the chosen colour while keeping
// the photo's light/shadow, so it reads as paint. The wall mask is
// heuristic (the mesh has no per-building tags): a fragment is painted when
// it is (a) within the building footprint radius (from the Solar bounding
// box) and (b) on a near-vertical surface (walls, not roof/ground). This
// is approximate — some bleed onto fences/neighbours is expected; the value
// is the fly-around, not pixel-perfect fidelity.
//
// CesiumJS is heavy + WebGL, so it's dynamically imported in an effect
// (SSR-safe), mirroring RoofMap.tsx. Static assets are served from
// /cesium (copied by scripts/copy-cesium-assets.mjs).

import { useEffect, useRef, useState } from 'react'

type Props = {
  token: string | null
  address: string
  postcode: string
  state: string
  /** Paint colour — a CSS colour (#hex) or a known swatch name. */
  colour: string
}

type Loc = { lat: number; lng: number; boundingBox: { south: number; west: number; north: number; east: number } | null; groundHeight?: number | null }

const MAPS_3D_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_3D_KEY ?? ''
const ION_TOKEN = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? ''

// A few AU paint-swatch names → hex, so named swatches still tint the 3D.
const SWATCH_HEX: Record<string, string> = {
  'surfmist off-white': '#e4e3dd',
  'dulux natural white': '#efebdf',
  'dulux vivid white': '#f7f6f1',
  'lexicon quarter': '#eef0ef',
  'hog bristle': '#d8cdb4',
  'monument charcoal': '#323233',
  'basalt grey': '#69676a',
  'woodland grey': '#4d4f4c',
  'shale grey': '#bcbbb4',
  'sage green': '#8a9a7b',
  'hamptons blue': '#9fb6c9',
  terracotta: '#9c5a3c',
  'heritage red': '#7a342c',
  'charcoal black': '#2b2b2d',
}

export function Paint3DTilesViewer({ token, address, postcode, state, colour }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shaderRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cesiumRef = useRef<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // Build / tear down the scene when the address changes.
  useEffect(() => {
    if (!MAPS_3D_KEY) {
      setStatus('unsupported')
      setErrMsg('Set NEXT_PUBLIC_GOOGLE_MAPS_3D_KEY (a browser Maps key with the Map Tiles API enabled) to use the 3D view.')
      return
    }
    if (!token || address.trim().length < 3) return

    let cancelled = false
    setStatus('loading')
    setErrMsg(null)

    void (async () => {
      try {
        // 1. Resolve the building location + footprint box (server-side key).
        const locRes = await fetch('/api/painting/3d-location', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, postcode, state }),
        })
        const locJson = (await locRes.json()) as ({ ok: true } & Loc) | { ok: false; code?: string; detail?: string }
        if (!locJson.ok) throw new Error(locJson.detail ?? locJson.code ?? 'Could not locate the property.')
        if (cancelled) return

        // 2. Load Cesium (set asset base + Ion token before the import).
        ;(window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium'
        ensureCesiumCss()
        const Cesium = await import('cesium')
        if (cancelled || !containerRef.current) return
        cesiumRef.current = Cesium
        if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN

        // 3. Viewer with no globe (Google tiles supply terrain + imagery) and minimal UI.
        const viewer = new Cesium.Viewer(containerRef.current, {
          globe: false,
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

        // 4. Google Photorealistic 3D Tiles, loaded directly with the Maps key.
        const tileset = await Cesium.Cesium3DTileset.fromUrl(
          `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(MAPS_3D_KEY)}`,
          { showCreditsOnScreen: true },
        )
        if (cancelled) {
          viewer.destroy()
          return
        }
        viewer.scene.primitives.add(tileset)

        // 5. The recolour shader (wall mask + luminance-preserving tint).
        const { center, up, radius } = maskGeometry(Cesium, locJson)
        const rgb = colourToRgb(colour)
        const shader = buildRecolorShader(Cesium, center, up, radius, rgb)
        tileset.customShader = shader
        shaderRef.current = shader

        // 6. Frame the building obliquely, then release so the user can orbit.
        const groundH = typeof locJson.groundHeight === 'number' ? locJson.groundHeight : 25
        const target = Cesium.Cartesian3.fromDegrees(locJson.lng, locJson.lat, groundH + 4)
        viewer.camera.lookAt(
          target,
          new Cesium.HeadingPitchRange(Cesium.Math.toRadians(15), Cesium.Math.toRadians(-26), Math.max(70, radius * 4)),
        )
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

        if (!cancelled) setStatus('ready')
      } catch (e) {
        if (!cancelled) {
          setStatus('error')
          setErrMsg(e instanceof Error ? e.message : String(e))
        }
      }
    })()

    return () => {
      cancelled = true
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy()
        } catch {
          /* already torn down */
        }
        viewerRef.current = null
      }
    }
  }, [token, address, postcode, state])

  // Live-update the tint when the colour changes (no rebuild).
  useEffect(() => {
    const shader = shaderRef.current
    const Cesium = cesiumRef.current
    if (!shader || !Cesium) return
    const rgb = colourToRgb(colour)
    try {
      shader.setUniform('u_targetColor', new Cesium.Cartesian3(rgb[0], rgb[1], rgb[2]))
    } catch {
      /* shader not ready */
    }
  }, [colour])

  return (
    <div className="relative">
      <div ref={containerRef} className="h-[28rem] w-full overflow-hidden border border-ink-line bg-ink-deep" />
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="inline-flex items-center gap-3 bg-ink-deep/80 px-4 py-2 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec">
            <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/40 border-t-accent" aria-hidden="true" />
            Loading 3D…
          </span>
        </div>
      )}
      {(status === 'error' || status === 'unsupported') && errMsg && (
        <div className="absolute inset-x-0 bottom-0 bg-ink-deep/90 px-4 py-3 text-sm text-warning">{errMsg}</div>
      )}
    </div>
  )
}

// ─── Shader + geometry helpers ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function maskGeometry(Cesium: any, loc: Loc): { center: any; up: any; radius: number } {
  const center = Cesium.Cartesian3.fromDegrees(loc.lng, loc.lat)
  const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(center, new Cesium.Cartesian3())
  let radius = 16
  if (loc.boundingBox) {
    const sw = Cesium.Cartesian3.fromDegrees(loc.boundingBox.west, loc.boundingBox.south)
    const ne = Cesium.Cartesian3.fromDegrees(loc.boundingBox.east, loc.boundingBox.north)
    radius = Cesium.Cartesian3.distance(sw, ne) / 2 + 4
  }
  return { center, up, radius }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRecolorShader(Cesium: any, center: any, up: any, radius: number, rgb: [number, number, number]): any {
  return new Cesium.CustomShader({
    mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms: {
      u_center: { type: Cesium.UniformType.VEC3, value: center },
      u_up: { type: Cesium.UniformType.VEC3, value: up },
      u_radius: { type: Cesium.UniformType.FLOAT, value: radius },
      u_targetColor: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(rgb[0], rgb[1], rgb[2]) },
      u_strength: { type: Cesium.UniformType.FLOAT, value: 0.85 },
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 pos = fsInput.attributes.positionWC;
        vec3 d = pos - u_center;
        float vUp = dot(d, u_up);
        vec3 horiz = d - vUp * u_up;
        float hDist = length(horiz);
        float inFootprint = 1.0 - smoothstep(u_radius * 0.82, u_radius, hDist);
        vec3 upEC = normalize((czm_view * vec4(u_up, 0.0)).xyz);
        float vert = 1.0 - abs(dot(normalize(fsInput.attributes.normalEC), upEC));
        float vertMask = smoothstep(0.4, 0.65, vert);
        float mask = inFootprint * vertMask;
        vec3 src = material.diffuse;
        float luma = dot(src, vec3(0.299, 0.587, 0.114));
        vec3 painted = u_targetColor * (0.35 + 0.75 * luma);
        material.diffuse = mix(src, painted, u_strength * mask);
      }
    `,
  })
}

/** Resolve a colour string (#hex or known swatch name) to [r,g,b] in 0..1. */
function colourToRgb(colour: string): [number, number, number] {
  const c = (colour ?? '').trim().toLowerCase()
  let hex = ''
  if (/^#[0-9a-f]{6}$/.test(c)) hex = c
  else if (SWATCH_HEX[c]) hex = SWATCH_HEX[c]
  else {
    // try first matching swatch by substring (e.g. "monument" → monument charcoal)
    const key = Object.keys(SWATCH_HEX).find((k) => k.includes(c) || c.includes(k.split(' ')[0]))
    hex = key ? SWATCH_HEX[key] : '#8a8a8a'
  }
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b]
}

let cssInjected = false
function ensureCesiumCss() {
  if (cssInjected || typeof document === 'undefined') return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '/cesium/Widgets/widgets.css'
  document.head.appendChild(link)
  cssInjected = true
}
