# VinKjeller — Deployment (harsku.no)

Same pattern as DnD-Scheduler: scp → docker compose → Caddy subdomain.
Port **3001** (3000 is taken by DnD-Scheduler).

## Domains

| Subdomain | Purpose |
|---|---|
| `vinkjeller.harsku.no` | App |
| `v.harsku.no` | Short alias (same app) |

Add both to DNS (A record → server IP) before the first Caddy reload.

## 1. Copy files to the server

From Windows (PowerShell):

```powershell
scp -r D:\Projects\VinKjeller\* user@www.harsku.no:~/vinkjeller/
```

(`node_modules`, `dist` and `.env` are excluded by your scp/ignore rules —
the Docker build reinstalls deps, and `.env` is created on the server below.
If in doubt, copy `.env` explicitly afterwards — it must NOT go to GitHub.)

## 2. Configure environment on the server

```bash
ssh user@www.harsku.no
cd ~/vinkjeller
cp .env.example .env
nano .env   # paste VINMONOPOLET_API_KEY
```

## 3. Start the container

```bash
cd ~/vinkjeller
docker compose up -d --build
```

## 4. Verify

```bash
docker compose ps
curl -s localhost:3001/api/health
# → {"ok":true,"mode":"thin","time":"..."}
```

## 5. Caddy (auto HTTPS)

Create `/etc/caddy/Caddyfile.d/vinkjeller`:

```
vinkjeller.harsku.no, v.harsku.no {
    reverse_proxy localhost:3001
}
```

Then:

```bash
sudo caddy reload
```

Open `https://vinkjeller.harsku.no` → register an account → install the PWA
from the browser menu (Add to home screen).

## Maintenance

```bash
cd ~/vinkjeller
docker compose logs -f          # logs
docker compose build --no-cache && docker compose up -d   # update
```

The SQLite DB is at `~/vinkjeller/data/vinkjeller.db` on the host
(bind-mounted). Back it up:

```bash
cp ~/vinkjeller/data/vinkjeller.db ~/backup/vinkjeller-$(date +%Y%m%d).db
```

## ToS reminders (Vinmonopol API, v01.09.2024)

- Only the **published** APIs are used (`products/v0`, `stores/v0`, and
  `my-products/v1` **if** access is granted). The unpublished `vmpws`
  site-API is **not** used.
- The app is a **personal** cellar tracker — no advertising, no store
  competition, no interference with purchases.
- `POST /api/purge-vinmonopol` (Settings → Data) deletes all cached
  Vinmonopol data if the agreement is ever terminated.
- Keep `*.yaml` (confidential API docs) and `.env` out of Git.
