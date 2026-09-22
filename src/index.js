// Worker Cloudflare — overpass-proxy v3
// Routes :
//   POST /          → proxy Overpass OSM (cascade 4 miroirs, shuffle, retry 2×)
//   GET  /wfs?...   → proxy WFS Géorisques (CORS bloqué depuis vigie-4ze.pages.dev)
// URL finale : https://overpass-proxy.bounes-v.workers.dev

const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

const TIMEOUT_MS = 5000
const RETRIES    = 2

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function tryMirror(mirror, body) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(mirror, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function proxyWFS(request) {
  // Transférer tous les query params vers Géorisques WFS
  const inUrl  = new URL(request.url)
  const target = 'https://georisques.gouv.fr/api/v1/wfs' + inUrl.search
  const ctrl   = new AbortController()
  const timer  = setTimeout(() => ctrl.abort(), 10000)
  try {
    const r = await fetch(target, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) throw new Error(`WFS ${r.status}`)
    const headers = new Headers(CORS)
    const ct = r.headers.get('content-type')
    if (ct) headers.set('Content-Type', ct)
    headers.set('Cache-Control', 'public, max-age=120')
    console.log('[wfs-proxy] ✅', target)
    return new Response(r.body, { status: 200, headers })
  } catch (e) {
    clearTimeout(timer)
    console.warn('[wfs-proxy] ❌', e.message)
    return new Response(JSON.stringify({ error: 'WFS Géorisques indisponible', detail: e.message }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // Route /wfs → proxy Géorisques WFS
    if (url.pathname === '/wfs') {
      return proxyWFS(request)
    }

    // Route / → proxy Overpass
    const body = await request.text()
    if (!body) {
      return new Response(JSON.stringify({ error: 'Body vide — envoyer data=<query QL>' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const mirrors = shuffle(MIRRORS)
    let lastError = null

    for (const mirror of mirrors) {
      for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
          console.log(`[overpass-proxy] essai ${mirror} (tentative ${attempt}/${RETRIES})`)
          const resp = await tryMirror(mirror, body)
          const headers = new Headers(CORS)
          const ct = resp.headers.get('content-type')
          if (ct) headers.set('Content-Type', ct)
          headers.set('X-Overpass-Mirror', mirror)
          headers.set('X-Overpass-Attempt', String(attempt))
          headers.set('Cache-Control', 'public, max-age=60')
          console.log(`[overpass-proxy] ✅ ${mirror} tentative ${attempt}`)
          return new Response(resp.body, { status: 200, headers })
        } catch (e) {
          console.warn(`[overpass-proxy] ❌ ${mirror} tentative ${attempt} — ${e.message}`)
          lastError = e.message
          if (attempt < RETRIES) await new Promise(r => setTimeout(r, 300))
        }
      }
    }

    return new Response(JSON.stringify({ error: 'Tous les miroirs Overpass ont échoué', lastError }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  },
}
