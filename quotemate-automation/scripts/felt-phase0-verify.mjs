// Phase 0 verification for the Solar Felt tab spec
// (docs/superpowers/specs/2026-06-13-solar-felt-tab-design.md).
//
// Verifies against the REAL Felt workspace, then cleans up:
//   1. create map (satellite basemap, view_only)
//   2. two-step presigned GeoJSON upload
//   3. layer processing poll
//   4. FSL numeric style update
//   5. tokenless embed URL responds
//   6. raster GeoTIFF upload via import_url (best-effort)
//   7. delete map
//
// Run: node --env-file=.env.local scripts/felt-phase0-verify.mjs
// Add --keep to keep the map for manual inspection.

const API = 'https://felt.com/api/v2'
const KEY = process.env.FELT_API_KEY
const KEEP = process.argv.includes('--keep')

if (!KEY) {
  console.error('FELT_API_KEY missing from env')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`)
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 204 etc */
  }
  return { status: res.status, ok: res.ok, json }
}

const PANEL_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { panel_index: 0, yearly_kwh: 612 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [151.2092, -33.8682],
            [151.2093, -33.8682],
            [151.2093, -33.8681],
            [151.2092, -33.8681],
            [151.2092, -33.8682],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { panel_index: 1, yearly_kwh: 540 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [151.2094, -33.8682],
            [151.2095, -33.8682],
            [151.2095, -33.8681],
            [151.2094, -33.8681],
            [151.2094, -33.8682],
          ],
        ],
      },
    },
  ],
}

const FSL = {
  version: '2.3',
  type: 'numeric',
  config: { numericAttribute: 'yearly_kwh', steps: { type: 'continuous', count: 1 } },
  legend: { displayName: { 0: 'Low output', 1: 'High output' } },
  paint: { color: ['#fde89b', '#f37b8a', '#4d53b3'], opacity: 0.9, strokeColor: 'auto', strokeWidth: 1 },
}

// A small public-domain GeoTIFF sample (OSGeo).
const SAMPLE_GEOTIFF_URL =
  'https://download.osgeo.org/geotiff/samples/usgs/o41078a5.tif'

let mapId = null

try {
  // 1 — create map
  {
    const r = await api('POST', '/maps', {
      title: 'QuoteMate Felt Phase 0 verify',
      lat: -33.86815,
      lon: 151.20935,
      zoom: 20,
      basemap: 'satellite',
      public_access: 'view_only',
    })
    mapId = r.json?.id ?? r.json?.data?.id ?? null
    record('create map (satellite, view_only)', r.ok && !!mapId, `status=${r.status} id=${mapId ?? 'n/a'}`)
    if (!mapId) throw new Error('cannot continue without a map id')
    console.log(`      url=${r.json?.url ?? r.json?.data?.url ?? 'n/a'}`)
  }

  // 2 — presigned GeoJSON upload
  let layerId = null
  {
    const r = await api('POST', `/maps/${mapId}/upload`, { name: 'Panel layout' })
    const url = r.json?.url
    const attrs = r.json?.presigned_attributes
    layerId = r.json?.layer_id ?? null
    if (!r.ok || !url || !attrs || !layerId) {
      record('request presigned upload', false, `status=${r.status} body=${JSON.stringify(r.json)?.slice(0, 200)}`)
    } else {
      const form = new FormData()
      for (const [k, v] of Object.entries(attrs)) form.append(k, v)
      form.append(
        'file',
        new Blob([JSON.stringify(PANEL_GEOJSON)], { type: 'application/geo+json' }),
        'panels.geojson',
      )
      const up = await fetch(url, { method: 'POST', body: form })
      record('presigned GeoJSON upload (2-step)', up.ok || up.status === 204, `s3 status=${up.status} layer=${layerId}`)
    }
  }

  // 3 — poll processing
  if (layerId) {
    let status = 'unknown'
    for (let i = 0; i < 24; i++) {
      const r = await api('GET', `/maps/${mapId}/layers/${layerId}`)
      status = r.json?.status ?? 'unknown'
      if (status === 'completed' || status === 'failed') break
      await new Promise((res) => setTimeout(res, 5000))
    }
    record('layer processing completes', status === 'completed', `status=${status}`)

    // 4 — FSL style
    if (status === 'completed') {
      const r = await api('POST', `/maps/${mapId}/layers/${layerId}/update_style`, { style: FSL })
      record('FSL numeric style update', r.ok, `status=${r.status}${r.ok ? '' : ` body=${JSON.stringify(r.json)?.slice(0, 300)}`}`)
    }
  }

  // 5 — tokenless embed
  {
    const res = await fetch(`https://felt.com/embed/map/${mapId}`, { redirect: 'follow' })
    record('tokenless embed URL (view_only)', res.ok, `status=${res.status}`)
  }

  // 6 — raster GeoTIFF via import_url (best-effort)
  {
    const r = await api('POST', `/maps/${mapId}/upload`, {
      import_url: SAMPLE_GEOTIFF_URL,
      name: 'Raster sample',
    })
    const rasterLayer = r.json?.layer_id ?? null
    if (!r.ok || !rasterLayer) {
      record('GeoTIFF import_url accepted', false, `status=${r.status}`)
    } else {
      let status = 'unknown'
      for (let i = 0; i < 36; i++) {
        const lr = await api('GET', `/maps/${mapId}/layers/${rasterLayer}`)
        status = lr.json?.status ?? 'unknown'
        if (status === 'completed' || status === 'failed') break
        await new Promise((res) => setTimeout(res, 5000))
      }
      record('GeoTIFF raster processing', status === 'completed', `status=${status}`)
    }
  }
} catch (e) {
  record('fatal', false, e instanceof Error ? e.message : String(e))
} finally {
  // 7 — cleanup
  if (mapId && !KEEP) {
    const r = await api('DELETE', `/maps/${mapId}`)
    record('delete map (cleanup)', r.status === 204 || r.ok, `status=${r.status}`)
  } else if (mapId) {
    console.log(`KEPT map ${mapId} for inspection`)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 2)
