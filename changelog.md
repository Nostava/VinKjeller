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
- **QR-kode for delt lenke** — i «Del»-dialogen vises QR-koden automatisk når lenken er generert (og 📷-knappen på hver aktiv lenke). Koden lages lokalt på telefonen (ingen API-kall) og peker rett på gjest-visningen — gjestene skanner med kameraet og får kjelleren rett opp, ingen installasjon.
### Removed
- **Priser og salgstall bort** — «Verdi»-summator, prisfilter/sortering, prislinja i flaske- og produktvindu, «⭐ Populær»-merket og «Salg siste 12 mnd» er fjernet fra alt UI (og prisfeltet fra egen-vare-formularet). Dataene ligger fortsatt i databasen — bare skjult, så de kan komme tilbake uten at noe tapes.
- **🎉 Partydeling** — «Del»-knappen i kjelleroversikten lager en gjest-lenke (f.eks. `v.harsku.no/j/abcd…`) som åpner kjelleren kun-lesende — gjestene trenger ikke konto. Velg navn (f.eks. «Fest lørdag»), utløper (2 timer / 1–3 dager / 1 uke / inntil revokert), kopier lenken, og revoker når som helst. Gjestene ser bare flaskene; ingen personlige data eller drikkelog forlater kjelleren.
- **Innstillinger flyttet til toppen** — ⚙️-knappen står nå i toppbaren (navnet ditt ligger der), så buntnavet får pusterom igjen (4 faner).
- **Delte kjellerer** — kjelleren er nå en egen ting som brukere kan være med i (eier/medlem). Velgeren «🍷 <kjeller> ▾» øverst i Kjeller-visningen bytter mellom kjellerene dine, lager nye, og (som eier) inviterer medlemmer med e-post/brukernavn, fjerner dem, endrer navn og sletter kjelleren. Eksisterende flasker flyttes automatisk til en ny «Hjemmekjeller» ved oppstart. Produktlag (produkter, lagrede strekkoder) er fortsatt universelt — det deles ikke, det er bare der for alle.
- **🍺 Hjemmebryg** — ny fane for bryggsaker: navn, type, alkohol %, OG/FG, IBU, bryggedato (med «X dager siden»), flaskevolum, karbonering, malt, humle, gær og merknad. Vises som kort i Bryg-visningen (og i kjelleren med 🍺-merke). Redigeres ved å trykke på kortet.
### Fixed
- **Overspill i vinkjeller-kort** — Designsystemet har ingen global `box-sizing`-reset, så `width:100% + padding`-elementer (bilde i kortet) ble 16 px bredere enn kortet, og hele kortet (bilde + «På hyllen …»-tag) stakk ut av rutenettet. Global `border-box`-reset lagt til.
- **Gamle PWA-bundle etter deploy** — service worker brukte `prompt`-modus, så datamaskiner kunne ligge med gammel JS (f.eks. 🍾-bilde i stedet for ekte produktbilde). Byttet til `autoUpdate`: nye bundle aktiveres automatisk ved neste besøk.
- **Feil «også offline»-tekst** — lagrede strekkoder slås opp i serverens DB (trenger altså server, men **ingen API-kall**). Teksten rettet i alle språk.
### Added
- **Manuelt utvalg av område ved etikettlesing** — etter opptak ser du bildet og kan **tegne en boks** (dra med finger/mus) rundt teksten, og OCR kjører bare på det området («Les dette området»). Kan også «Les hele bildet» som før. Gikk det feil, er det «📏 Prøv med boks» i feil-menyen. Boksen er normalisert mot opptaksbilde, så den fungerer uavhengig av skjermstørrelse.
- **Bilderkort for søketreff** — navnssøk (og etikettsøk) viser nå treffene som små kort med **bilde + navn** i stedet for kun tekstknapper. Skriver du inn et navn med flere treff (f.eks. «Angostura») får du velge mellom dem i stedet for at bare det første vises. Én treff åpnes fortsatt direkte. Bilde-URL-ene kommer med i søke-svaret (ingen ekstra API-kall).
- **Tydeligere læringsløp for ukjente strekkoder** — scannet du en strekkode appen ikke kjenner, får du nå to knapper rett i varslet: **«🏷️ Les etikett»** (åpner kameraet i etikettmodus, ruller kameraet inn i synsfeltet) og **«🔎 Søk etter navn»** (fokuserer søkefeltet). Finn produktet, og **«💾 Lagre strekkoden»** knytter den til flasken — så virker scann direkte fremover, også offline. «＋ Legg til egen vare» er fortsatt der som tredje alternativ. Kamera-vindu (sort boks) vises nå bare når kameraet faktisk er åpent, og OCR-kortet ruller inn i synsfeltet etter opptak.
- **To OCR-motorer for etikettskanning** — Tesseract (WASM) er standard; i tillegg er **TrOCR** (transformer-modell via `@huggingface/transformers`, ONNX q8, lastes fra HuggingFace-CDN én gang per nettleser, ~100 MB, cachet i nettleseren) tilgjengelig som **hybrid**: Tesseract finner tekstlinjene + posisjoner, de 3 tykkeste linjene (typisk merke-navn) kuttes ut av det opprinnelige fargede bildet, og TrOCR leser om hvert klipp. Mørk bakgrunn (hvitt skrift på farget etikett) inverteres automatisk — testet: q8 leste «OD120063566 British States» → «Orange Bitters» etter invertering. `auto` (standard) bruker hybrid når nettleseren har WebGPU, ellers ren Tesseract; feil i TrOCR (nedlasting/inferanse) faller alltid tilbake til Tesseract-resultatet. Velg motor i **Innstillinger → Etikettlesing**, eller trykk **«🔄 Prøv den andre motoren»** etter en skann som ikke traff.
- **«?»-hjelp i Skann** — knapp ved tittelen åpner dialog med steg-for-steg-forklaring av skanningsfløten (strekkode, etikett/OCR, produktnummer fra vinmonopolet.no-lenke, lagret strekkode) + merknad om hva som krever full Vinmonopol-tilgang.
- **Etikettskann (OCR)** — «🏷️ Les etikett» på Skann-siden: kamera → bilde → Tesseract OCR i nettleseren (WASM; kjører helt på enheten — ingen server, ingen ekstra API-kall) → teksten blir omsatt til søkeforespørsler (lengste mest-alphabetiske linjer først + forholdsvis kortere prefiks, f.eks. «CHABLIS SUPÉRIEUR 2022» → «chablis supérieur») → søk via `productShortNameContains` (virker i thin-modus) → treffliste med «Se hos Vinmonopolet ↗»-lenke per treff; trykk på treffet gir det vanlige produktkortet, som nå også har ↗-lenken. Ved ingen treff vises OCR-teksten + «Rediger søket» (fyller søkefeltet). **Fase 1 — kun identifisering**; lagring av strekkode↔produkt fra etikettskann kommer etter. OCR-modell (eng+nor) lastes fra CDN ved første bruk per side-last.
- **Flair** — CSS-animasjoner (ingen nye avhengigheter): side-bytte fade-up, kjellerkort rir inn med liten stagger, skann-resultatet «popper» inn, toast glir opp med litt fjær, knapp-trykk og hover-løft på kort, og tema-veksling kryssfaderer. Alt er låst bak `prefers-reduced-motion: no-preference`.
- **Søker i kjelleren** — utvidet fra fritekstsøk med strukturfiltre: kategori, land og prisintervall (fra–til), pluss «Nullstill filtrene». Alternativerne utledes fra det som faktisk er i kjelleren, så filtrene lyser opp etter hvert som produktdata tilkommer (thin-modus har ingen kategori/land/pris).
- **Lager i butikk** — «🏬 N stk hos <butikk>» på produktkortet i Skann og i flaske-detall i kjelleren, fra `online-stock` (my-products v1, 5 min-mellomslag server-side). Krever at du har valgt butikk i Innstillinger (nytt søkbart butikkvelger — 356 butikker fra stores v0). I `thin`-modus/uten my-products-abonnement viser det «Lager i butikk krever full Vinmonopol-tilgang» — og lyser opp automatisk i rich-modus.
- **Mange flasker på én gang** — antallsvelger (1–99) når du legger til et produkt fra Skann-siden eller «Legg til» i kjelleren (f.eks. 6ere). Én handling = N fysiske flasker, hver med sin «time on the shelf». `POST /api/me/cellar` godtar `qty`.
- **Skann-siden skjelner nå mellom «finnes ikke» og «strekkodesøk utilgjengelig»**: `GET /api/products/by-gtin/:gtin` returnerer `reason` (`bad_gtin` / `gtin_unavailable` / `not_found`). I `thin`-modus (ingen my-products v1) viser Skann-siden en tydelig melding om at strekkodesøk krever full Vinmonopol-tilgang — med peiling mot navnssøk/produktnummer — i stedet for å si at produktet finnes ikke. Kort kode (< 2 tegn) avvises med toast.
- **Lært strekkode-tilkobling** (`gtin_map`): når en strekkode er knyttet til et produkt (automatisk i rich-modus fra produktets barcode-liste, eller manuelt via den nye «💾 Lagre strekkoden»-knappen på skann-resultatet), fungerer scann av den flasken videre **uten API-kall — også i thin-modus**. Ny endpoint: `POST /api/products/remember-gtin`.
### Fixed
- **Tema lastet alltid lyst ved oppdatering** og først skiftet når Innstillinger ble åpnet — temaet (auto/lys/mørk) settes nå i en inline-skript i `index.html` før første paint. «Automatisk» fulgte heller ikke OS-temaet (attributtet ble slettet i stedet for satt til `auto`) — fikset.
- **Bottom bar «Drikk» → «Drinker»** (nb+nn) og stavemisten «Drik med ansvar» → «Drikk med ansvar» (nb).
- **Mørkmodus mørket bare knapper** — Designsystemets tema-fil (`@digdir/designsystemet-css/theme.css`, definerer fargene bak `--ds-color-neutral-*`-tokenene) ble aldri importert. Bakgrunn/tekst/kanter falt tilbake til nettleser-default (hvitt/svart), og bare accent-tokenene (knapper/lenker) fra vårt borgund-tema virket. Nå importeres tema-filen, og `data-color-scheme` (auto/lys/mørk i Innstillinger) styrer hele UI-et — inkludert `color-scheme: dark`, som gir mørk OS-krom til native dropdown-menus.
- **Skann la til ekstrastreker** (én i start, én i slutt) på strekkoder (f.eks. bitters: `075496331075` → `2075…54`), så produktet ikke ble funnet. `byGtin` normaliserer nå koden med **GTIN-styresiffer-validering**: ugyldig kode → prøver å klippe vekk ett siffer i starten og/eller slutten, og kun aksepterer hvis resultatet er et gyldig GTIN (8/12/13/14 siffer).
- `byGtin` kastet feil på kalde produkt-caches («Unknown named parameter 'cached'» fra et overflødig double-upsert) og svarte `gtin_unavailable` selv når strekkoden var lært — fikset.
- Eventuelt: søk hos Vinmonopol om tilgang til my-products v1 → `PRODUCT_DATA_MODE=rich` (strekkoder + full data).
