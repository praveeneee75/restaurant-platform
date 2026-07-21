-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Database metadata
CREATE TABLE db_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO db_meta (key, value) VALUES
('schema_version', '1.0'),
('created_at', datetime('now'));

-- Users table (basic for now)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  pin TEXT NOT NULL,
  pin_hash TEXT,
  role TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  updated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- KITCHENS
-- =========================
CREATE TABLE kitchens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  printer_name TEXT,
  active INTEGER DEFAULT 1,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- =========================
-- CATEGORIES
-- =========================
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kitchen_id INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
);

-- =========================
-- ITEMS
-- =========================
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  price REAL NOT NULL,
  is_veg INTEGER DEFAULT 1,
  allow_dine_in INTEGER DEFAULT 1,
  allow_parcel INTEGER DEFAULT 1,
  allow_party_order INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- =========================
-- TABLES
-- =========================
CREATE TABLE tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- ORDERS
-- =========================
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_type TEXT NOT NULL,
  table_id INTEGER,
  table_no TEXT,
  status TEXT NOT NULL,
  total_amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  payment_status TEXT DEFAULT 'UNPAID',
  created_by INTEGER,
  cancelled_at DATETIME,
  settled_at DATETIME,
  customer_id INTEGER,
  redeemed_points INTEGER DEFAULT 0,
  loyalty_discount REAL DEFAULT 0,
  delivery_fee REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- ORDER ITEMS
-- =========================
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  kitchen_id INTEGER NOT NULL,
  price REAL DEFAULT 0,
  status TEXT DEFAULT 'PLACED',
  kot_id INTEGER,
  combo_id INTEGER,
  combo_name TEXT,
  combo_quantity INTEGER,
  started_at DATETIME,
  ready_at DATETIME,
  served_at DATETIME,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
);

-- =========================
-- KOTS
-- =========================
CREATE TABLE kots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kitchen_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
);

-- =========================
-- PAYMENTS
-- =========================
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  payment_mode TEXT NOT NULL,
  amount REAL NOT NULL,
  owner_id INTEGER,
  reference_no TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- =========================
-- DISCOUNTS
-- =========================
CREATE TABLE discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  value_type TEXT NOT NULL,
  applied_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- =========================
-- PROMO CODES
-- =========================
CREATE TABLE promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  value REAL NOT NULL,
  value_type TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- REFUNDS
-- =========================

CREATE TABLE refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  payment_id INTEGER,
  refund_mode TEXT NOT NULL, -- CASH | UPI | OWNER_FUND
  amount REAL NOT NULL,
  reason TEXT,
  refunded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

-- =========================
-- NON INVOICE
-- =========================


ALTER TABLE orders ADD COLUMN is_invoice INTEGER DEFAULT 1;
ALTER TABLE orders ADD COLUMN invoice_no TEXT;

-- =========================
-- EXPENSES
-- =======================


CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_type TEXT NOT NULL,   -- WAGES | RAW_MATERIAL | ELECTRICITY | OTHER
  description TEXT,
  amount REAL NOT NULL,
  expense_date DATE NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- =========================
-- PRINTERS
-- =======================

CREATE TABLE printers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,        -- KITCHEN | BILL
  connection TEXT NOT NULL,  -- USB | NETWORK
  address TEXT,              -- IP or USB path
  active INTEGER DEFAULT 1,
  deleted_at DATETIME
);

ALTER TABLE kitchens ADD COLUMN printer_id INTEGER;

-- =========================
-- PRINT JOBS
-- =======================


CREATE TABLE print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,       -- KOT | BILL
  ref_id INTEGER NOT NULL,  -- order_id
  kitchen_id INTEGER,
  printer_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING | PRINTED | FAILED
  attempts INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE print_jobs ADD COLUMN last_error TEXT;
ALTER TABLE print_jobs ADD COLUMN updated_at DATETIME;

-- =========================
-- MEMBERS
-- =======================


CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  tier TEXT DEFAULT 'REGULAR', -- REGULAR | SILVER | GOLD
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- LOYALTY
-- =======================


CREATE TABLE loyalty_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER,
  customer_id INTEGER,
  order_id INTEGER,
  points INTEGER NOT NULL,
  type TEXT NOT NULL, -- EARN | REDEEM | ADJUSTMENT
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  birthday DATE,
  address TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_customers_phone_active ON customers(phone) WHERE active = 1 AND phone IS NOT NULL;

CREATE TABLE customer_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  order_id INTEGER,
  visit_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  amount REAL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE customer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  active INTEGER DEFAULT 1,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE delivery_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE delivery_orders (
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

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  entity_type TEXT DEFAULT 'ORDER',
  note TEXT,
  changed_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_earn_amount', '100');
INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_point_value', '1');

CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO system_config (key, value) VALUES ('backup_enabled', '0');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('backup_folder_path', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('onedrive_folder_path', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('backup_interval_minutes', '60');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_backup_at', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_sync_at', '');

CREATE TABLE backup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  file_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- AUDIT LOGS
-- =========================
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  performed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- INVENTORY MANAGEMENT
-- =========================
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock REAL DEFAULT 0,
  low_stock_alert REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (menu_item_id) REFERENCES items(id)
);

CREATE TABLE recipe_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recipe_id, ingredient_id),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id),
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER,
  order_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'DRAFT',
  total_amount REAL DEFAULT 0,
  notes TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

CREATE TABLE order_inventory_deductions (
  order_id INTEGER PRIMARY KEY,
  deducted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);

CREATE TABLE modifier_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  min_select INTEGER DEFAULT 0,
  max_select INTEGER DEFAULT 1,
  required INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_delta REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES modifier_groups(id)
);

CREATE TABLE item_modifier_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(item_id, group_id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (group_id) REFERENCES modifier_groups(id)
);

CREATE TABLE combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE combo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  quantity INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(combo_id, item_id),
  FOREIGN KEY (combo_id) REFERENCES combos(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE order_item_modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL,
  modifier_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_delta REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  FOREIGN KEY (modifier_id) REFERENCES modifiers(id),
  FOREIGN KEY (group_id) REFERENCES modifier_groups(id)
);

CREATE TABLE inventory_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock REAL DEFAULT 0,
  low_stock_level REAL DEFAULT 0,
  cost_per_unit REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER,
  order_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'DRAFT',
  total_amount REAL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES inventory_suppliers(id)
);

CREATE TABLE inventory_purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  FOREIGN KEY (purchase_order_id) REFERENCES inventory_purchase_orders(id),
  FOREIGN KEY (ingredient_id) REFERENCES inventory_ingredients(id)
);

CREATE TABLE inventory_stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  reference_type TEXT,
  reference_id INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingredient_id) REFERENCES inventory_ingredients(id)
);

CREATE TABLE inventory_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity_per_item REAL NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(menu_item_id, ingredient_id),
  FOREIGN KEY (menu_item_id) REFERENCES items(id),
  FOREIGN KEY (ingredient_id) REFERENCES inventory_ingredients(id)
);

CREATE TRIGGER IF NOT EXISTS inventory_sales_stock_out_on_paid
AFTER UPDATE OF payment_status ON orders
WHEN NEW.payment_status = 'PAID' AND OLD.payment_status != 'PAID'
BEGIN
  INSERT INTO inventory_stock_movements (ingredient_id, movement_type, quantity, reference_type, reference_id, notes)
  SELECT r.ingredient_id, 'SALE_OUT', SUM(oi.quantity * r.quantity_per_item), 'ORDER', NEW.id, 'Auto deduction from sale'
  FROM order_items oi
  JOIN inventory_recipes r ON r.menu_item_id = oi.item_id AND r.active = 1
  WHERE oi.order_id = NEW.id
  GROUP BY r.ingredient_id;

  UPDATE inventory_ingredients
  SET current_stock = current_stock - COALESCE((
    SELECT SUM(oi.quantity * r.quantity_per_item)
    FROM order_items oi
    JOIN inventory_recipes r ON r.menu_item_id = oi.item_id AND r.active = 1
    WHERE oi.order_id = NEW.id AND r.ingredient_id = inventory_ingredients.id
  ), 0)
  WHERE id IN (
    SELECT r.ingredient_id
    FROM order_items oi
    JOIN inventory_recipes r ON r.menu_item_id = oi.item_id AND r.active = 1
    WHERE oi.order_id = NEW.id
  );
END;

CREATE TRIGGER IF NOT EXISTS inventory_sales_stock_out_on_paid_insert
AFTER INSERT ON order_items
WHEN (SELECT payment_status FROM orders WHERE id = NEW.order_id) = 'PAID'
BEGIN
  INSERT INTO inventory_stock_movements (ingredient_id, movement_type, quantity, reference_type, reference_id, notes)
  SELECT r.ingredient_id, 'SALE_OUT', NEW.quantity * r.quantity_per_item, 'ORDER', NEW.order_id, 'Auto deduction from paid order item'
  FROM inventory_recipes r
  WHERE r.menu_item_id = NEW.item_id AND r.active = 1
  GROUP BY r.ingredient_id;

  UPDATE inventory_ingredients
  SET current_stock = current_stock - COALESCE((
    SELECT NEW.quantity * r.quantity_per_item
    FROM inventory_recipes r
    WHERE r.menu_item_id = NEW.item_id AND r.active = 1 AND r.ingredient_id = inventory_ingredients.id
  ), 0)
  WHERE id IN (
    SELECT r.ingredient_id
    FROM inventory_recipes r
    WHERE r.menu_item_id = NEW.item_id AND r.active = 1
  );
END;


CREATE TABLE license_status (
  restaurant_id TEXT PRIMARY KEY,
  license_key TEXT,
  last_checked DATETIME,
  expires_at DATETIME,
  status TEXT
);

CREATE TABLE IF NOT EXISTS license_status (
    restaurant_id TEXT PRIMARY KEY,
    license_key TEXT,
    last_checked DATETIME,
    expires_at DATETIME,
    status TEXT
  );


