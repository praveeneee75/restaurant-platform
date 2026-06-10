-- Customer CRM and customer-based loyalty ledger.

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  birthday DATE,
  address TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_active ON customers(phone) WHERE active = 1 AND phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  order_id INTEGER,
  visit_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  amount REAL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS customer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  active INTEGER DEFAULT 1,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE orders ADD COLUMN customer_id INTEGER;
ALTER TABLE orders ADD COLUMN redeemed_points INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN loyalty_discount REAL DEFAULT 0;
ALTER TABLE loyalty_points ADD COLUMN customer_id INTEGER;
ALTER TABLE loyalty_points ADD COLUMN note TEXT;

INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_earn_amount', '100');
INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_point_value', '1');
