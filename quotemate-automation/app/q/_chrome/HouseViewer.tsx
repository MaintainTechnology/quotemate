'use client'

// The view-only 3D house viewer — shared by the tradie measure page
// (/m/[token]) and the customer thank-you page, so the two cannot drift.
// Everything tradie-only (Cesium capture, generate, upload, polling, anatomy
// overlays) stays behind on /m.
//
// Lazy by design: the GLB is 10–20 MB, so neither three.js nor the model is
// fetched until the visitor taps "View in 3D". Nobody on mobile data
// downloads 20 MB unasked.
//
// Never throws: no WebGL, or a GLB that won't load, falls back to the poster
// plus a plain-English line.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type * as THREE from 'three'

export type HouseViewerProps = {
  /** Signed GLB URL. */
  modelUrl: string
  /** Hex, e.g. '#323233'. Applied to roof-classified fragments.
   *  Empty (or non-hex) means "leave the roof alone" — mix 0. */
  roofHex: string
  /** Hex. Applied to wall-classified fragments. Empty = no tint. */
  wallHex: string
  /** Poster shown until the user opts in; also the fallback if WebGL fails. */
  posterUrl?: string | null
  /** Accessible label for the canvas region. */
  label?: string
}

type Phase = 'poster' | 'loading' | 'live' | 'failed'

type TintUniforms = {
  uRoofColor: { value: THREE.Color }
  uRoofMix: { value: number }
  uWallColor: { value: THREE.Color }
  uWallMix: { value: number }
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
/** Tint strength when a colour is applied — matches the tradie viewer. */
const TINT_MIX = 0.85

// ── the tint shader ─────────────────────────────────────────────────
//
// DEFECT FIX 1 — do not read three's `vNormal`.
// `ShaderChunk/normal_pars_fragment` declares `varying vec3 vNormal` inside
// `#ifndef FLAT_SHADED`, and WebGLProgram emits `#define FLAT_SHADED` for any
// flat-shaded material — on those the injected code fails to compile and the
// mesh renders black/untinted. MeshBasicMaterial (KHR_materials_unlit GLBs) is
// worse still: it declares vNormal but its vertex shader only writes it under
// USE_ENVMAP/USE_SKINNING, so the value is garbage.
// So we carry our own varying. Both injection points are unconditional in
// every three ShaderLib program: `<common>` (global scope, vertex AND
// fragment) and `<begin_vertex>` (inside main). `normal` and `modelMatrix`
// are declared unconditionally in WebGLProgram's vertex prefix, so the world
// normal is computed without depending on any optional chunk.
// ponytail: ignores morph/skin normal transforms — a static reconstructed
// house GLB has neither; use <defaultnormal_vertex> if that ever changes.

const VERTEX_DECL = `#include <common>
varying vec3 vHouseNormal;`

const VERTEX_ASSIGN = `#include <begin_vertex>
vHouseNormal = mat3(modelMatrix) * normal;`

const FRAGMENT_DECL = `#include <common>
uniform vec3 uRoofColor; uniform float uRoofMix;
uniform vec3 uWallColor; uniform float uWallMix;
varying vec3 vHouseNormal;`

// Classification by world normal, thresholds unchanged from the tradie viewer.
// ponytail: normal-heuristic zones; true per-surface repaint would need Tripo's
// /models/texture re-texture task (paid, slow) or segmentation.
const FRAGMENT_TINT = `#include <map_fragment>
{
  vec3 worldN = normalize(vHouseNormal);
  float up = worldN.y;
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  // Sloped upward faces = roof (excludes flat ground at up≈1).
  float roofMask = step(0.35, up) * (1.0 - step(0.985, up));
  float wallMask = 1.0 - step(0.35, abs(up));
  vec3 roofTint = uRoofColor * (0.25 + lum * 1.5);
  vec3 wallTint = uWallColor * (0.25 + lum * 1.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, roofTint, roofMask * uRoofMix);
  diffuseColor.rgb = mix(diffuseColor.rgb, wallTint, wallMask * uWallMix);
}`

/** Push colours into the live uniforms. A blank/invalid hex disables that
 *  surface's tint rather than painting it black. */
function applyTint(u: TintUniforms, roofHex: string, wallHex: string) {
  const roof = HEX_RE.test(roofHex)
  const wall = HEX_RE.test(wallHex)
  if (roof) u.uRoofColor.value.set(roofHex)
  if (wall) u.uWallColor.value.set(wallHex)
  u.uRoofMix.value = roof ? TINT_MIX : 0
  u.uWallMix.value = wall ? TINT_MIX : 0
}

/** Free every GPU resource the GLB brought with it. renderer.dispose() does
 *  not touch geometries, materials or textures — on a 20 MB model those ARE
 *  the memory. */
function disposeScene(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (!mat) continue
      for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
        const tex = value as { isTexture?: boolean; dispose?: () => void } | null
        if (tex?.isTexture) tex.dispose?.()
      }
      mat.dispose()
    }
  })
}

export function HouseViewer({
  modelUrl,
  roofHex,
  wallHex,
  posterUrl = null,
  label = 'Interactive 3D model of the house',
}: HouseViewerProps): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const uniformsRef = useRef<TintUniforms | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const goneRef = useRef(false)
  const [phase, setPhase] = useState<Phase>('poster')

  const start = useCallback(async () => {
    const box = boxRef.current
    if (!box || phase === 'loading' || phase === 'live') return
    setPhase('loading')
    try {
      const THREE = await import('three')
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')

      // Throws when WebGL is unavailable — caught below, poster stays up.
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(box.clientWidth, box.clientHeight)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(45, box.clientWidth / box.clientHeight, 0.1, 1000)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444433, 2.4))
      const sun = new THREE.DirectionalLight(0xffffff, 2.2)
      sun.position.set(1, 2, 1.2)
      scene.add(sun)

      const gltf = await new GLTFLoader().loadAsync(modelUrl)
      const model = gltf.scene

      // DEFECT FIX 2 — establish the up axis instead of assuming +Y.
      // Tripo is asked for orientation 'default', which does not promise Y-up,
      // and the pipeline only ever translates the model. A house's vertical
      // extent is far smaller than either horizontal one, so the SHORTEST bbox
      // dimension is up; rotate once so it is +Y before the masks (which test
      // worldN.y) mean anything.
      // ponytail: resolves the axis, not its sign — an upside-down model would
      // still swap roof and walls. No cheap bbox signal distinguishes them.
      const pre = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
      if (pre.x < pre.y && pre.x < pre.z) model.rotateZ(Math.PI / 2)
      else if (pre.z < pre.y && pre.z < pre.x) model.rotateX(-Math.PI / 2)
      model.updateMatrixWorld(true)

      // Frame it: centre at origin, camera pulled back by its size.
      const bounds = new THREE.Box3().setFromObject(model)
      const size = bounds.getSize(new THREE.Vector3())
      model.position.sub(bounds.getCenter(new THREE.Vector3()))
      scene.add(model)
      const dim = Math.max(size.x, size.y, size.z) || 1
      camera.position.set(dim * 1.2, dim * 0.8, dim * 1.2)

      // Recolour hook: tint fragments by world normal, injected into every
      // material so the pickers work on Tripo's single baked-texture output.
      const uniforms: TintUniforms = {
        uRoofColor: { value: new THREE.Color('#ffffff') },
        uRoofMix: { value: 0 },
        uWallColor: { value: new THREE.Color('#ffffff') },
        uWallMix: { value: 0 },
      }
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh || !mesh.material) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          mat.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms)
            shader.vertexShader = shader.vertexShader
              .replace('#include <common>', VERTEX_DECL)
              .replace('#include <begin_vertex>', VERTEX_ASSIGN)
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', FRAGMENT_DECL)
              .replace('#include <map_fragment>', FRAGMENT_TINT)
          }
          mat.needsUpdate = true
        }
      })
      uniformsRef.current = uniforms
      applyTint(uniforms, roofHex, wallHex)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.target.set(0, 0, 0)

      let raf = 0
      const animate = () => {
        raf = requestAnimationFrame(animate)
        controls.update()
        renderer.render(scene, camera)
      }

      // The box is a React-empty node — appendChild only, NEVER
      // replaceChildren (mutating React-managed children crashes reconciliation
      // with "removeChild … not a child of this node").
      cleanupRef.current?.()
      box.appendChild(renderer.domElement)
      animate()

      // The box height is fluid (h-full with a min), so watch the element
      // rather than the window.
      const resize = new ResizeObserver(() => {
        const w = box.clientWidth
        const h = box.clientHeight
        if (!w || !h) return
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      })
      resize.observe(box)

      cleanupRef.current = () => {
        cancelAnimationFrame(raf)
        resize.disconnect()
        controls.dispose()
        disposeScene(scene)
        renderer.dispose()
        renderer.domElement.remove()
        uniformsRef.current = null
        cleanupRef.current = null
      }

      // Unmounted while the 10–20 MB download was in flight: tear the whole
      // thing down rather than leaving an animation loop running forever.
      if (goneRef.current) {
        cleanupRef.current()
        return
      }
      setPhase('live')
    } catch {
      // Never throw at the page: WebGL missing, GLB 404, network drop — the
      // poster and a retry are the whole recovery story.
      setPhase('failed')
    }
  }, [modelUrl, roofHex, wallHex, phase])

  // Colour changes push straight into the live uniforms — never a GLB reload.
  useEffect(() => {
    const u = uniformsRef.current
    if (u) applyTint(u, roofHex, wallHex)
  }, [roofHex, wallHex])

  // modelUrl deliberately does not retrigger a load: the tradie page re-signs
  // the URL on every poll, so keying on it would reload the model constantly.
  useEffect(() => {
    goneRef.current = false
    return () => {
      goneRef.current = true
      cleanupRef.current?.()
    }
  }, [])

  return (
    <div
      role="region"
      aria-label={label}
      className="relative h-full min-h-[22rem] w-full overflow-hidden bg-ink-deep"
    >
      {/* Canvas host — React renders NOTHING inside; three.js appends its
          canvas imperatively. Keeping it childless in JSX is what makes the
          imperative appendChild safe. */}
      <div ref={boxRef} className="absolute inset-0" />

      {phase !== 'live' && (
        <div className="absolute inset-0">
          {posterUrl && (
            // Background image rather than <img>: the poster is a decorative
            // stand-in for the canvas (the region carries the label), and a
            // signed storage URL is not in next/image's remotePatterns.
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${encodeURI(posterUrl)}")` }}
            />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-deep/45 px-6 text-center">
            {phase === 'loading' ? (
              <p className="inline-flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-sec">
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/40 border-t-accent"
                  aria-hidden="true"
                />
                Loading the 3D model…
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void start()}
                className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-accent-ink hover:bg-accent-press"
              >
                {phase === 'failed' ? 'Try again' : 'View in 3D'}
              </button>
            )}
            {phase === 'failed' && (
              <p className="max-w-sm text-xs text-text-dim">
                The 3D model didn&rsquo;t load. Check your connection and try again.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
