-- Backup, restore and OneDrive local-folder sync configuration.
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO system_config (key, value) VALUES ('backup_enabled', '0');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('backup_folder_path', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('onedrive_folder_path', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('backup_interval_minutes', '60');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_backup_at', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_sync_at', '');

CREATE TABLE IF NOT EXISTS backup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  file_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
