-- Multi-Device Waiter Ordering & Local Network Sync
-- Runtime migrations add orders.updated_at defensively through the Node schema helper.

CREATE TABLE IF NOT EXISTS order_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  table_id INTEGER,
  locked_by_user_id INTEGER NOT NULL,
  locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  UNIQUE(table_id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (table_id) REFERENCES tables(id),
  FOREIGN KEY (locked_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS device_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_name TEXT,
  ip_address TEXT,
  login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  active INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
