# Changelog

Alle verdt-å-vite endringer i VinKjeller. Format inspirert av [Keep a Changelog](https://keepachangelog.com/), versjoner følger semver når appen er ute.

## [0.1.0] — 2026-08-27

### Added
- **Ferdig scaffold** av hele appen:
  - **Backend** (`server/`): Fastify + innebygd `node:sqlite` (ingen native avhengigheter).
    Session-cookie-auth (scrypt), API-proxy til Vinmonopols offisielle API-er med
    intern throttling (55/min, 3800/dag — under offisielle grenser), cache for
    produkter/salg/butikker, kjeller (én rad = én fysisk flaske, custom items),
    oppskrifter + rundelogg, daglig jobb (populær-i-Norge), `POST /api/purge-vinmonopol` (ToS).
  - **Frontend** (`web/`): React 19 + Vite + TypeScript, PWA (installbar, service worker,
    manifest, borgund-ikon), `@digdir/designsystemet-react` med egen **borgund-theme**
    (lys/mørk/automatisk), i18next med **nb, nn, en, vi**.
  - **Sider:** Kjeller (liste, filtrer/sort, søk i Vinmonopol-katalogen, custom items,
    flaske-detall, «Ta ut» med grunn), Drikk (kan lage / mangler / mine oppskrifter,
    «Lag en runde», estimert-til-tom, nye oppskrifter, favoritter), Skann
    (kamera med BarcodeDetector + zxing-fallback + manuell søk), Innstillinger
    (profil, språk, tema, butikk [snart], purge, om, logg ut).
  - **24 seed-oppskrifter** i `data/recipes.json` (G&T, negroni, spritz, sangria,
    gløgg, moscow mule, old fashioned, mojito, akvavit …) med flerspråklige
    søkeord per ingrediens.
  - **Deploy:** `Dockerfile` (multi-stage), `docker-compose.yml` (port **3001**,
    data i `./data`), `DEPLOYMENT.md` (Caddy: `vinkjeller.harsku.no` + `v.harsku.no`).
  - `server/scripts/enrich.js` — **valgfri**, manuell, menneskeaktet berikelse av
    enkeltprodukter fra offisielle produktsider (JSON-LD). Ikke en del av appfløten.
- 2026-08-27 — Prosjektet startet. Ideer samlet i `ideas.md` (fra brainstorm-snakk).
- 2026-08-27 — API-undersøkelse: Vinmonopol offisielle API-er (products v0, my-products v1, stores v0) + vmpws-nettsteds-API dokumentert i `docs/api-research.md`.
- 2026-08-27 — Spesifikasjon i `docs/spec.md` (arkitektur, datamodell, funksjoner, språk, design, deploy, ToS-samsvar).
- 2026-08-27 — `.env` med Vinmonopol-API-nøkkel (products v0 + stores v0; **my-products v1 mangler abonnement** — se README).

### Decisions
- Web + PWA (installabel på telefon), ingen app-butikk.
- **Kun offisielle, publiserte Vinmonopol-API-er** i koden (ToS). vmpws finnes kun som referanse i `docs/api-research.md`.
- ToS-analyse (API Terms v01.09.2024): samsvarstabell i `docs/spec.md`, purge-funksjon implementert, `*.yaml` + `.env` + SQLite-filer i `.gitignore`.
- my-products v1 er B2B-kanal (401) → **`thin`/`rich`-modus** for produktdata: appen fungerer i dag på products v0 + stores v0 og «lyser opp» automatisk (`PRODUCT_DATA_MODE=rich`) når full tilgang kommer.
- Innebygd `node:sqlite` + `node:crypto` (scrypt) — null native-avhengigheter, enkel Docker-build.
- React 19 + Vite 8; designsystemet.no (åpen kilde) med accent-override i borgund.
- 4 språk: nb (bokmål), nn (nynorsk), en, vi.
- Én oppføring per fysisk flaske; custom items tillatt (homebrew osv.).
- Produktbilder hotlinkes fra Vinmonopols åpne bilde-CDN (togglebar via `HOTLINK_IMAGES`, 404 → ikon).
- Barcode `075496331075` → **Angostura Orange Bitters** (produkt 5096703), bekreftet mot offisielt API — strekkodesøk «lyser opp» i rich-modus.

### Verified (2026-08-27, mot live-API)
- `POST /api/auth/register` → session, seed-oppskrifter i DB.
- `GET /api/products/search?q=angostura` → finner 5096703 «Angostura Orange Bitters» + 10 andre.
- `GET /api/products/5096703` → cache + bilder + popularitet (113 flasker / 11,3 L siste 3 mnd).
- Legg til vm-flaske + custom-flaske, kjellerliste med produktinfo + popularitet,
  rundelogg (old fashioned med bitters 0,1 cl), «ta ut» med grunn,
  `POST /api/purge-vinmonopol` (slettet 1 produkt / 25 016 salgsrader / 356 butikk).
- Butikksynk fra stores v0 (356 butikker med GPS + åpningstider).
- `tsc --noEmit` ✅, `vite build` ✅ (PWA manifest + service worker), server + PWA servert fra én port.

## [0.1.0-deploy] — 2026-08-27

### Done
- **Oppe i produksjon** på `https://vinkjeller.harsku.no` (+ alias `https://v.harsku.no`) —
  Docker på harsku.no, Caddy (auto-HTTPS), port 3001. Verifisert: API, PWA-manifest,
  service worker og app-HTML på begge subdomainene.

## [Unreleased]
### Added
- **Mange flasker på én gang** — antallsvelger (1–99) når du legger til et produkt fra Skann-siden eller «Legg til» i kjelleren (f.eks. 6ere). Én handling = N fysiske flasker, hver med sin «time on the shelf». `POST /api/me/cellar` godtar `qty`.
- **Skann-siden skjelner nå mellom «finnes ikke» og «strekkodesøk utilgjengelig»**: `GET /api/products/by-gtin/:gtin` returnerer `reason` (`bad_gtin` / `gtin_unavailable` / `not_found`). I `thin`-modus (ingen my-products v1) viser Skann-siden en tydelig melding om at strekkodesøk krever full Vinmonopol-tilgang — med peiling mot navnssøk/produktnummer — i stedet for å si at produktet finnes ikke. Kort kode (< 2 tegn) avvises med toast.
- **Lært strekkode-tilkobling** (`gtin_map`): når en strekkode er knyttet til et produkt (automatisk i rich-modus fra produktets barcode-liste, eller manuelt via den nye «💾 Lagre strekkoden»-knappen på skann-resultatet), fungerer scann av den flasken videre **uten API-kall — også i thin-modus**. Ny endpoint: `POST /api/products/remember-gtin`.
### Fixed
- **Skann la til ekstrastreker** (én i start, én i slutt) på strekkoder (f.eks. bitters: `075496331075` → `2075…54`), så produktet ikke ble funnet. `byGtin` normaliserer nå koden med **GTIN-styresiffer-validering**: ugyldig kode → prøver å klippe vekk ett siffer i starten og/eller slutten, og kun aksepterer hvis resultatet er et gyldig GTIN (8/12/13/14 siffer).
- `byGtin` kastet feil på kalde produkt-caches («Unknown named parameter 'cached'» fra et overflødig double-upsert) og svarte `gtin_unavailable` selv når strekkoden var lært — fikset.
- Eventuelt: søk hos Vinmonopol om tilgang til my-products v1 → `PRODUCT_DATA_MODE=rich` (strekkoder + full data).
