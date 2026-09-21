// Worker Cloudflare — overpass-proxy
// Proxy CORS pour l'API Overpass OSM
// Cascade de miroirs : kumi.systems → private.coffee → openstreetmap.ru → maps.mail.ru
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

const TIMEOUT_MS = 8000

async function tryMirror(mirror, body, signal) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  // Chaîner avec le signal externe
  signal?.addEventListener('abort', () => ctrl.abort())
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

export default {
  async fetch(request) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // Lire le body de la requête entrante
    const body = await request.text()
    if (!body) {
      return new Response(JSON.stringify({ error: 'Body vide — envoyer data=<query QL>' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const ctrl = new AbortController()
    let lastError = null

    // Essayer les miroirs en cascade
    for (const mirror of MIRRORS) {
      try {
        console.log(`[overpass-proxy] essai ${mirror}`)
        const resp = await tryMirror(mirror, body, ctrl.signal)
        const headers = new Headers(CORS)
        const ct = resp.headers.get('content-type')
        if (ct) headers.set('Content-Type', ct)
        headers.set('X-Overpass-Mirror', mirror)
        headers.set('Cache-Control', 'public, max-age=60')
        console.log(`[overpass-proxy] ✅ ${mirror}`)
        return new Response(resp.body, { status: 200, headers })
      } catch (e) {
        console.warn(`[overpass-proxy] ❌ ${mirror} — ${e.message}`)
        lastError = e.message
      }
    }

    // Tous les miroirs ont échoué
    return new Response(JSON.stringify({ error: 'Tous les miroirs Overpass ont échoué', lastError }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  },
}
