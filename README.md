# VinKjeller 🍷

Personlig vinkjeller-app (PWA): skann flasker inn og ut av kjelleren, se hva du kan lage av
det du har, hva du mangler, og hvor lenge lageret holder. Bygget av Harald & AI.

- **Spesifikasjon:** [`docs/spec.md`](docs/spec.md)
- **API-undersøkelse:** [`docs/api-research.md`](docs/api-research.md)
- **Idéer:** [`ideas.md`](ideas.md)
- **Changelog:** [`changelog.md`](changelog.md)

## Status

🍷 **v0.1.0 scaffold ferdig (2026-08-27)** — kjører lokalt, klar for deploy til
`vinkjeller.harsku.no` (se `DEPLOYMENT.md`).

## Rask start (lokalt)

```bash
npm install
cp .env.example .env   # VINMONOPOLET_API_KEY ligger allerede i .env her
npm run dev            # API på :3001, web på :5173 (proxyer /api)
```

```bash
npm run build          # bygger PWA (web/dist)
npm start              # serveren serverer både API og PWA på :3001
```

## Struktur

```
├── server/          Fastify + node:sqlite (API-proxy, throttling, cache, auth, kjeller)
├── web/             React 19 + Vite PWA + @digdir/designsystemet-react + i18next
├── data/recipes.json  24 seed-oppskrifter (delles server/client)
├── docs/            spec + API-undersøkelse
├── Dockerfile, docker-compose.yml, DEPLOYMENT.md
└── server/scripts/enrich.js   VALGFRI manuell berikelse (ikke del av appen)
```

## Vinmonopol-API

Appen bruker **kun Vinmonopols offisielle, publiserte API-er** (ToS v01.09.2024: unpublished
APIs er forbudt — deres nettsteds-API brukes derfor ikke). Nøkkelen ligger **kun** server-side (`.env`).

⚠️ **Nøkkel-status (2026-08-27):** products v0 ✅, stores v0 ✅, **my-products v1 ❌** —
den er B2B-kanalen og ikke åpen for publikum. Uten den kjører appen i `thin`-modus
(navn + popularitet, ingen offisiell strekkodeløsning) og «lyser opp» automatisk i `rich`-modus
hvis vi får tilgang (strekkoder, druer, smaksnotater, priser …). Se `docs/spec.md`.

📎 **IKKE COMMIT:** `*.yaml`-filene (API-dokumentasjon, konfidensiell ifølge deres ToS) og
`.env` er i `.gitignore`. Hold dem lokalt.

## Ansvarsfraskrivelse

Ikke tilknyttet Vinmonopolet. Produktdata © Vinmonopolet — vises med kildestilling, ingen
reklame, ingen logo/merke. Kjøp skjer hos Vinmonopolet. Drik med ansvar (18+).
