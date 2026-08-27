# VinKjeller — spesifikasjon v0.1

Personlig vinkjeller-app (PWA): skann flasker inn/ut av kjelleren, se hva du kan drikke,
hva du mangler, og hvor lenge lageret holder. Data fra Vinmonopol-API-ene (se `docs/api-research.md`).

## Mål

- Raskt skanne en flaske og få den inn i "min vinkjeller" (eller ta den ut).
- Se kjelleren med samme type inndeling/info som Vinmonopol-appen (kategori, land, distrikt,
  pris, alkohol, bilde, beskrivelse).
- Se hvilke drinker/retter man kan lage av det som er på lageret, og hva man mangler.
- "Estimert til tom" per produkt basert på loggede runder.
- Funksjoner uten nett (offline-first), installabel på telefonen (PWA), ingen app-butikk.
- 4 språk: **nb** (bokmål), **nn** (nynorsk), **en**, **vi** (vietnamesisk).

## Ikke-mål (v1)

- Ingen app-butikk-publikering, ingen native-app.
- Ingen butikk-lagersjekk / kart (parkert i `ideas.md`).
- Ingen komplekse roller/deleringsmodeller (enkelt brukerkonto for synk).
- Ingen kjøp/checkout — alt kjøp skjer hos Vinmonopolet.

## ToS-samsvar (Vinmonopol API Terms v01.09.2024)

| Krav/avtale | Hvordan vi holder det |
|---|---|
| Kun publiserte API-er («no unpublished APIs») | Kun `apis.vinmonopolet.no` (products v0, stores v0; my-products v1 hvis tilgang). **vmpws brukes IKKE** (vurdert 2026-08-27, forkastet). |
| Personlig/internt bruk, ingen deling av tilgang | Personlig app, ingen salg/leasing/omfordeling av API-data. Venn som bruker appen mottar ingen API-tilgang. |
| Data lagres/serveres med sterk kryptering | HTTPS (Caddy, auto-LetsEncrypt) for all servering. DB: SQLite på serveren — produktdata er offentlig info; personlig kjellerdata: vi anbefaler disk-kryptering på serveren (se `ideas.md`). |
| Ikke overskride rate limits (60/min, 4000/dag) | Server-side rate-limiter + daglig job med `changedSince` (minimalt antall kall). |
| Ikke kopiere/konkurrere med tjenesten, ikke inngrep i kjøp | Personlig kjeller-app: ingen salg, ingen ordre, ingen e-post til Vinmonopolet, ingen logo/merke, åpenbart ikke-reklame («Data: Vinmonopolet», lenke til dem for kjøp). |
| Ødelegge data ved oppsigelse | «Purge Vinmonopol-data» i innstillinger: sletter `products_cache`, `sales_cache`, `stores_cache` (keeper brukerens egne data). |
| Konfidensiell dokumentasjon | YAML-filene + nøkkel: `.gitignore`, aldri i GitHub. |

## Plattformer og stack

| Del | Valg | Kommentar |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | |
| UI | `@digdir/designsystemet-css` + `@digdir/designsystemet-react` | Fritt, åpent, norske standarder. Egen theme (borgund). |
| i18n | `i18next` + `react-i18next` | nb / nn / en / vi |
| PWA | `vite-plugin-pwa` | installbar, offline-cache (Workbox) |
| Barcode | `BarcodeDetector` (Web API) + `@zxing/browser` fallback + manuell inntast | iOS Safari mangler BarcodeDetector → zxing |
| Backend | Node + Fastify + `better-sqlite3` | Tynn: API-proxy + lagring + synk |
| Deploy | Docker + Caddy på harsku.no | Samme mønster som DnD-Scheduler (`DEPLOYMENT.md` der) |
| Domene | `vinkjeller.harsku.no` (forslag) | |

### Hvorfor backend?

1. API-nøkkelen (Vinmonopol) skal **ikke** ligge i klienten.
2. Server-side cache av produktdata + salg (holder throttling-taket: 60/min, 4000/dag).
3. Synk mellom Haralds telefoner/PC-er.
4. Daglig job: hent månedssalg → "populær i Norge"-badge.

## Arkitektur

```
[ PWA (telefon/PC) ]  ←JSON→  [ Fastify-backend (harsku.no) ]
    offline: IndexedDB             │  cache (SQLite): produkter, salg, butikker
                                   │  data: brukere, kjeller, flasker, oppskrifter, runder
                                   └──→ apis.vinmonopolet.no (KUN offisielle API-er, nøkkel server-side)
```

- Frontend er **offline-first**: kjeller + oppskrifter i IndexedDB, synk med backend når online.
- Backend eksponerer egne endpoints (se under) — frontend rører aldri Vinmonopol-API-ene direkte.

### Produktdata: «thin» vs «rich» (viktig!)

my-products v1 (full data + strekkoder) er **ikke offentlig** (B2B). Derfor har produktlags
et grensesnitt med to modus, vekslet med `PRODUCT_DATA_MODE=thin|rich`:

| | `thin` (fungerer i dag) | `rich` (når my-products v1 tilgang kommer)
|---|---|---
| Søk | products v0 `details-normal?productShortNameContains=` (navn + id) | my-products v1 `details?freeText=` (fullt)
| Detaljer | id + shortName + popularitet (monthly-sales) | full masterdata (druer, smakk, allergener, priser …)
| Strekkode | ❌ (skanning → «ikkje funnet» → manual/custom) | `details?gtin=` ✅
| Bilde | hotlink `bilder.vinmonopolet.no/cache/300x300-0/{id}-1.jpg` (toggle `HOTLINK_IMAGES`, standard PÅ — same as the website does; 404 → ikon) | same (toggle)

> **Vurdering om hotlinked bilder:** statiske, offentlige fil-URL-er (ingen nøkkel, ingen
> API- kall — nettsiden selv viser dem slik). Vi lagrer kun URL-en, ikke filen. Avbart i README.
> Om Vinmonopol reagerer: slås av med én envare.

## Datamodell (SQLite)

```
users            id, email, passHash, name, createdAt
cellar_items     id, userId,
                 source: 'vm' | 'custom',
                 vmProductId?,            -- for 'vm'
                 customName?, customType?, customAbv?, customVolumeCl?,
                 customNote?,             -- feks homebrew-batch
                 addedAt,                 -- "time on the shelf" starter her
                 removedAt?, removedReason? -- 'drank' | 'given' | 'spoiled' | …
                 photoUrl?                -- eget bilde (custom)
products_cache   vmProductId PK, gtinText, name, longName, category, subCategory,
                 country, region, subRegion, abv, volumeCl, price, priceValidFrom,
                 vintage, grapesJson, descriptionJson, imageUrlsJson,
                 popularScore?, fetchedAt
sales_cache      month, vmProductId, liters, items, updatedAt     -- "populær"
recipes          id, nameKey, image?, glassType?,
                 ingredientsJson: [{nameKey, keywords[], cl, optional}],
                 favorite, userCreated, createdAt
recipe_uses      id, userId, recipeId, at,
                 consumedJson: [{vmProductId?|customItemId?, cl}] -- hva som faktisk ble brukt
```

**Én rad i `cellar_items` = én fysisk flaske/emning.** Antall = antall rader.

## Funksjoner (v1)

### 1. Skann (home-aksjon)
- Knapp "Skann" åpner kamera. Dekoder EAN/UPC (BarcodeDetector/zxing).
- Slå opp: `GET /api/products/by-gtin?gtin=...` → backend: offisiell `my-products/v1/details?gtin=…`
  (fallback: vmpws `barCodeSearch`).
- Vis produktkort (bilde, navn, kategori, pris, alkohol, butikk-tilgjengelighet) →
  **["Legg i kjelleren", "Ta ut en flaske"]**.
  - "Ta ut" viser de matchinge flaskene i kjelleren (nyest eldst?) → velg hvilken som går ut.
- Ingen treff → tilbud om å legge inn som **custom item** (navn, type, alkohol, volum).
- Manuell inntast (produktkode/strekkode/søk) alltid tilgjengelig (knapp + søkefelt).

### 2. Min vinkjeller
- Liste av flasker (kort: bilde, navn, kategori, land, år, "på hyllen: X mnd", pris).
- Søk + felter: kategori (hvitvin/rødvin/øl/akvavit/…), land, distrikt, prisintervall.
- Sortering: nyest, lengst på hyllen, pris, navn, kategori.
- Dobbelttrykk/long-press på flaske → detaljside:
  - Alt fra `products_cache` (beskrivelse, druer %, sukker/syre, allergener, anbefalt mat,
    lagring, pris, "populær"-badge, "les mer hos Vinmonopolet" (eksternt lenke, åpenbart
    ikke-reklame)).
  - Historikk: inn/ut-datoer, runder den har vært brukt i.
  - Handlinger: "ta ut", "drikke opp", "gi bort", "fordervet", "lagre bilde".

### 3. Oppskrifter / Drikk
- Fane "Drikke": to grupper:
  - **Kan lage nå** — oppskrifter der alle (ikke-valgfrie) ingredienser finnes i kjelleren,
    rangert etter hvor mye man kan lage (antall runder).
  - **Mangler** — favoritter først; viser manglende ingredienser som chips med "søk i
    Vinmonopol" (lenke til søk hos dem).
- Oppskrift = navne + glass + ingredienser (cl per runde, keywords for matching, valgfrie).
- Matching: keyword-mot produktnavn + kategori (feks "gin" matcher produkter med "gin" i
  navnet eller category=gin). Én runde krever at hver ikke-valgfri ingredient matcher minst
  én flaske, og at cl-per-runde × antall runder ≤ tilgjengelig volum.
- "Lag en runde" → logges i `recipe_uses` (velger hvilke flasker som trekkes fra) →
  oppdaterer volum/estimat.
- Bruker kan lage egne oppskrifter (med egne ingredienser).
- **Seed-sett** (~25 oppskrifter) leveres i `src/data/recipes/` — G&T, negroni, spritz,
  espresso martini, sangria, gløgg, mule, martini, mojito, sour, old fashioned,
  long island, aquavit-rett m.fl. (nøyaktig liste ved implementering).

### 4. Estimert til tom
- Per flaske/produkt: resterende volum = (volumCl × antall flasker) − konsumert via runder.
- Rate = konsumert siste 30/90 dager / dager (per produkt og per type).
- Vis: "holder i ~X uker" / "går tomt i ~X dager" / "drikkes sjelden".
- Ingen data ennå → vis "—", oppfordre til å logge runder.

### 5. Innstillinger
- Språk (nb/nn/en/vi), butikk (fra `stores/v0`, GPS-forslag), navn.
- Eksport/import JSON (kjeller + oppskrifter).
- Om: kildestillinger, versjon.

## Språk (i18n)

- `src/i18n/{nb,nn,en,vi}.json` for alle UI-tekster.
- Produktdata vises på norsk (kilde), men feltnavn/kategorier oversettes der vi har oversettelser
  (kategorikart: `hvitvin`→"White wine" m.m.; ukjente vises rått).
- Oppskrifts- og ingrediensnavn oversettes via `nameKey`.
- Nynorsk: manuell oversettelse (AI-forslag + Harald checker). Vietnamesisk: AI-oversettelse.

## Design

- Designsystemet-tema via deres theme builder:
  - Accent: dyp borgund (feks `#6d1a36` / hover `#8a2444`), nøytralt mørke grå, hvit bakgrunn.
  - Lyse/duske modus (designsystemet-støtte).
- Typografi og komponenter uendret fra designsystemet (tilgjengelighet = gratis vinst).
- Logo: enkle wordmark "VinKjeller" (ingen Vinmonopol-ressurser).
- PWA-ikon: enkel flaske-silhuett i tema-fargene (tegnes ved implementering).

## API-bruk og caching (backend)

| Backend-endpoint | Kilde | Cache |
|---|---|---|
| `GET /api/products/by-gtin?gtin=` | `rich`: my-products v1 `details?gtin=` · `thin`: 404 (UI: manual/custom) | 24h |
| `GET /api/products/{id}` | `rich`: my-products v1 `details?productId=` · `thin`: products v0 `details-normal?productId=` | daglig (changedSince) |
| `GET /api/products/search?q=` | `rich`: my-products v1 `details?freeText=` · `thin`: products v0 `details-normal?productShortNameContains=` | 24h |
| `GET /api/stores` | stores v0 `details` | 7 dager |
| `GET /api/popular?ids=…` | products v0 `monthly-sales` (server-side daglig job) | daglig job |
| `POST /api/purge-vinmonopol` | sletter alle Vinmonopol-cache-tabeller (ToS: oppsigelse) | — |
| `GET/POST/PATCH/DELETE /api/me/…` | SQLite | — |
| Auth | email + passord (argon2), httpOnly cookie | — |

- Throttle-vern: rate-limiter per endpoint + globalt tak under 60/min per offisielt API.
- Alle utgående kall logger status; feil vises som "offline/degradert" i UI, aldri crash.

## Deploy (harsku.no)

- `docker-compose.yml`: `app` (backend + statisk frontend i én container, port 3001),
  named volume `vinkjeller-data` (SQLite).
- Caddy: `vinkjeller.harsku.no { reverse_proxy localhost:3001 }` (auto-HTTPS).
- Port 3000 er tatt av DnD-Scheduler → bruker **3001**.
- Backup: kopi av SQLite-fil (samme mønster som DnD-Scheduler).
- `.env` på serveren: `VINMONOPOLET_API_KEY` (fra `.env` her).

## Åpne spørsmål / risiko

1. **my-products v1 er ikke åpen for publikum** (B2B-kanal). Uten den: ingen offisiell
   strekkodeløsning, tynn produktdata (navn + id + popularitet). → *Harald: kontakt Vinmonopol
   via portalen og be om tilgang for personlig/ikke-kommerisiell integrasjon (eller finn annen
   strekkodekilde). Alt er bygd for å «lyse opp» automatisk når `PRODUCT_DATA_MODE=rich` slås på.*
2. Verifisert: barcode `075496331075` = **Angostura Orange Bitters** (5096703) — Harald bekrefter flasken.
3. Subdomene: `vinkjeller.harsku.no` OK?
4. Hotlinking av bilder (se vurdering over) — Harald godkjenner/avviser.
5. ToS lest 2026-08-27; samsvarstabell ovenfor. Re-evaluere ved endringer i ToS.
