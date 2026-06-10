-- Cloud Reporting Sync keeps a retry queue and status locally in each restaurant DB.
CREATE TABLE IF NOT EXISTS cloud_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  synced_at DATETIME
);

CREATE TABLE IF NOT EXISTS cloud_sync_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id TEXT NOT NULL UNIQUE,
  last_successful_sync_at DATETIME,
  last_attempt_at DATETIME,
  status TEXT,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_queue_status ON cloud_sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_cloud_sync_queue_entity ON cloud_sync_queue(entity_type, entity_id);

INSERT INTO system_config (key, value, updated_at)
VALUES
  ('cloud_sync_enabled', '1', CURRENT_TIMESTAMP),
  ('cloud_sync_token', '', CURRENT_TIMESTAMP),
  ('cloud_sync_last_7_days_at', '', CURRENT_TIMESTAMP),
  ('last_cloud_sync_at', '', CURRENT_TIMESTAMP),
  ('last_cloud_sync_status', '', CURRENT_TIMESTAMP),
  ('last_cloud_sync_message', '', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;
