# VinKjeller — Idéer

Idealogg. Nye idéer lander her først, så flyttes de til `docs/spec.md` (om de tas med)
eller holdes som "parkerte" til senere.

## Fra brainstorm-snakken (2026-08-27, Harald + venn)

- [ ] **Skann for å legge til / ta ut** — strekkodescanning som i Vinmonopol-appen. Én skann = en handling: legg inn en flaske i kjelleren, eller ta ut en.
- [ ] **Min vinkjeller** — fane med oversikt over alle vinene/flaskene man har.
- [ ] **Samme inndeling og info som Vinmonopol-appen** — kategori, land, distrikt, pris, alkohol, bilde, beskrivelse osv. (Data fra offisielle API-ene — se `docs/api-research.md`.)
- [ ] **Ikke stjele logo/merke** fra Vinmonopolet — bare produktdata, tekst og bilder. Skal være åpenbart at det ikke er reklame; kjøp gjøres hos Vinmonopolet.
- [ ] **Oppskrifter / drinker** — se hvilke drinker man kan lage med det som er på lageret.
- [ ] **Manglende ingredienser** — se oppskrifter og hva man evt. mangler.
- [ ] **Favoritter** — liste med favorittoppskrifter, vis manglende ingredienser.
- [ ] **"Estimert til tom"** — estimere når en flaske/inngrediens blir tom, basert på hvor mange runder man har laget (feks G&T).
- [x] **Én oppføring per fysisk flaske** (bestemt) — "time on the shelf" skal være interessant å se.
- [x] **Egne produkter** (bestemt) — for hjemmegrunt brygg, importert whisky osv. Kan vokse til å støtte homebrew-bjør.
- [x] **4 språk** (bestemt) — bokmål, nynorsk, engelsk, vietnamesisk.
- [x] **Populær-i-Norge-indikator** (bestemt) — bruke offisielt salgs-API (månedsforsalg) til "populær"-badges.
- [x] **Designsystemet.no** (bestedt) — komponenter + egen theme (borgund/mørk).

## ToS-krevd (2026-08-27, fra analysen av API Terms v01.09.2024)

- [ ] **Purge Vinmonopol-data** — innstillingsknapp som sletter alle cache-tabeller (ToS: ved oppsigelse skal alle kopier ødelegges). Holder brukerens egne data.
- [x] **Kun publiserte API-er** — vmpws forkastet (forbudt). Se `docs/spec.md` → ToS-samsvar.
- [x] **Rate-limit-vern** server-side (60/min, 4000/dag).
- [ ] **Kryptering** — HTTPS ✅ (Caddy). Disk-kryptering på serveren for SQLite-fila (LUKS/dedikeret volume) — sjekk oppsettet på harsku.no.
- [ ] **Meld Vinmonopol** om personlig/ikke-kommerisiell integrasjon + be om my-products v1-tilgang (portal-kontakt).

## Ny idé (2026-08-27)

- [ ] **Lagringstid / modning** — "lagres" (storagePotential) fra produktdata; vis "klare til å drikke nå" vs. "kan forbedres ved lagring".
- [ ] **Lager i butikk** — koble mot `stock-per-store`/`online-stock` API: "mangler du en flaske, sjekk lager i din butikk" (krev butikkvalg, data fra `stores/v0`).
- [ ] **Foredlingstips fra data** — anbefalt mat (recommendedFood), druekomposisjoner, sødme/tannin-nivåer fra produktdata på detaljsiden.
- [ ] **Fotos av egne flasker** — last opp eget bilde for custom items (homebrew med eget label?).
- [ ] **Månedlig oppsummering** — "du har drukket X, kjelleren er verdt Y kr (prisdata)", total verdi av kjelleren.
- [ ] **Del kjelleren** — vennelisten (vietnamesisk venn?) kan få se en delt kjeller / felles "party-panett" av hva som er tilgjengelig.
- [ ] **QR-koder på egne flasker** — generer QR per homebrew-batch som kan skannes for å legge inn i kjelleren.
- [ ] **Kalender** — minnelermer: "kjøpt for 6 måneder siden, anbefalt å åpne nå", "bursdager → sangria?".
- [ ] **Statistikk** — forbruk per type (hvitvin vs. rødvin), land du drikker mest fra, pris per runde for favorittdrinkene.
- [ ] **Mange flasker på én gang** — skann én gang, velg antall (feks 6ere).
- [ ] **Søker i kjelleren** — fulltekstsøk + felter (kategori, land, distrikt, druer, prisintervall, år).
- [ ] **Eksport/import** — JSON/CSV av kjelleren (backup, flytting mellom enheter).
- [ ] **Strekkodekilde B** — hvis my-products v1 ikke kommer: vurdere å spørre Vinmonopol direkte om personlig tilgang, ellers: custom items + manual søk som hovedvei (scanning «lyser opp» automatisk når rich-modus blir tilgjengelig).
- [ ] **Avvisnings-/anbefalingsspill** — "hvilken flaske skal du åpne i kveld?" (tilfeldig fra kjelleren, evt. vektet mot anledningen).
- [ ] **Offline-first** — PWA skal fungere uten nett (kjellerdata lokalt, synk når online).

## Parkert (interessant, men ikke v1)

- (tomt ennå)
