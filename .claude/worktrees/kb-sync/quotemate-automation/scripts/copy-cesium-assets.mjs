// Copy CesiumJS static runtime assets (Workers / Assets / Widgets / ThirdParty)
// into public/cesium so they're served at /cesium. CesiumJS needs these at
// runtime (window.CESIUM_BASE_URL = '/cesium'). Runs on postinstall so Vercel
// regenerates them; public/cesium is gitignored.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'node_modules', 'cesium', 'Build', 'Cesium')
const dest = join(here, '..', 'public', 'cesium')

if (!existsSync(src)) {
  // cesium not installed (e.g. a slim CI) — don't fail the install.
  console.log('[cesium-assets] cesium build not found, skipping copy.')
  process.exit(0)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log('[cesium-assets] copied Cesium runtime assets → public/cesium')
