-- Production hardening migration.
-- Runtime migrationRunner applies this idempotently and takes a local backup before pending migrations.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  performed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- SQLite cannot add IF NOT EXISTS columns directly; migrationRunner uses schema.js for idempotent column adds.
