# SaaS Cloud Deployment

The SaaS backend is the cloud API used by local restaurant POS machines for license validation and SaaS admin.

## Required Environment Variables

```text
PORT=4000
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com

DB_HOST=your-postgres-host
DB_PORT=5432
DB_NAME=restaurant_saas
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_SSL=true

JWT_SECRET=long-random-secret
```

Optional first-admin migration variables:

```text
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=temporary-strong-password
ADMIN_ROLE=OWNER
```

Remove or rotate `ADMIN_PASSWORD` after the first admin is created.

## Commands

Install:

```bash
npm install
```

Migrate:

```bash
npm run migrate
```

Start:

```bash
npm start
```

Health check:

```text
https://your-saas-api-domain.com/health
```

## DigitalOcean Droplet

The repository includes a Docker Compose deployment in `deploy/` for a
single-server pilot:

- PostgreSQL is only available on the private Docker network.
- SaaS is only available through Caddy.
- Caddy provisions and renews HTTPS certificates automatically.
- Installer files are mounted read-only from `deploy/installers/`.

Create `deploy/.env` from `deploy/.env.example`, replace every placeholder,
then run:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml build
docker compose --env-file deploy/.env -f deploy/compose.yml run --rm saas npm run migrate
docker compose --env-file deploy/.env -f deploy/compose.yml up -d
```

After the first administrator has been created, remove `ADMIN_PASSWORD` from
`deploy/.env` and recreate the SaaS container.

Install the daily database backup for the deployment user:

```bash
(crontab -l 2>/dev/null; echo '30 20 * * * /opt/kmaster/deploy/backup.sh >> /var/backups/kmaster/backup.log 2>&1') | crontab -
```

DigitalOcean Droplet backups do not replace PostgreSQL backups. Periodically
copy encrypted database backups to storage outside the Droplet and test a
restore.

## Render

1. Create a PostgreSQL database in Render.
2. Create a Web Service from the repository.
3. Root directory: `saas-backend`.
4. Build command: `npm install && npm run migrate`.
5. Start command: `npm start`.
6. Add all required environment variables.
7. Set `CORS_ORIGIN` to the SaaS admin domain.
8. Verify `/health`.

## Railway

1. Create a Railway project.
2. Add PostgreSQL.
3. Add a service for `saas-backend`.
4. Set install/build command to `npm install`.
5. Run migration once with `npm run migrate`.
6. Start command: `npm start`.
7. Add all required environment variables from Railway PostgreSQL.
8. Verify `/health`.

## DigitalOcean App Platform

1. Create a Managed PostgreSQL database.
2. Create an App from the repository.
3. Source directory: `saas-backend`.
4. Build command: `npm install && npm run migrate`.
5. Run command: `npm start`.
6. Add required environment variables.
7. Use the app URL as `SAAS_URL` in POS `.env`.
8. Verify `/health`.

## Azure App Service

1. Create Azure Database for PostgreSQL.
2. Create an App Service for Node.js.
3. Deploy the `saas-backend` folder.
4. App settings: add all required environment variables.
5. Startup command: `npm start`.
6. Run migration from deployment console:

```bash
npm run migrate
```

7. Verify `/health`.

## Production Verification

Confirm:

- `/login.html` loads.
- `/admin.html` loads after login.
- `POST /auth/login` works.
- `POST /tenants/create` works.
- `GET /tenants/list` works.
- `POST /tenants/update-license` works.
- `POST /license/validate` works from POS using cloud `SAAS_URL`.

## Notes

- PostgreSQL SSL is enabled automatically when `NODE_ENV=production`.
- Use `DB_SSL=false` only for local production-mode testing against a local PostgreSQL server that does not support SSL.
- `JWT_SECRET`, `DB_PASSWORD`, `DB_HOST`, `DB_USER`, and `DB_NAME` are required in production.
- Production responses avoid exposing stack traces.
- Do not upload POS restaurant SQLite databases to the SaaS backend.
