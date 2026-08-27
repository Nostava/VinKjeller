# Vinmonopol API — research notes

Alt vi vet om datakildene. Testet 2026-08-27 med Haralds nøkkel (i `.env`, IKKE committe).

> ⚠️ **ToS (v01.09.2024) — lest og analysert 2026-08-27:**
> - **Ikke bruk uoffisielle/publikerte API-er** («using unpublished APIs» er eksplisitt forbudt) → **vmpws er satt ut av bruk** (se seksjon 4, kun historisk referanse).
> - Data skal lagres og serveres med **sterk kryptering** (HTTPS ✅ via Caddy; DB: se spec).
> - **Ikke kopier/konkurrer** med deres tjeneste, **ikke inngrep i kjøpsprosess**, ingen e-post til Vinmonopolet via API-data → vi er personlig kjeller-app, ingen salg/kjøp. ✅
> - **Rate limits** skal ikke overskrides → innebygd throttle. ✅
> - Ved oppsigelse: **ødelegge alle kopier** av dokumentasjon + data → «purge»-funksjon (se spec).
> - YAML-filene er **konfidensiell dokumentasjon** → `.gitignore`, aldri i GitHub.
> - Lisensen dekker personlig/internt bruk av de offisielle API-ene. my-products v1 er B2B-kanalen (grossist) — **ikke åpen for publikum**.

## 1. Offisielt: `products` v0

- Base: `https://apis.vinmonopolet.no/products/v0`
- Auth: header `Ocp-Apim-Subscription-Key: <nøkkel>` (eller query `subscription-key=...`)
- **Throttling: maks 60 kall/min, maks 4000 kall/dag.**
- YAML: `products.yaml`

| Endpoint | Beskrivelse |
|---|---|
| `GET /details-normal` | 65 865 produkter, men **bare** `productId` + `productShortName` + `lastChanged`. Params: `productId`, `vendorId`, `manufacturerId`, `wholesalerId`, `changedSince` (yyyy-MM-dd), `productShortNameContains`, `maxResults`, `start`. |
| `GET /monthly-sales` | Landsdeksende månedsforsalg per produkt (liter + antall). Params: `fromsalesmonth`/`tosalesmonth` (yyyy-MM), `changedSince`, `maxResults`, `start`. Headers: `x-total-count`, `link`. → "populær i Norge"-badge. |
| `GET /halfyear-sales` | Halvårsforsalg per butikk. |
| `GET /monthly-sales-per-store` | **AVSTÅTT etter 2024-10-09** — ikke bruk. |

Masterdata oppdateres daglig ~05:45 CET.

## 2. Offisielt: `my-products` v1 ⭐ (krever eget abonnement!)

- Base: `https://apis.vinmonopolet.no/my-products/v1`
- YAML: `my-products-v1.yaml`
- ⚠️ Haralds nøkkel gir **401** her — må abonnere på API-produktet i portalen (https://api.vinmonopolet.no/products). `stores` virker derimot med samme nøkkel.

Dette er det riktige API-et for produktdata:

| Endpoint | Beskrivelse |
|---|---|
| `GET /details` | **Full masterdata per produkt.** Params: `productId`, `gtin` (strekkode!), `freeText` (fulltekst i JSON, `*` = wildcard, `_` = mellomrom), `changedSince`, `changedSinceTimestamp`, `productShortNameContains`, `maxResults`, `start`. |
| `GET /details-normal` / `GET /details-special` | Underutgaver av /details (normalutvalget / spesialutvalget). |
| `GET /price-elements` / `-normal` / `-special` | Prisopplysninger. |
| `GET /stock-per-store` | Daglig lager per butikk (oppdateres ~06:45 CET). Params: `productId`, `storeId`, `includeZeroStock`, `changedSince` … |
| `GET /online-stock` | **Realtids-lager** for ett produkt i én butikk (`productId` + `storeId` kreves). |
| `GET /daily-sales-per-store` | Daglig salg (fra ~07:45 CET). |
| `GET /regions`, `/grapes`, `/cork`, `/use`, `/hierarchy`, `/prodgrp`, `/orderpack`, `/volume`, `/ecolabel`, `/storage`, `/package`, `/assortmentlist`, `/assortmentgrades`, `/status` | Kodelister (distrikter, druer, kork, anbefalt mat, hierarki …). |
| `PUT /updates`, `PUT /vendor-stock` | For leverandører — ikke relevant for oss. |

### `/details` — responsstruktur (per produkt)

```
basic:        productId, productShortName, productLongName, volume, alcoholContent,
              vintage, ageLimit, packagingMaterial, volumType, corkType,
              bottlePerSalesUnit, introductionDate, productStatusSale…
logistics:    wholesalerId/Name, vendorId/Name, manufacturerId/Name,
              barcodes: [{ gtin, isMainGtin, unitOfMeasure, packageQuantity }],
              orderPack, minimumOrderQuantity, packagingWeight
origins:      origin: {country, region, subRegion}, production: {country, region},
              localQualityClassif
properties:   ecoLabelling, storagePotential, organic, biodynamic, ethicallyCertified,
              vintageControlled, sweetWine, freeOrLowOnGluten, kosher,
              locallyProduced, noAddedSulphur, environmentallySmart,
              productionMethodStorage
classification: mainProductType, subProductType, productType, productGroup (id + name)
ingredients:  grapes: [{grapeId, grapeDesc, grapePct}], ingredients, sugar, acid, allergens
description:  characteristics: {colour, odour, taste}, freshness, fullness, bitterness,
              sweetness, tannins, recommendedFood: [{foodId, foodDesc}]
assortment:   assortment (feks "Grunnutvalget"), validFrom, listedFrom, assortmentGrades
prices:       [{priceValidFrom, salesPrice, salesPricePrLiter, bottleReturnValue, vatAmountIncluded}]
```

**Viktig:** inneholder **GTIN-strekkoder** → vi kan skanne og slå opp `?gtin=<strekkode>` direkte,
og bygge lokal bar-code-indeks.

## 3. Offisielt: `stores` v0

- Base: `https://apis.vinmonopolet.no/stores/v0` — ✅ virker med Haralds nøkkel.
- YAML: `stores.yaml`
- `GET /details` — alle butikker: navn, status, adresse, **gpsCoord**, telefon, epost, kategori, profil, sortiment, **åpningstider** (vanlige + unntak). Params: `storeId`, `storeNameContains`, `changedSince`.

## 4. UOFFISIELLT: nettsteds-API (`vmpws`) — 🔴 IKKE BRUKES (forbudt av ToS)

> **Endret 2026-08-27 etter ToS-analyse:** «using unpublished APIs» er eksplisitt forbudt.
> vmpws er nettsidens interne API og er ikke publisert i API-portalen → **brukes ikke i koden**.
> Seksjonen beholdes kun som dokumentasjon av hva som finnes (og avbildingsmønsteret, se under).

- Base: `https://www.vinmonopolet.no/vmpws/...` — **offentlig, ingen nøkkel**, men det er
  nettsidens interne API (kan endres uten varsel).
- Fant ved å lese nettsidens JS-bundle (`/_ui/js/*.js`).

| Endpoint | Beskrivelse | Testet |
|---|---|---|
| `GET /v2/vmp/products/barCodeSearch/{ean}` | Strekkode → produkt (fullt produkt-DTO). Tolererer 12- og 13-sifrede koder. 404: "Produkt med denne strekkoden finnes ikke i Vinmonopolets sortiment." | ✅ (5096703 fra `075496331075`) |
| `GET /v3/vmp/products/{code}` | Fullt produkt (navn, kategori, land, distrikt, pris, volume, bilder, assortment, grossist). `description`/`summary` kan være tomme. | ✅ |
| `GET /v2/vmp/products/search?query=` | Frittekstsøk, paginert (24/side), med `alcohol` (ABV) i produktene. | ✅ |
| `GET /v2/vmp/products/productGuide?query=` | Kategori-browsing med facets (varegruppe m.m.) — "same inndeling" som deres app. | ✅ |
| `GET /v2/vmp/products/{code}/similar` | Liknende produkter. | funnet |
| `GET /v2/vmp/products/{code}/stock` | Lager. | funnet |
| `GET /v3/vmp/products/{code}/availability` | Tilgjengelighet (post/butikk). | funnet |
| `GET /v3/vmp/products/suggestions?query=` | Autocomplete (krever trolig andre params; gav 400 på `query=vin`). | ❌ |

*(alle rader over: kun referanse — ikke i koden)*

### Bildemønster (stabilit, fra både vmpws og nettsidens JSON-LD)

```
https://bilder.vinmonopolet.no/cache/{STORRELSE}/{produktkode}-1.jpg
STORRELSE: 96x96-0 (thumbnail) | 300x300-0 (product) | 515x515-0 (zoom) | 1200x1200-0 (superZoom) | 65x65-0 (cartIcon)
```
Bildet kan derfor konstrueres uten API-kall gitt produktkode.

## 5. Praktiske notater

- **Cloudflare**: `api(s).vinmonopolet.no` er bak Cloudflare; aggressive raskt etterfølgende kall kan gi
  tomme svar (HTTP/2 stream-feil i curl). Hold tempo lavt (vi har tross alt 60/min-taket).
- **Curl-bug på denne maskinen**: `curl -o <fil>` mot vinmonopolet-hostene feiler (exit 43);
  `curl -sv` til stdout eller Python `urllib` virker. Bruk Python for testing.
- **Charset**: API-svaret er UTF-8, men terminalen her viser `å/ø/å` som `?` — ikke noe feil i dataene.
- **Test-eksempel**: barcode `075496331075` → produkt `5096703` (Harald skal verifisere flasken).
- **Juridisk**: vi bruker offisielle API-er der vi har abonnement, vmpws kun som supplement for
  bilder/søk, med kildestilling («Data: Vinmonopolet»), ingen logo/merkevare, ingen reklame,
  kjøp hos Vinmonopolet.
