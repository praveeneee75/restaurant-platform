// Central schema upgrade helpers keep every restaurant SQLite database aligned.
const { seedDefaultPermissions } = require('./permissions');

function columnExists(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function addColumn(db, tableName, columnSql) {
  const columnName = columnSql.trim().split(/\s+/)[0];
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  }
}

const DEFAULT_SYSTEM_SETTINGS = {
  restaurant_display_name: 'Restaurant POS',
  legal_name: '',
  gstin: '',
  fssai_license_no: '',
  state_code: '33',
  sac_code: '996331',
  address_line_1: '',
  address_line_2: '',
  city: '',
  state: '',
  country: 'India',
  phone: '',
  email: '',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  logo_path: '',
  default_order_type: 'DINE_IN',
  allow_non_invoice_orders: '1',
  allow_discount: '1',
  allow_manual_price_override: '0',
  allow_refund: '1',
  allow_order_cancel: '1',
  require_manager_pin_for_discount: '0',
  require_manager_pin_for_refund: '1',
  require_manager_pin_for_void: '1',
  invoice_prefix: 'INV',
  invoice_reset_frequency: 'DAILY',
  show_tax_on_bill: '1',
  tax_name: 'GST',
  tax_rate: '5',
  show_qr_on_bill: '0',
  bill_print_contact: '1',
  bill_print_kot_references: '1',
  bill_print_customer: '1',
  bill_print_payment: '1',
  bill_print_authorised_signatory: '1',
  bill_footer_text: 'THANK YOU. VISIT AGAIN.',
  bill_template: 'BORDERED',
  bill_left_margin_dots: '0',
  bill_trailing_feed_lines: '0',
  bill_cut_mode: 'NONE',
  bill_print_width_58: '32',
  bill_print_width_80: '48',
  bill_font_type: 'FONT_A',
  bill_font_size: 'NORMAL',
  bill_line_spacing_dots: '24',
  bill_details_layout: 'TWO_COLUMN',
  bill_header_font_type: 'FONT_A', bill_header_font_size: 'NORMAL', bill_header_alignment: 'CENTER', bill_header_bold: '1',
  bill_title_font_type: 'FONT_A', bill_title_font_size: 'NORMAL', bill_title_alignment: 'CENTER', bill_title_bold: '1',
  bill_details_font_type: 'FONT_A', bill_details_font_size: 'NORMAL', bill_details_alignment: 'LEFT', bill_details_bold: '0',
  bill_items_font_type: 'FONT_A', bill_items_font_size: 'NORMAL', bill_items_alignment: 'LEFT', bill_items_bold: '0',
  bill_totals_font_type: 'FONT_A', bill_totals_font_size: 'NORMAL', bill_totals_alignment: 'LEFT', bill_totals_bold: '1',
  bill_footer_font_type: 'FONT_A', bill_footer_font_size: 'NORMAL', bill_footer_alignment: 'CENTER', bill_footer_bold: '0',
  qr_require_table_pin: '1',
  qr_session_minutes: '30',
  qr_ordering_enabled: '1',
  qr_pending_order_limit: '25',
  upi_id: '',
  service_charge_enabled: '0',
  service_charge_percent: '0',
  round_off_enabled: '1',
  auto_print_kot: '1',
  print_kot_on_save: '0',
  print_kot_on_submit: '1',
  allow_kot_reprint: '1',
  kot_header_text: '',
  kot_footer_text: '',
  kot_template: 'CLASSIC',
  kot_print_table: '1',
  kot_print_customer: '0',
  kot_print_kitchen: '0',
  kot_compact_spacing: '1',
  kot_left_margin_dots: '0',
  kot_trailing_feed_lines: '0',
  kot_cut_mode: 'NONE',
  kot_print_width_58: '32',
  kot_print_width_80: '48',
  kot_font_type: 'FONT_A',
  kot_font_size: 'NORMAL',
  kot_line_spacing_dots: '24',
  kot_header_font_type: 'FONT_A', kot_header_font_size: 'NORMAL', kot_header_alignment: 'CENTER', kot_header_bold: '0',
  kot_title_font_type: 'FONT_A', kot_title_font_size: 'LARGE', kot_title_alignment: 'CENTER', kot_title_bold: '1',
  kot_details_font_type: 'FONT_A', kot_details_font_size: 'NORMAL', kot_details_alignment: 'CENTER', kot_details_bold: '0',
  kot_items_font_type: 'FONT_A', kot_items_font_size: 'NORMAL', kot_items_alignment: 'LEFT', kot_items_bold: '0',
  kot_footer_font_type: 'FONT_A', kot_footer_font_size: 'NORMAL', kot_footer_alignment: 'CENTER', kot_footer_bold: '0',
  backup_enabled: '0',
  backup_folder_path: '',
  onedrive_folder_path: '',
  backup_interval_minutes: '60',
  last_backup_at: '',
  last_sync_at: '',
  require_clock_in_before_order: '0',
  require_open_register_for_cash_payment: '1',
  allow_cashier_register_close: '0',
  cash_discrepancy_threshold: '0',
  cloud_sync_enabled: '1',
  cloud_sync_token: '',
  cloud_sync_last_7_days_at: '',
  last_cloud_sync_at: '',
  last_cloud_sync_status: '',
  last_cloud_sync_message: '',
  mobile_app_enabled: '0',
  enabled_modules: '',
  license_package_code: '',
  license_package_name: '',
  update_latest_version: '',
  update_minimum_version: '',
  update_mandatory: '0',
  online_order_enabled: '0',
  online_storefront_slug: '',
  online_theme: 'CLASSIC',
  online_primary_color: '#1f7a4d',
  online_accent_color: '#f5b44b',
  online_logo_path: '',
  online_payment_methods: 'UPI,CARD,COD,WALLET,NETBANKING',
  online_require_otp: '1',
  online_allow_loyalty_credit: '1',
  online_default_image_mode: 'AI',
  online_delivery_enabled: '1',
  online_takeaway_enabled: '1',
  online_min_order_amount: '0',
  fraud_large_discount_threshold: '500',
  fraud_refund_count_threshold: '5',
  fraud_void_count_threshold: '5',
  fraud_cash_mismatch_threshold: '100',
  retention_customer_days: '365'
};

function seedDefaultSettings(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  addColumn(db, 'system_config', 'updated_at DATETIME');
  const insert = db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO NOTHING
  `);
  Object.entries(DEFAULT_SYSTEM_SETTINGS).forEach(([key, value]) => insert.run(key, value));
  if (!db.prepare("SELECT 1 FROM system_config WHERE key = 'thermal_width_defaults_v2'").get()) {
    db.prepare("UPDATE system_config SET value = '32', updated_at = CURRENT_TIMESTAMP WHERE key IN ('bill_print_width_58', 'kot_print_width_58') AND value = '28'").run();
    db.prepare("UPDATE system_config SET value = '48', updated_at = CURRENT_TIMESTAMP WHERE key IN ('bill_print_width_80', 'kot_print_width_80') AND value = '38'").run();
    insert.run('thermal_width_defaults_v2', '1');
  }
}

function ensureRestaurantSchema(db) {
  // Phase 2: restaurant tables are managed per restaurant database.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumn(db, 'tables', 'active INTEGER DEFAULT 1');
  addColumn(db, 'tables', 'qr_session_pin TEXT');
  addColumn(db, 'tables', 'qr_session_expires_at DATETIME');
  addColumn(db, 'tables', 'qr_pin_failed_attempts INTEGER DEFAULT 0');
  addColumn(db, 'tables', 'qr_pin_locked_until DATETIME');

  // Phase 2: seed common table names once for newly upgraded restaurants.
  const tableCount = db.prepare('SELECT COUNT(*) AS count FROM tables').get().count;
  if (tableCount === 0) {
    const insertTable = db.prepare("INSERT INTO tables (table_name, status) VALUES (?, 'AVAILABLE')");
    ['Table 1', 'Table 2', 'Table 3', 'Parcel', 'Delivery'].forEach((name) => insertTable.run(name));
  }

  // Phase 4-6: orders, KOTs, invoices, payments and print jobs need stable columns.
  addColumn(db, 'orders', 'table_id INTEGER');
  addColumn(db, 'orders', "order_type TEXT DEFAULT 'DINE_IN'");
  addColumn(db, 'orders', "table_no TEXT");
  addColumn(db, 'orders', 'total_amount REAL DEFAULT 0');
  addColumn(db, 'orders', 'tax_amount REAL DEFAULT 0');
  addColumn(db, 'orders', 'service_charge_amount REAL DEFAULT 0');
  addColumn(db, 'orders', 'paid_amount REAL DEFAULT 0');
  addColumn(db, 'orders', "payment_status TEXT DEFAULT 'UNPAID'");
  addColumn(db, 'orders', "invoice_no TEXT");
  addColumn(db, 'orders', 'is_invoice INTEGER DEFAULT 1');
  addColumn(db, 'orders', "cancelled_at DATETIME");
  addColumn(db, 'orders', "settled_at DATETIME");
  addColumn(db, 'orders', 'customer_id INTEGER');
  addColumn(db, 'orders', 'redeemed_points INTEGER DEFAULT 0');
  addColumn(db, 'orders', 'loyalty_discount REAL DEFAULT 0');
  addColumn(db, 'orders', 'delivery_fee REAL DEFAULT 0');
  addColumn(db, 'orders', 'updated_at DATETIME');
  addColumn(db, 'orders', "order_source TEXT DEFAULT 'POS'");
  addColumn(db, 'orders', 'order_sequence INTEGER');
  addColumn(db, 'orders', 'customer_ref TEXT');
  addColumn(db, 'orders', 'order_reference TEXT');
  addColumn(db, 'orders', 'billing_ready INTEGER DEFAULT 0');

  addColumn(db, 'order_items', 'price REAL DEFAULT 0');
  addColumn(db, 'order_items', "status TEXT DEFAULT 'PLACED'");
  addColumn(db, 'order_items', 'kot_id INTEGER');
  addColumn(db, 'order_items', 'combo_id INTEGER');
  addColumn(db, 'order_items', 'combo_name TEXT');
  addColumn(db, 'order_items', 'combo_quantity INTEGER');
  addColumn(db, 'order_items', 'started_at DATETIME');
  addColumn(db, 'order_items', 'ready_at DATETIME');
  addColumn(db, 'order_items', 'served_at DATETIME');
  addColumn(db, 'order_items', 'notes TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS kots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      kitchen_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      value_type TEXT NOT NULL,
      applied_by TEXT,
      promo_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumn(db, 'kots', 'suborder_no INTEGER');

  addColumn(db, 'audit_logs', 'actor_user_id INTEGER');
  addColumn(db, 'audit_logs', 'actor_role TEXT');
  addColumn(db, 'audit_logs', 'details TEXT');
  addColumn(db, 'audit_logs', 'old_value TEXT');
  addColumn(db, 'audit_logs', 'new_value TEXT');
  addColumn(db, 'audit_logs', 'performed_by TEXT');
  addColumn(db, 'audit_logs', 'restaurant_id TEXT');
  addColumn(db, 'audit_logs', 'user_id INTEGER');
  addColumn(db, 'audit_logs', 'user_role TEXT');
  addColumn(db, 'audit_logs', 'ip_address TEXT');
  addColumn(db, 'discounts', 'promo_code TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'INFO',
      message TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Phase 8: bcrypt hashes are stored beside legacy PINs so old users can migrate on login.
  addColumn(db, 'users', 'pin_hash TEXT');
  addColumn(db, 'users', 'updated_at DATETIME');
  addColumn(db, 'users', 'failed_login_attempts INTEGER DEFAULT 0');
  addColumn(db, 'users', 'locked_until DATETIME');
  addColumn(db, 'users', 'lock_reason TEXT');
  addColumn(db, 'users', 'unlock_requested_at DATETIME');
  addColumn(db, 'users', 'last_login_at DATETIME');
  addColumn(db, 'users', 'last_failed_login_at DATETIME');

  // Admin CRUD needs soft activity flags and kitchen printer routing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'KITCHEN',
      connection TEXT NOT NULL DEFAULT 'USB',
      address TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      kitchen_id INTEGER,
      printer_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      attempts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS printer_security (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      invoice_reprint_pin_hash TEXT,
      updated_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoice_reprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      invoice_no TEXT NOT NULL,
      reprint_number INTEGER NOT NULL,
      printed_by INTEGER,
      printed_by_name TEXT,
      printed_by_role TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(order_id, reprint_number)
    );
  `);
  db.prepare('INSERT OR IGNORE INTO printer_security (id) VALUES (1)').run();
  addColumn(db, 'printers', "type TEXT DEFAULT 'KITCHEN'");
  addColumn(db, 'printers', "connection TEXT DEFAULT 'USB'");
  addColumn(db, 'printers', 'address TEXT');
  addColumn(db, 'printers', 'paper_width_mm INTEGER DEFAULT 58');
  addColumn(db, 'printers', 'active INTEGER DEFAULT 1');
  addColumn(db, 'printers', 'deleted_at DATETIME');
  addColumn(db, 'printers', 'created_at DATETIME');
  addColumn(db, 'printers', 'updated_at DATETIME');
  addColumn(db, 'print_jobs', 'last_error TEXT');
  addColumn(db, 'print_jobs', 'updated_at DATETIME');
  addColumn(db, 'kitchens', 'active INTEGER DEFAULT 1');
  addColumn(db, 'kitchens', 'deleted_at DATETIME');
  addColumn(db, 'kitchens', 'printer_id INTEGER');
  const legacyKitchenPrinters = db.prepare(`
    SELECT id, printer_name
    FROM kitchens
    WHERE printer_id IS NULL
      AND printer_name IS NOT NULL
      AND TRIM(printer_name) != ''
  `).all();
  legacyKitchenPrinters.forEach((kitchen) => {
    const existingPrinter = db.prepare('SELECT id FROM printers WHERE LOWER(name) = LOWER(?) LIMIT 1').get(kitchen.printer_name);
    const printerId = existingPrinter?.id || db.prepare(`
      INSERT INTO printers (name, type, connection, active)
      VALUES (?, 'KITCHEN', 'WINDOWS', 1)
    `).run(kitchen.printer_name).lastInsertRowid;
    db.prepare('UPDATE kitchens SET printer_id = ? WHERE id = ?').run(printerId, kitchen.id);
  });
  addColumn(db, 'categories', 'active INTEGER DEFAULT 1');
  addColumn(db, 'categories', 'deleted_at DATETIME');
  addColumn(db, 'items', 'active INTEGER DEFAULT 1');
  addColumn(db, 'items', 'deleted_at DATETIME');
  addColumn(db, 'items', 'image_url TEXT');
  addColumn(db, 'items', 'online_description TEXT');
  addColumn(db, 'items', 'online_enabled INTEGER DEFAULT 1');
  addColumn(db, 'items', 'allow_dine_in INTEGER DEFAULT 1');
  addColumn(db, 'items', 'allow_parcel INTEGER DEFAULT 1');
  addColumn(db, 'items', 'allow_party_order INTEGER DEFAULT 1');

  // Phase 6: split payments use the same payments ledger with card/UPI metadata.
  addColumn(db, 'payments', 'reference_no TEXT');
  addColumn(db, 'payments', 'cash_register_session_id INTEGER');

  // Staff attendance and cash register sessions are local operational controls for each restaurant.
  db.exec(`
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
  `);

  // Customer CRM and loyalty use customer_id while leaving older member loyalty columns in place.
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS loyalty_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER,
      customer_id INTEGER,
      order_id INTEGER,
      points INTEGER NOT NULL,
      type TEXT NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      value REAL DEFAULT 0,
      value_type TEXT DEFAULT 'RUPEES',
      discount_value REAL DEFAULT 0,
      discount_type TEXT DEFAULT 'RUPEES',
      min_order_amount REAL DEFAULT 0,
      valid_from DATE,
      valid_to DATE,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS online_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT DEFAULT 'LOGIN',
      expires_at DATETIME NOT NULL,
      verified_at DATETIME,
      attempts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS online_payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS online_customer_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      credit_type TEXT NOT NULL DEFAULT 'RUPEES',
      amount REAL DEFAULT 0,
      percent REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      note TEXT,
      active INTEGER DEFAULT 1,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS delivery_partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      provider_code TEXT,
      integration_type TEXT DEFAULT 'MANUAL',
      api_base_url TEXT,
      merchant_id TEXT,
      external_store_id TEXT,
      integration_enabled INTEGER DEFAULT 0,
      last_sync_at DATETIME,
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
      external_order_id TEXT,
      tracking_url TEXT,
      partner_status TEXT,
      last_partner_status_at DATETIME,
      partner_payload TEXT,
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
  `);

  addColumn(db, 'loyalty_points', 'customer_id INTEGER');
  addColumn(db, 'loyalty_points', 'note TEXT');
  addColumn(db, 'delivery_partners', 'provider_code TEXT');
  addColumn(db, 'delivery_partners', "integration_type TEXT DEFAULT 'MANUAL'");
  addColumn(db, 'delivery_partners', 'api_base_url TEXT');
  addColumn(db, 'delivery_partners', 'merchant_id TEXT');
  addColumn(db, 'delivery_partners', 'external_store_id TEXT');
  addColumn(db, 'delivery_partners', 'integration_enabled INTEGER DEFAULT 0');
  addColumn(db, 'delivery_partners', 'last_sync_at DATETIME');
  addColumn(db, 'delivery_orders', 'external_order_id TEXT');
  addColumn(db, 'delivery_orders', 'tracking_url TEXT');
  addColumn(db, 'delivery_orders', 'partner_status TEXT');
  addColumn(db, 'delivery_orders', 'last_partner_status_at DATETIME');
  addColumn(db, 'delivery_orders', 'partner_payload TEXT');
  addColumn(db, 'promo_codes', 'discount_value REAL DEFAULT 0');
  addColumn(db, 'promo_codes', "discount_type TEXT DEFAULT 'RUPEES'");
  addColumn(db, 'promo_codes', 'min_order_amount REAL DEFAULT 0');
  addColumn(db, 'promo_codes', 'max_discount_amount REAL DEFAULT 0');
  addColumn(db, 'promo_codes', 'valid_from DATE');
  addColumn(db, 'promo_codes', 'valid_to DATE');
  const settingsCount = db.prepare("SELECT COUNT(*) AS count FROM settings WHERE key IN ('loyalty_earn_amount', 'loyalty_point_value')").get().count;
  if (settingsCount < 2) {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_earn_amount', '100')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('loyalty_point_value', '1')").run();
  }
  const insertOnlinePayment = db.prepare(`
    INSERT INTO online_payment_methods (code, label, active, sort_order)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(code) DO NOTHING
  `);
  [
    ['UPI', 'UPI / QR', 1],
    ['CARD', 'Credit / Debit Card', 2],
    ['COD', 'Pay at Counter / Cash on Delivery', 3],
    ['WALLET', 'Wallet', 4],
    ['NETBANKING', 'Net Banking', 5]
  ].forEach((method) => insertOnlinePayment.run(...method));

  // Backup settings and logs are local to the POS restaurant database so offline stores can manage backups.
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      file_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS update_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      current_version TEXT,
      target_version TEXT,
      status TEXT NOT NULL,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS saas_online_order_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      saas_order_id TEXT NOT NULL UNIQUE,
      saas_order_no TEXT,
      local_order_id INTEGER,
      status TEXT NOT NULL DEFAULT 'IMPORTED',
      payload TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY (local_order_id) REFERENCES orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cloud_sync_queue_status ON cloud_sync_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_cloud_sync_queue_entity ON cloud_sync_queue(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_saas_online_order_imports_local ON saas_online_order_imports(local_order_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_filters ON audit_logs(action, entity_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_compliance_events_type_date ON compliance_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_compliance_events_severity_date ON compliance_events(severity, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_device_sessions_active_seen ON device_sessions(active, last_seen_at DESC);

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

    CREATE TABLE IF NOT EXISTS electronic_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_type TEXT NOT NULL,
      order_id INTEGER,
      invoice_no TEXT,
      kot_id INTEGER,
      amount REAL DEFAULT 0,
      snapshot TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_electronic_journal_invoice ON electronic_journal(invoice_no, created_at);
    CREATE INDEX IF NOT EXISTS idx_electronic_journal_order ON electronic_journal(order_id, created_at);

    CREATE TABLE IF NOT EXISTS fraud_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'MEDIUM',
      entity_type TEXT,
      entity_id INTEGER,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_credit_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL UNIQUE,
      credit_limit REAL NOT NULL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_account_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      order_id INTEGER,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (credit_account_id) REFERENCES customer_credit_accounts(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS payment_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_code TEXT NOT NULL,
      order_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'PENDING',
      provider_reference TEXT,
      request_payload TEXT,
      response_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS retention_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL UNIQUE,
      retention_days INTEGER NOT NULL DEFAULT 365,
      anonymize_after_days INTEGER,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  addColumn(db, 'notification_logs', 'resolved_at DATETIME');
  ['Rent', 'Salary', 'Electricity', 'Gas', 'Internet', 'Other'].forEach((name) => {
    db.prepare('INSERT OR IGNORE INTO expense_categories (name) VALUES (?)').run(name);
  });
  db.prepare("INSERT OR IGNORE INTO payment_providers (code, name) VALUES ('STRIPE', 'Stripe')").run();
  db.prepare("INSERT OR IGNORE INTO payment_providers (code, name) VALUES ('RAZORPAY', 'Razorpay')").run();
  [
    ['ORDER_CONFIRMATION', 'SMS', 'Order confirmation', 'Your order {{orderId}} is confirmed.'],
    ['RESERVATION_REMINDER', 'SMS', 'Reservation reminder', 'Reminder for reservation {{reservationId}}.'],
    ['SUBSCRIPTION_EXPIRY', 'EMAIL', 'Subscription expiry', 'Your subscription expires on {{expiresAt}}.']
  ].forEach((template) => {
    db.prepare('INSERT OR IGNORE INTO notification_templates (event_type, channel, subject, body) VALUES (?, ?, ?, ?)').run(...template);
  });
  db.prepare("INSERT OR IGNORE INTO retention_settings (entity_type, retention_days, anonymize_after_days) VALUES ('CUSTOMERS', 365, 365)").run();
  addColumn(db, 'expenses', 'category_id INTEGER');
  addColumn(db, 'system_config', 'updated_at DATETIME');
  seedDefaultSettings(db);
  seedDefaultPermissions(db);

  // Inventory module: restaurant-level suppliers, ingredients, purchasing, stock movements and recipes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      gstin TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      current_stock REAL DEFAULT 0,
      low_stock_alert REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      purchase_order_id INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL UNIQUE,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (menu_item_id) REFERENCES items(id)
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
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

    CREATE TABLE IF NOT EXISTS order_inventory_deductions (
      order_id INTEGER PRIMARY KEY,
      deducted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS modifier_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      min_select INTEGER DEFAULT 0,
      max_select INTEGER DEFAULT 1,
      required INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS modifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price_delta REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES modifier_groups(id)
    );

    CREATE TABLE IF NOT EXISTS item_modifier_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_id, group_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (group_id) REFERENCES modifier_groups(id)
    );

    CREATE TABLE IF NOT EXISTS combos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS combo_items (
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

    CREATE TABLE IF NOT EXISTS order_item_modifiers (
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
  `);
  addColumn(db, 'suppliers', 'gstin TEXT');
  addColumn(db, 'stock_movements', 'purchase_order_id INTEGER');
  addColumn(db, 'purchase_orders', 'po_number TEXT');
  addColumn(db, 'purchase_orders', 'subtotal REAL DEFAULT 0');
  addColumn(db, 'purchase_orders', 'tax_amount REAL DEFAULT 0');
  addColumn(db, 'purchase_orders', 'created_by INTEGER');
  addColumn(db, 'purchase_orders', 'received_at DATETIME');
  addColumn(db, 'purchase_order_items', 'unit_price REAL DEFAULT 0');
  addColumn(db, 'purchase_order_items', 'tax_rate REAL DEFAULT 0');
  addColumn(db, 'purchase_order_items', 'line_total REAL DEFAULT 0');
}

module.exports = { ensureRestaurantSchema, seedDefaultSettings, DEFAULT_SYSTEM_SETTINGS };
