-- Inventory Management migration.
-- Applies per restaurant SQLite database.

CREATE TABLE IF NOT EXISTS inventory_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock REAL DEFAULT 0,
  low_stock_level REAL DEFAULT 0,
  cost_per_unit REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER,
  order_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'DRAFT',
  total_amount REAL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES inventory_suppliers(id)
);

CREATE TABLE IF NOT EXISTS inventory_purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  FOREIGN KEY (purchase_order_id) REFERENCES inventory_purchase_orders(id),
  FOREIGN KEY (ingredient_id) REFERENCES inventory_ingredients(id)
);

CREATE TABLE IF NOT EXISTS inventory_stock_movements (
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

CREATE TABLE IF NOT EXISTS inventory_recipes (
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
