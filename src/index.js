// Worker Cloudflare — overpass-proxy v2
// Proxy CORS pour l'API Overpass OSM
// Cascade de miroirs avec shuffle + retry 2× par miroir + timeout 5s
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

const TIMEOUT_MS = 5000  // 5s par tentative (était 8s)
const RETRIES    = 2      // tentatives par miroir avant de passer au suivant

// Shuffle Fisher-Yates — répartit la charge entre miroirs
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

export default {
  async fetch(request) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

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
          // Petite pause avant retry sur le même miroir
          if (attempt < RETRIES) await new Promise(r => setTimeout(r, 300))
        }
      }
    }

    // Tous les miroirs ont échoué
    return new Response(JSON.stringify({ error: 'Tous les miroirs Overpass ont échoué', lastError }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  },
}
