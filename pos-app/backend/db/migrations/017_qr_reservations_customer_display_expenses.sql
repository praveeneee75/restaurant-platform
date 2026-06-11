-- QR ordering, reservations, customer display and expense category support.
ALTER TABLE orders ADD COLUMN order_source TEXT DEFAULT 'POS';
ALTER TABLE expenses ADD COLUMN category_id INTEGER;

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT,
  table_id INTEGER,
  guest_count INTEGER DEFAULT 1,
  reservation_time DATETIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'BOOKED',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  FOREIGN KEY (table_id) REFERENCES tables(id)
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservations_table_time ON reservations(table_id, reservation_time, status);

INSERT OR IGNORE INTO expense_categories (name) VALUES
  ('Rent'),
  ('Salary'),
  ('Electricity'),
  ('Gas'),
  ('Internet'),
  ('Other');
