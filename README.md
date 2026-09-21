# overpass-proxy

Worker Cloudflare — proxy CORS pour l'API Overpass OSM.
Cascade automatique sur 4 miroirs : kumi.systems → private.coffee → openstreetmap.ru → maps.mail.ru

## Structure
```
overpass-proxy/
├── src/
│   └── index.js   ← code du Worker
├── wrangler.toml  ← config Cloudflare
└── README.md
```

## Usage
POST https://overpass-proxy.bounes-v.workers.dev
Body: data=<query Overpass QL>

## Pour modifier les miroirs
Éditer MIRRORS[] dans src/index.js, commiter → Cloudflare redéploie automatiquement.
