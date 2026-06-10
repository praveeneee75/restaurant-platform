-- Phase 1-8 POS migration.
-- Run per restaurant database; backend/services/schema.js applies the same upgrade idempotently.

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kitchen_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN updated_at DATETIME;
ALTER TABLE orders ADD COLUMN table_id INTEGER;
ALTER TABLE orders ADD COLUMN tax_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN cancelled_at DATETIME;
ALTER TABLE orders ADD COLUMN settled_at DATETIME;
ALTER TABLE order_items ADD COLUMN price REAL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN kot_id INTEGER;
