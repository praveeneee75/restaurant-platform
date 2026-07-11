# Environment Separation

Local and production configuration are intentionally separate.

## Rules

- Local secrets live only in `pos-app/.env`, `saas-backend/.env`, or a developer-managed file outside Git.
- Production secrets live only in `/opt/kmaster/deploy/.env` on the production server.
- `.env.example` files contain placeholders only and are safe to commit.
- Production deployments must never copy a local `.env` file to the server.
- The production SaaS process runs with `NODE_ENV=production` and refuses missing, placeholder, localhost, or loopback configuration.
- Packaged desktop POS uses `https://api.kmasterpos.com` unless `KMASTER_SAAS_URL` is explicitly supplied for development.

## Preflight

Before a production restart, validate the server environment from the server:

```bash
cd /opt/kmaster
docker compose --env-file deploy/.env -f deploy/compose.yml run --rm saas node /app/scripts/validate-deployment-env.js production --process
docker compose --env-file deploy/.env -f deploy/compose.yml config
```

The application performs the same fail-closed validation at startup. If validation fails, Docker will not receive a healthy SaaS container and Caddy will not route traffic to it.

## Deployment boundary

Only source files, Docker configuration, and explicitly named release artifacts are copied during deployment. Never use a recursive copy of the whole workspace. Installer publishing copies only files matching the installer extensions from `pos-app/dist-installers`.

After deployment, verify `/health`, the active release version, and the white-label license endpoint before asking users to update.
