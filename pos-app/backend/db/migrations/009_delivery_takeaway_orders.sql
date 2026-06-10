-- Delivery, takeaway and online order management lives in each restaurant SQLite DB.
ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0;

CREATE TABLE IF NOT EXISTS delivery_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  customer_id INTEGER,
  delivery_address TEXT,
  delivery_phone TEXT,
  delivery_partner_id INTEGER,
  delivery_fee REAL DEFAULT 0,
  delivery_status TEXT DEFAULT 'RECEIVED',
  expected_delivery_time DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (delivery_partner_id) REFERENCES delivery_partners(id)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  entity_type TEXT DEFAULT 'ORDER',
  note TEXT,
  changed_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
