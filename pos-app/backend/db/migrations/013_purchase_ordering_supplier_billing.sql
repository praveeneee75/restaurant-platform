-- Purchase Ordering & Supplier Billing
-- Runtime migrations add missing columns defensively; this script documents target tables.

CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  purchase_order_id INTEGER,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  reference_no TEXT,
  paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER,
  po_number TEXT,
  order_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'DRAFT',
  subtotal REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total_amount REAL DEFAULT 0,
  created_by INTEGER,
  notes TEXT,
  active INTEGER DEFAULT 1,
  received_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  line_total REAL DEFAULT 0,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);
