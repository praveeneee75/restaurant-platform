const bcrypt = require('bcrypt');

const WHITELABEL_RESTAURANT_ID = 'RESTOWHITELABEL';
const WHITELABEL_LICENSE_KEY = 'WLTEST-2026-KMASTER';

const DEMO_MODULES = [
  'INVENTORY',
  'KDS',
  'LOYALTY',
  'QR_ORDERING',
  'RESERVATIONS',
  'CLOUD_REPORTING',
  'MULTI_BRANCH',
  'WHITE_LABEL',
  'ONLINE_ORDERING'
];

function isWhitelabelDemo(restaurantId, licenseKey = '') {
  return String(restaurantId || '').trim().toUpperCase() === WHITELABEL_RESTAURANT_ID
    || String(licenseKey || '').trim().toUpperCase() === WHITELABEL_LICENSE_KEY;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function columns(db, tableName) {
  if (!tableExists(db, tableName)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function insertRow(db, tableName, row, { orIgnore = true } = {}) {
  const allowed = columns(db, tableName);
  const entries = Object.entries(row).filter(([key]) => allowed.has(key));
  if (!entries.length) return null;
  const names = entries.map(([key]) => key);
  const values = entries.map(([, value]) => value);
  const placeholders = names.map(() => '?').join(', ');
  const sql = `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${tableName} (${names.join(', ')}) VALUES (${placeholders})`;
  return db.prepare(sql).run(...values);
}

function upsertSystemConfig(db, settings, overwrite = true) {
  if (!tableExists(db, 'system_config')) return;
  const cols = columns(db, 'system_config');
  const hasUpdatedAt = cols.has('updated_at');
  const sql = hasUpdatedAt && overwrite
    ? `INSERT INTO system_config (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    : hasUpdatedAt
      ? `INSERT INTO system_config (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO NOTHING`
      : overwrite
        ? `INSERT INTO system_config (key, value)
           VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        : `INSERT INTO system_config (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO NOTHING`;
  const statement = db.prepare(sql);
  Object.entries(settings).forEach(([key, value]) => statement.run(key, String(value ?? '')));
}

function getByName(db, tableName, name) {
  if (!tableExists(db, tableName)) return null;
  return db.prepare(`SELECT id FROM ${tableName} WHERE LOWER(name) = LOWER(?) LIMIT 1`).get(name);
}

function getByColumn(db, tableName, columnName, value) {
  if (!tableExists(db, tableName)) return null;
  return db.prepare(`SELECT id FROM ${tableName} WHERE LOWER(${columnName}) = LOWER(?) LIMIT 1`).get(value);
}

function ensureRowByColumn(db, tableName, columnName, value, row) {
  const existing = getByColumn(db, tableName, columnName, value);
  if (existing) return existing.id;
  insertRow(db, tableName, row);
  return getByColumn(db, tableName, columnName, value)?.id;
}

function getTableByName(db, tableName) {
  if (!tableExists(db, 'tables')) return null;
  return db.prepare('SELECT id FROM tables WHERE LOWER(table_name) = LOWER(?) LIMIT 1').get(tableName);
}

function upsertUser(db, name, username, pin, role) {
  if (!tableExists(db, 'users')) return;
  db.prepare(`
    INSERT INTO users (name, username, pin, pin_hash, role, active)
    VALUES (?, ?, '', ?, ?, 1)
    ON CONFLICT(username) DO UPDATE SET
      name = excluded.name,
      pin = '',
      pin_hash = excluded.pin_hash,
      role = excluded.role,
      active = 1
  `).run(name, username, bcrypt.hashSync(pin, 10), role);
}

function ensureKitchen(db, name, printerName) {
  const existing = getByName(db, 'kitchens', name);
  if (existing) return existing.id;
  insertRow(db, 'kitchens', { name, printer_name: printerName, active: 1 });
  return getByName(db, 'kitchens', name)?.id;
}

function ensureCategory(db, name, kitchenId) {
  const existing = getByName(db, 'categories', name);
  if (existing) return existing.id;
  insertRow(db, 'categories', { name, kitchen_id: kitchenId, active: 1 });
  return getByName(db, 'categories', name)?.id;
}

function ensureItem(db, row) {
  const existing = getByName(db, 'items', row.name);
  if (existing) {
    const allowed = columns(db, 'items');
    const updates = Object.entries(row).filter(([key]) => key !== 'name' && allowed.has(key));
    if (updates.length) {
      db.prepare(`UPDATE items SET ${updates.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
        .run(...updates.map(([, value]) => value), existing.id);
    }
    return existing.id;
  }
  insertRow(db, 'items', row);
  return getByName(db, 'items', row.name)?.id;
}

function ensureModifierGroup(db, name, minSelect, maxSelect, required = 0) {
  const existing = getByName(db, 'modifier_groups', name);
  if (existing) return existing.id;
  insertRow(db, 'modifier_groups', {
    name,
    min_select: minSelect,
    max_select: maxSelect,
    required,
    active: 1
  });
  return getByName(db, 'modifier_groups', name)?.id;
}

function ensureCombo(db, name, price) {
  const existing = getByName(db, 'combos', name);
  if (existing) return existing.id;
  insertRow(db, 'combos', { name, price, active: 1 });
  return getByName(db, 'combos', name)?.id;
}

function ensureModifier(db, name, priceDelta, groupId) {
  if (!tableExists(db, 'modifiers') || !groupId) return null;
  const existing = db.prepare('SELECT id FROM modifiers WHERE LOWER(name) = LOWER(?) AND group_id = ? LIMIT 1').get(name, groupId);
  if (existing) return existing.id;
  insertRow(db, 'modifiers', { name, price_delta: priceDelta, group_id: groupId, active: 1 });
  return db.prepare('SELECT id FROM modifiers WHERE LOWER(name) = LOWER(?) AND group_id = ? LIMIT 1').get(name, groupId)?.id;
}

function ensureItemModifierGroup(db, itemId, groupId) {
  if (!tableExists(db, 'item_modifier_groups') || !itemId || !groupId) return null;
  const existing = db.prepare('SELECT id FROM item_modifier_groups WHERE item_id = ? AND group_id = ? LIMIT 1').get(itemId, groupId);
  if (existing) return existing.id;
  insertRow(db, 'item_modifier_groups', { item_id: itemId, group_id: groupId, active: 1 });
  return db.prepare('SELECT id FROM item_modifier_groups WHERE item_id = ? AND group_id = ? LIMIT 1').get(itemId, groupId)?.id;
}

function ensureComboItem(db, comboId, itemId, quantity) {
  if (!tableExists(db, 'combo_items') || !comboId || !itemId) return null;
  const existing = db.prepare('SELECT id FROM combo_items WHERE combo_id = ? AND item_id = ? LIMIT 1').get(comboId, itemId);
  if (existing) return existing.id;
  insertRow(db, 'combo_items', { combo_id: comboId, item_id: itemId, quantity, active: 1 });
  return db.prepare('SELECT id FROM combo_items WHERE combo_id = ? AND item_id = ? LIMIT 1').get(comboId, itemId)?.id;
}

function deleteDuplicateRows(db, tableName, columnName, extraWhere = '1 = 1') {
  if (!tableExists(db, tableName)) return;
  db.prepare(`
    DELETE FROM ${tableName}
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM ${tableName}
      GROUP BY LOWER(${columnName})
    )
    AND ${extraWhere}
  `).run();
}

function cleanupWhitelabelDuplicates(db) {
  deleteDuplicateRows(db, 'kitchens', 'name', `
    id NOT IN (SELECT kitchen_id FROM categories WHERE kitchen_id IS NOT NULL)
    AND id NOT IN (SELECT kitchen_id FROM order_items WHERE kitchen_id IS NOT NULL)
  `);
  deleteDuplicateRows(db, 'printers', 'name', `
    id NOT IN (SELECT printer_id FROM kitchens WHERE printer_id IS NOT NULL)
    AND id NOT IN (SELECT printer_id FROM print_jobs WHERE printer_id IS NOT NULL)
  `);
  deleteDuplicateRows(db, 'delivery_partners', 'name');
  deleteDuplicateRows(db, 'suppliers', 'name');
  deleteDuplicateRows(db, 'inventory_suppliers', 'name');
  deleteDuplicateRows(db, 'ingredients', 'name');
  deleteDuplicateRows(db, 'inventory_ingredients', 'name');
}

function seedWhitelabelDemoData(db, options = {}) {
  const restaurantId = options.restaurantId || WHITELABEL_RESTAURANT_ID;
  const licenseKey = options.licenseKey || WHITELABEL_LICENSE_KEY;
  if (!isWhitelabelDemo(restaurantId, licenseKey) && !options.force) {
    return { skipped: true, reason: 'not_whitelabel_demo' };
  }

  const result = db.transaction(() => {
    const alreadySeeded = tableExists(db, 'db_meta')
      && Boolean(db.prepare("SELECT value FROM db_meta WHERE key = 'whitelabel_demo_seeded_at'").get());
    upsertSystemConfig(db, {
      restaurant_display_name: 'KMaster White Label Demo Restaurant',
      legal_name: 'KMaster Demo Foods',
      gstin: '33ABCDE1234F1Z5',
      fssai_license_no: '12345678901234',
      state_code: '33',
      sac_code: '996331',
      address_line_1: 'Demo High Street',
      address_line_2: 'Near Central Bus Stand',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      phone: '+91 98765 43210',
      email: 'demo@kmasterpos.com',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      default_order_type: 'DINE_IN',
      allow_discount: '1',
      allow_refund: '1',
      allow_order_cancel: '1',
      require_manager_pin_for_discount: '0',
      require_manager_pin_for_refund: '1',
      require_manager_pin_for_void: '1',
      invoice_prefix: 'DEMO',
      show_tax_on_bill: '1',
      tax_name: 'GST',
      tax_rate: '5',
      show_qr_on_bill: '1',
      upi_id: 'demo@upi',
      service_charge_enabled: '0',
      round_off_enabled: '1',
      auto_print_kot: '1',
      print_kot_on_submit: '1',
      allow_kot_reprint: '1',
      kot_header_text: 'KMaster Demo Kitchen',
      kot_footer_text: 'Demo order - not for billing',
      mobile_app_enabled: '1',
      online_order_enabled: '1',
      online_storefront_slug: 'kmaster-whitelabel-demo',
      online_theme: 'CLASSIC',
      online_primary_color: '#0f766e',
      online_accent_color: '#f59e0b',
      online_payment_methods: 'UPI,CARD,COD',
      online_delivery_enabled: '1',
      online_takeaway_enabled: '1',
      online_min_order_amount: '99',
      enabled_modules: JSON.stringify(DEMO_MODULES)
    }, !alreadySeeded);

    // Correct the original demo-only placeholder without changing a restaurant's own GSTIN.
    db.prepare(`
      UPDATE system_config
      SET value = '33ABCDE1234F1Z5', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'gstin' AND value = '33DEMO1234F1Z5'
    `).run();

    if (tableExists(db, 'license_status')) {
      db.prepare(`
        INSERT INTO license_status (restaurant_id, license_key, last_checked, expires_at, status)
        VALUES (?, ?, CURRENT_TIMESTAMP, DATE('now', '+10 years'), 'ACTIVE')
        ON CONFLICT(restaurant_id) DO UPDATE SET
          license_key = excluded.license_key,
          last_checked = CURRENT_TIMESTAMP,
          expires_at = excluded.expires_at,
          status = 'ACTIVE'
      `).run(WHITELABEL_RESTAURANT_ID, WHITELABEL_LICENSE_KEY);
    }

    [
      ['Demo Owner', 'admin', '123456', 'OWNER'],
      ['Demo Manager', 'manager', '111111', 'MANAGER'],
      ['Demo Cashier', 'cashier', '222222', 'CASHIER'],
      ['Demo Captain', 'captain', '333333', 'CAPTAIN'],
      ['Demo Waiter', 'waiter', '444444', 'WAITER'],
      ['Kitchen Display', 'kitchen', '555555', 'KITCHEN']
    ].forEach(([name, username, pin, role]) => upsertUser(db, name, username, pin, role));

    cleanupWhitelabelDuplicates(db);

    ensureRowByColumn(db, 'printers', 'name', 'Bill Counter Printer', { name: 'Bill Counter Printer', type: 'BILL', connection: 'USB', address: 'DEMO-BILL', active: 1 });
    ensureRowByColumn(db, 'printers', 'name', 'Kitchen KOT Printer', { name: 'Kitchen KOT Printer', type: 'KITCHEN', connection: 'NETWORK', address: '192.168.1.50', active: 1 });

    const kitchenIds = {
      main: ensureKitchen(db, 'Main Kitchen', 'Kitchen KOT Printer'),
      tandoor: ensureKitchen(db, 'Tandoor', 'Kitchen KOT Printer'),
      beverage: ensureKitchen(db, 'Beverage Counter', 'Bill Counter Printer'),
      dessert: ensureKitchen(db, 'Dessert Counter', 'Bill Counter Printer')
    };

    const categoryIds = {
      breakfast: ensureCategory(db, 'Breakfast', kitchenIds.main),
      starters: ensureCategory(db, 'Starters', kitchenIds.tandoor),
      biryanis: ensureCategory(db, 'Biryanis', kitchenIds.main),
      meals: ensureCategory(db, 'Meals', kitchenIds.main),
      breads: ensureCategory(db, 'Breads', kitchenIds.tandoor),
      beverages: ensureCategory(db, 'Beverages', kitchenIds.beverage),
      desserts: ensureCategory(db, 'Desserts', kitchenIds.dessert)
    };

    const itemIds = {};
    [
      ['Idli Sambar', 'breakfast', 55, 1, 'Soft idlis with hot sambar and chutney.'],
      ['Masala Dosa', 'breakfast', 95, 1, 'Crisp dosa with potato masala.'],
      ['Ghee Pongal', 'breakfast', 85, 1, 'Comforting rice and dal pongal with ghee.'],
      ['Paneer Tikka', 'starters', 190, 1, 'Tandoor grilled paneer with peppers.'],
      ['Chicken 65', 'starters', 180, 0, 'Crispy spicy chicken starter.'],
      ['Veg Biryani', 'biryanis', 160, 1, 'Aromatic vegetable biryani with raita.'],
      ['Chicken Biryani', 'biryanis', 220, 0, 'Classic chicken biryani with boiled egg.'],
      ['South Indian Veg Meals', 'meals', 145, 1, 'Rice, sambar, rasam, poriyal and curd.'],
      ['Butter Naan', 'breads', 55, 1, 'Soft tandoor naan brushed with butter.'],
      ['Chapati', 'breads', 35, 1, 'Whole wheat chapati.'],
      ['Filter Coffee', 'beverages', 35, 1, 'Fresh South Indian filter coffee.'],
      ['Fresh Lime Soda', 'beverages', 60, 1, 'Sweet, salt or mixed lime soda.'],
      ['Gulab Jamun', 'desserts', 70, 1, 'Warm gulab jamun dessert.']
    ].forEach(([name, category, price, isVeg, description]) => {
      itemIds[name] = ensureItem(db, {
        name,
        category_id: categoryIds[category],
        price,
        is_veg: isVeg,
        allow_parcel: 1,
        active: 1,
        online_enabled: 1,
        online_description: description
      });
    });

    ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6', 'Family 1', 'Family 2', 'Parcel Counter'].forEach((table) => {
      if (!getTableByName(db, table)) insertRow(db, 'tables', { table_name: table, status: 'AVAILABLE', active: 1 });
    });

    [
      ['DEMO10', 10, 'PERCENT'],
      ['FAMILY50', 50, 'AMOUNT']
    ].forEach(([code, value, type]) => {
      ensureRowByColumn(db, 'promo_codes', 'code', code, {
        code,
        value,
        value_type: type,
        discount_value: value,
        discount_type: type === 'PERCENT' ? 'PERCENT' : 'RUPEES',
        min_order_amount: 99,
        active: 1
      });
    });

    ['Swiggy Demo', 'Zomato Demo', 'In-house Rider'].forEach((name) => {
      ensureRowByColumn(db, 'delivery_partners', 'name', name, { name, phone: '+91 90000 00000', integration_type: 'MANUAL', active: 1 });
    });

    [
      ['Arun Kumar', '9876500001', 'arun.demo@example.com'],
      ['Meena Priya', '9876500002', 'meena.demo@example.com'],
      ['Selvam Traders', '9876500003', 'selvam.demo@example.com']
    ].forEach(([name, phone, email]) => {
      ensureRowByColumn(db, 'customers', 'phone', phone, { name, phone, email, active: 1 });
      ensureRowByColumn(db, 'members', 'phone', phone, { name, phone, tier: 'REGULAR', active: 1 });
    });

    [
      ['Demo Fresh Vegetables', '+91 90000 11111', 'Market Street, Chennai'],
      ['Demo Meat Suppliers', '+91 90000 22222', 'Wholesale Market, Chennai'],
      ['Demo Rice Mill', '+91 90000 33333', 'Red Hills, Chennai']
    ].forEach(([name, phone, address]) => {
      ensureRowByColumn(db, 'suppliers', 'name', name, { name, phone, address, active: 1 });
      ensureRowByColumn(db, 'inventory_suppliers', 'name', name, { name, phone, address, active: 1 });
    });

    [
      ['Rice', 'kg', 80, 20, 55],
      ['Chicken', 'kg', 30, 8, 210],
      ['Paneer', 'kg', 16, 3, 280],
      ['Dosa Batter', 'ltr', 40, 10, 45],
      ['Milk', 'ltr', 25, 5, 52],
      ['Tea Powder', 'kg', 5, 1, 360],
      ['Spice Mix', 'kg', 8, 2, 420]
    ].forEach(([name, unit, stock, low, cost]) => {
      ensureRowByColumn(db, 'ingredients', 'name', name, { name, unit, current_stock: stock, low_stock_alert: low, active: 1 });
      ensureRowByColumn(db, 'inventory_ingredients', 'name', name, { name, unit, current_stock: stock, low_stock_level: low, cost_per_unit: cost, active: 1 });
    });

    const spiceId = ensureModifierGroup(db, 'Spice Level', 0, 1, 0);
    const extrasId = ensureModifierGroup(db, 'Extras', 0, 3, 0);
    [
      ['Mild', 0, spiceId],
      ['Medium', 0, spiceId],
      ['Extra Spicy', 0, spiceId],
      ['Extra Chutney', 15, extrasId],
      ['Extra Raita', 25, extrasId],
      ['Extra Egg', 20, extrasId]
    ].forEach(([name, priceDelta, groupId]) => ensureModifier(db, name, priceDelta, groupId));
    ['Chicken Biryani', 'Veg Biryani', 'Masala Dosa'].forEach((name) => {
      if (itemIds[name] && spiceId) ensureItemModifierGroup(db, itemIds[name], spiceId);
      if (itemIds[name] && extrasId) ensureItemModifierGroup(db, itemIds[name], extrasId);
    });

    const comboId = ensureCombo(db, 'Family Biryani Combo', 699);
    [
      ['Chicken Biryani', 2],
      ['Fresh Lime Soda', 2],
      ['Gulab Jamun', 2]
    ].forEach(([name, quantity]) => {
      if (comboId && itemIds[name]) ensureComboItem(db, comboId, itemIds[name], quantity);
    });

    cleanupWhitelabelDuplicates(db);

    if (tableExists(db, 'db_meta')) {
      db.prepare(`
        INSERT INTO db_meta (key, value)
        VALUES ('whitelabel_demo_seeded_at', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();
    }

    return {
      users: tableExists(db, 'users') ? db.prepare('SELECT COUNT(*) AS count FROM users WHERE active = 1').get().count : 0,
      kitchens: tableExists(db, 'kitchens') ? db.prepare('SELECT COUNT(*) AS count FROM kitchens WHERE active = 1').get().count : 0,
      categories: tableExists(db, 'categories') ? db.prepare('SELECT COUNT(*) AS count FROM categories WHERE active = 1').get().count : 0,
      items: tableExists(db, 'items') ? db.prepare('SELECT COUNT(*) AS count FROM items WHERE active = 1').get().count : 0,
      tables: tableExists(db, 'tables') ? db.prepare('SELECT COUNT(*) AS count FROM tables WHERE active = 1').get().count : 0
    };
  })();

  return { success: true, ...result };
}

module.exports = {
  DEMO_MODULES,
  WHITELABEL_LICENSE_KEY,
  WHITELABEL_RESTAURANT_ID,
  isWhitelabelDemo,
  seedWhitelabelDemoData
};
