-- Staff Attendance, Shift Management & Cash Register
-- Restaurant-local SQLite tables for POS operations.

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  clock_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clock_out_at DATETIME,
  opening_note TEXT,
  closing_note TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_register_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_by INTEGER NOT NULL,
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opening_cash REAL NOT NULL DEFAULT 0,
  closed_by INTEGER,
  closed_at DATETIME,
  closing_cash REAL,
  expected_cash REAL,
  cash_difference REAL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  note TEXT
);

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  performed_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES cash_register_sessions(id)
);

INSERT OR IGNORE INTO system_config (key, value) VALUES
('require_clock_in_before_order', '0'),
('require_open_register_for_cash_payment', '1'),
('allow_cashier_register_close', '0'),
('cash_discrepancy_threshold', '0');
