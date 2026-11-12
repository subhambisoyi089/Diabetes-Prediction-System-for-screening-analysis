# Cloud Deployment Guide — Diabetes Risk Check

This guide covers deploying the Diabetes Risk Check application to production cloud platforms so patients, clinicians, and researchers can access it from anywhere on any device.

---

## 1. Deploy to Render (Recommended · Free Tier)

Render provides free hosting with automatic HTTPS and Git-based continuous deployment.

### Steps:
1. Fork or push this repository to your GitHub/GitLab account.
2. Sign up at [render.com](https://render.com).
3. Click **New +** → **Blueprint**.
4. Connect your repository. Render will automatically detect [`render.yaml`](./render.yaml).
5. Click **Apply**.
6. Render will:
   - Install dependencies from `requirements.txt`.
   - Run model training on the diverse clinical dataset.
   - Start the production server with `gunicorn`.
   - Provision a persistent disk for the SQLite database.

---

## 2. Deploy to Railway

Railway provides zero-config deployments with instant SSL.

### Steps:
1. Install the Railway CLI or use the web dashboard at [railway.app](https://railway.app).
2. Connect your GitHub repository.
3. Railway automatically detects [`railway.json`](./railway.json) and [`Procfile`](./Procfile).
4. In **Variables**, add:
   - `SECRET_KEY`: Set to any long random string (e.g. `openssl rand -hex 32`).
   - `COOKIE_SECURE`: `1`
5. Click **Deploy**. Your app will be live at `https://<your-app>.up.railway.app`.

---

## 3. Deploy to Fly.io

Fly.io runs applications close to your users on lightweight microVMs with persistent NVMe volumes.

### Steps:
1. Install flyctl: `curl -L https://fly.io/install.sh | sh` (or `winget install flyctl` on Windows).
2. Authenticate: `fly auth login`
3. Launch: `fly launch` (it will read [`fly.toml`](./fly.toml)).
4. Create the persistent volume for SQLite:
   ```bash
   fly volumes create diabetes_data --size 1
   ```
5. Set secret key:
   ```bash
   fly secrets set SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
   ```
6. Deploy: `fly deploy`

---

## 4. Self-Hosted / VPS with Docker Compose

For deploying on AWS EC2, DigitalOcean Droplets, Linode, or any Linux server:

```bash
# Clone the repository
git clone <your-repo-url>
cd diabetes-risk-app

# Copy environment template
cp .env.example .env

# Generate a secure secret key
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(32))" >> .env
echo "COOKIE_SECURE=1" >> .env

# Build and start in background
docker compose up -d --build
```

The app will be available at `http://your-server-ip:8000` (or behind your Nginx/Caddy reverse proxy with HTTPS).

---

## Production Security Checklist
- [x] Set a unique, strong `SECRET_KEY`.
- [x] Set `COOKIE_SECURE=1` when served behind HTTPS.
- [x] Ensure `FLASK_DEBUG=0` in production.
- [x] Attach a persistent volume for the SQLite database so user accounts and assessment history persist across reboots.
