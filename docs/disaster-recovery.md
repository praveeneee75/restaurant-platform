# Disaster Recovery

The POS remains offline-first and stores each restaurant database locally under `pos-app/data`.

## Local Checks

- Use `GET /disaster/check?restaurantId=RESTOXXXX` to run SQLite integrity checks.
- If integrity fails, the endpoint enables the local `emergency_read_only_mode` setting.

## Restore Latest Backup

Use `POST /disaster/restore-latest-backup` with:

```json
{
  "restaurantId": "RESTOXXXX",
  "actor": { "role": "OWNER", "name": "Owner" }
}
```

Rules:

- Only `OWNER` and `MANAGER_2` may restore.
- The existing backup service creates a safety backup before replacement.
- Restore is logged in backup logs and audit logs.
- POS restart may be required after restore.

## Operator Notes

- Close DB Browser before restoring. SQLite can reject file replacement when another tool holds the database open.
- Keep OneDrive sync folder configured but treat it as a copy target, not the live database location.
- Test restore on a non-production restaurant database before using it in service hours.
