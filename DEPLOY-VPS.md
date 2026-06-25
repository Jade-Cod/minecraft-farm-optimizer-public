# Deploying MCLabs Tools to a VPS

A complete guide for running MCLabs Tools publicly on a VPS with HTTPS via Caddy and Discord OAuth login.

---

## Prerequisites

- A VPS (Ubuntu 22.04+ or Debian 12+) with a public IP
- A domain (or subdomain) with an A record pointing to that IP
- Docker + Docker Compose v2 installed on the VPS
- A Discord application (see step 3)

---

## 1 — Clone the repo

```bash
git clone https://github.com/your-username/minecraft-farm-optimizer.git
cd minecraft-farm-optimizer
```

---

## 2 — Register a Discord OAuth2 application

1. Go to <https://discord.com/developers/applications> and create a new application.
2. In **OAuth2 → Redirects**, add:
   ```
   https://yourdomain.com/auth/discord/callback
   ```
3. Note down the **Client ID** and **Client Secret**.
4. Required scopes: `identify` only.

---

## 3 — Configure secrets

```bash
cp .env.example .env
```

Edit `.env` and fill in every blank value:

| Variable | Value |
|---|---|
| `DISCORD_CLIENT_ID` | From Discord developer portal |
| `DISCORD_CLIENT_SECRET` | From Discord developer portal |
| `DISCORD_REDIRECT_URI` | `https://yourdomain.com/auth/discord/callback` |
| `JWT_SECRET` | Run: `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | `https://yourdomain.com` |
| `APP_URL` | `https://yourdomain.com` |

Also create `deploy/.env`:

```bash
echo "APP_DOMAIN=yourdomain.com" > deploy/.env
```

---

## 4 — First deploy

```bash
bash scripts/vps-deploy.sh
```

Caddy will automatically obtain a Let's Encrypt TLS certificate on first startup (requires port 80/443 to be open).

---

## 5 — Verify

- `https://yourdomain.com` loads the app
- `https://yourdomain.com/auth/me` returns `{"guest":true}` (without a cookie)
- Clicking "Login with Discord" completes the OAuth round-trip and shows your username in the header

---

## 6 — Subsequent deploys

```bash
bash scripts/vps-deploy.sh
```

The script backs up the SQLite database, pulls the latest code, and rebuilds containers in place. Alembic migrations run automatically on container startup.

---

## 7 — Nightly database backup (optional)

Add this to root's crontab (`crontab -e`):

```
0 3 * * * bash /path/to/repo/scripts/backup-db.sh >> /var/log/mclabs-backup.log 2>&1
```

---

## Private ops repo (recommended)

Keep production secrets in a **private** `minecraft-farm-optimizer-deploy` repo that contains:
- `docker-compose.yml` (the Caddy compose file)
- `Caddyfile`
- `.env` with real secrets

Reference the public repo as the build context from there. This way the public repo never holds secrets or domain names.
