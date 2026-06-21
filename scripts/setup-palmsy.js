const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('../saas-backend/node_modules/pg');
const bcrypt = require('../pos-app/node_modules/bcrypt');
const { setupDatabase } = require('../pos-app/backend/services/dbSetup');
const { openDatabase } = require('../pos-app/backend/db/database');

const ROOT = path.join(__dirname, '..');
const RESTAURANT_ID = 'RESTOPALMSY';
const RESTAURANT_NAME = 'Palmsy Arumuganeri';
const POS_URL = 'http://localhost:3000';
const LICENSE_KEY = 'PALMSY-PREMIUM-' + crypto.randomUUID().slice(0, 8).toUpperCase();
const SYNC_TOKEN = crypto.randomUUID();
const OWNER_EMAIL = 'palmsy.owner@example.com';
const OWNER_PASSWORD = 'Palmsy@1234';
const MODULES = [
  ['INVENTORY', 'Inventory Management', 'Ingredients, suppliers, stock movements and recipe mapping', 'OPERATIONS'],
  ['KDS', 'Kitchen Display System', 'Kitchen display order preparation screens', 'OPERATIONS'],
  ['LOYALTY', 'Customer CRM & Loyalty', 'Customer profiles, visits and loyalty points', 'CUSTOMER'],
  ['QR_ORDERING', 'QR Ordering', 'Customer self-ordering through table QR links', 'SALES'],
  ['RESERVATIONS', 'Reservations', 'Table reservation management', 'SALES'],
  ['CLOUD_REPORTING', 'Cloud Reporting', 'Owner remote summary reporting sync', 'REPORTING'],
  ['MULTI_BRANCH', 'Multi Branch', 'Franchise and multi-location management placeholder', 'ENTERPRISE'],
  ['WHITE_LABEL', 'White Label', 'Partner branding and reseller management', 'ENTERPRISE'],
  ['ONLINE_ORDERING', 'Online Ordering', 'Customer web ordering for takeaway, delivery and prepaid/cash orders', 'SALES'],
  ['MOBILE_APP', 'White-label Mobile App', 'Cross-platform owner, captain and waiter mobile app packaging', 'PREMIUM']
];

function readEnv(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((env, line) => {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    return env;
  }, {});
}

function dbPath() {
  return path.join(ROOT, 'pos-app', 'data', `restaurant_${RESTAURANT_ID}.db`);
}

function columns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function insertRow(db, tableName, row, { orIgnore = false } = {}) {
  const allowed = columns(db, tableName);
  const entries = Object.entries(row).filter(([key]) => allowed.has(key));
  if (entries.length === 0) return null;
  const names = entries.map(([key]) => key);
  const sql = `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${tableName} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`;
  return db.prepare(sql).run(...entries.map(([, value]) => value));
}

function setConfig(db, settings) {
  const statement = db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  Object.entries(settings).forEach(([key, value]) => statement.run(key, String(value ?? '')));
}

function getByName(db, tableName, name) {
  return db.prepare(`SELECT id FROM ${tableName} WHERE LOWER(name) = LOWER(?) LIMIT 1`).get(name);
}

async function seedSaas() {
  const env = readEnv(path.join(ROOT, 'saas-backend', '.env'));
  const pool = new Pool({
    host: env.DB_HOST || 'localhost',
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'restaurant_saas',
    port: Number(env.DB_PORT || 5432),
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingTenants = await client.query('SELECT id FROM tenants WHERE restaurant_code = $1 OR LOWER(name) = LOWER($2)', [RESTAURANT_ID, RESTAURANT_NAME]);
    const tenantIds = existingTenants.rows.map((row) => row.id);
    if (tenantIds.length > 0) {
      await client.query('DELETE FROM subscription_payments WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM partner_subscriptions WHERE restaurant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM partner_commissions WHERE restaurant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM restaurant_owners WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM tenant_daily_reports WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM tenant_item_sales WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM tenant_sync_logs WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM module_usage_logs WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM partner_restaurants WHERE restaurant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM organization_restaurants WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM support_notes WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM pos_heartbeats WHERE tenant_id = ANY($1::uuid[]) OR restaurant_code = $2', [tenantIds, RESTAURANT_ID]);
      await client.query('DELETE FROM licenses WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
    }
    await client.query("DELETE FROM organizations WHERE name = 'Palmsy Group'");

    await client.query(`
      INSERT INTO subscription_plans (code, name, duration_days, price, active)
      VALUES ('PREMIUM', 'Premium', 3650, 0, true)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, duration_days = excluded.duration_days, price = excluded.price, active = true
    `);

    for (const [code, name, description, category] of MODULES) {
      await client.query(`
        INSERT INTO modules (code, name, description, category, status)
        VALUES ($1, $2, $3, $4, 'ACTIVE')
        ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description, category = excluded.category, status = 'ACTIVE'
      `, [code, name, description, category]);
    }

    await client.query(`
      INSERT INTO module_pricing (module_id, billing_cycle, price, currency)
      SELECT id, 'MONTHLY', 0, 'INR' FROM modules
      ON CONFLICT(module_id, billing_cycle, currency) DO UPDATE SET price = 0
    `);

    const tenantId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const branchGroupId = crypto.randomUUID();
    await client.query(`
      INSERT INTO tenants (id, restaurant_code, name, country, currency, mobile_pos_url)
      VALUES ($1, $2, $3, 'India', 'INR', $4)
    `, [tenantId, RESTAURANT_ID, RESTAURANT_NAME, POS_URL]);
    await client.query(`
      INSERT INTO licenses (tenant_id, license_key, sync_token, expires_at, status)
      VALUES ($1, $2, $3, CURRENT_DATE + INTERVAL '10 years', 'ACTIVE')
    `, [tenantId, LICENSE_KEY, SYNC_TOKEN]);

    const plan = await client.query("SELECT id FROM subscription_plans WHERE code = 'PREMIUM'");
    const subscription = await client.query(`
      INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
      VALUES ($1, $2, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 years')
      RETURNING id
    `, [tenantId, plan.rows[0].id]);
    await client.query(`
      INSERT INTO subscription_payments (subscription_id, tenant_id, amount, payment_mode, reference_no)
      VALUES ($1, $2, 0, 'TEST', 'PALMSY-PREMIUM-TEST')
    `, [subscription.rows[0].id, tenantId]);

    await client.query(`
      INSERT INTO organizations (id, name, legal_name, email, phone, status)
      VALUES ($1, 'Palmsy Group', 'Palmsy Group Restaurants', 'palmsy.owner@example.com', '+91 98765 43210', 'ACTIVE')
    `, [organizationId]);
    await client.query(`
      INSERT INTO branch_groups (id, organization_id, name, description, active)
      VALUES ($1, $2, 'Tamil Nadu Branches', 'Primary operating region', true)
    `, [branchGroupId, organizationId]);
    await client.query(`
      INSERT INTO organization_restaurants (organization_id, tenant_id, branch_group_id, branch_name, active)
      VALUES ($1, $2, $3, $4, true)
    `, [organizationId, tenantId, branchGroupId, RESTAURANT_NAME]);

    await client.query(`
      INSERT INTO tenant_modules (tenant_id, module_id, enabled, activated_at)
      SELECT $1, id, true, NOW() FROM modules
      ON CONFLICT(tenant_id, module_id) DO UPDATE SET enabled = true, activated_at = NOW(), deactivated_at = NULL
    `, [tenantId]);

    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    await client.query(`
      INSERT INTO owner_users (id, name, email, password_hash, active, reset_required)
      VALUES ($1, $2, $3, $4, true, false)
      ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, active = true, reset_required = false
    `, [ownerId, 'Palmsy Owner', OWNER_EMAIL, ownerHash]);
    const owner = await client.query('SELECT id FROM owner_users WHERE email = $1', [OWNER_EMAIL]);
    await client.query(`
      INSERT INTO restaurant_owners (owner_user_id, tenant_id, active)
      VALUES ($1, $2, true)
      ON CONFLICT(owner_user_id, tenant_id) DO UPDATE SET active = true
    `, [owner.rows[0].id, tenantId]);

    await client.query(`
      INSERT INTO tenant_daily_reports (
        tenant_id, report_date, gross_sales, net_sales, tax_amount, discount_amount,
        refunds_amount, orders_count, cash_total, card_total, upi_total
      )
      VALUES ($1, CURRENT_DATE, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      ON CONFLICT(tenant_id, report_date) DO NOTHING
    `, [tenantId]);
    await client.query(`
      INSERT INTO pos_heartbeats (tenant_id, restaurant_code, pos_version, backup_status, printer_status, license_status, app_status, payload)
      VALUES ($1, $2, 'test-seed', 'OK', 'OK', 'ACTIVE', 'OK', $3::jsonb)
      ON CONFLICT(restaurant_code) DO UPDATE SET tenant_id = excluded.tenant_id, license_status = 'ACTIVE', app_status = 'OK', last_heartbeat_at = NOW()
    `, [tenantId, RESTAURANT_ID, JSON.stringify({ seededBy: 'setup-palmsy' })]);

    await client.query('COMMIT');
    return { tenantId, modules: MODULES.map(([code]) => code) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function seedPos() {
  fs.rmSync(dbPath(), { force: true });
  setupDatabase(RESTAURANT_ID);
  const db = openDatabase(RESTAURANT_ID);
  try {
    setConfig(db, {
      restaurant_display_name: RESTAURANT_NAME,
      legal_name: 'Palmsy Arumuganeri Foods',
      gstin: '33ABCDE1234F1Z5',
      address_line_1: 'Main Road',
      address_line_2: 'Near Bus Stand',
      city: 'Arumuganeri',
      state: 'Tamil Nadu',
      country: 'India',
      phone: '+91 98765 43210',
      email: 'palmsy@example.com',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      default_order_type: 'DINE_IN',
      allow_discount: '1',
      allow_refund: '1',
      allow_order_cancel: '1',
      require_manager_pin_for_discount: '0',
      require_manager_pin_for_refund: '1',
      require_manager_pin_for_void: '1',
      invoice_prefix: 'PAL',
      show_tax_on_bill: '1',
      show_qr_on_bill: '1',
      upi_id: 'palmsy@upi',
      service_charge_enabled: '0',
      round_off_enabled: '1',
      auto_print_kot: '1',
      print_kot_on_submit: '1',
      allow_kot_reprint: '1',
      kot_header_text: 'Palmsy Arumuganeri',
      kot_footer_text: 'Check spice notes before dispatch',
      cloud_sync_enabled: '1',
      cloud_sync_token: SYNC_TOKEN,
      mobile_app_enabled: '1',
      enabled_modules: JSON.stringify(MODULES.map(([code]) => code)),
      online_order_enabled: '1',
      online_storefront_slug: 'palmsy-arumuganeri',
      online_theme: 'CLASSIC',
      online_primary_color: '#0f766e',
      online_accent_color: '#f59e0b',
      online_payment_methods: 'UPI,CARD,COD,WALLET,NETBANKING',
      online_require_otp: '1',
      online_allow_loyalty_credit: '1',
      online_delivery_enabled: '1',
      online_takeaway_enabled: '1',
      online_min_order_amount: '99'
    });
    db.prepare(`
      INSERT INTO license_status (restaurant_id, license_key, last_checked, expires_at, status)
      VALUES (?, ?, CURRENT_TIMESTAMP, DATE('now', '+10 years'), 'ACTIVE')
      ON CONFLICT(restaurant_id) DO UPDATE SET license_key = excluded.license_key, last_checked = CURRENT_TIMESTAMP, expires_at = excluded.expires_at, status = 'ACTIVE'
    `).run(RESTAURANT_ID, LICENSE_KEY);

    const staff = [
      ['Administrator', 'admin', '1234', 'OWNER'],
      ['Palmsy Manager', 'manager', '1111', 'MANAGER'],
      ['Front Cashier', 'cashier', '2222', 'CASHIER'],
      ['Floor Captain', 'captain', '3333', 'CAPTAIN'],
      ['Waiter One', 'waiter', '4444', 'WAITER'],
      ['Kitchen Display', 'kitchen', '5555', 'KITCHEN']
    ];
    for (const [name, username, pin, role] of staff) {
      db.prepare(`
        INSERT INTO users (name, username, pin, pin_hash, role, active)
        VALUES (?, ?, '', ?, ?, 1)
        ON CONFLICT(username) DO UPDATE SET name = excluded.name, pin_hash = excluded.pin_hash, role = excluded.role, active = 1
      `).run(name, username, bcrypt.hashSync(pin, 10), role);
    }

    const kitchenIds = {};
    for (const kitchen of ['South Indian', 'Tandoor', 'Curry', 'Biryani', 'Beverage', 'Dessert']) {
      insertRow(db, 'kitchens', { name: kitchen, printer_name: `${kitchen} Printer`, active: 1 }, { orIgnore: true });
      kitchenIds[kitchen] = getByName(db, 'kitchens', kitchen).id;
    }

    const categoryIds = {};
    const categories = [
      ['Breakfast', 'South Indian'], ['Tiffin', 'South Indian'], ['Starters', 'Tandoor'],
      ['Tandoor', 'Tandoor'], ['Biryanis', 'Biryani'], ['Meals', 'Curry'],
      ['Gravies', 'Curry'], ['Breads', 'Tandoor'], ['Beverages', 'Beverage'], ['Desserts', 'Dessert']
    ];
    for (const [name, kitchen] of categories) {
      insertRow(db, 'categories', { name, kitchen_id: kitchenIds[kitchen], active: 1 }, { orIgnore: true });
      categoryIds[name] = getByName(db, 'categories', name).id;
    }

    const menu = [
      ['Idli Sambar', 'Breakfast', 55, 1], ['Medu Vada', 'Breakfast', 45, 1], ['Ghee Pongal', 'Breakfast', 80, 1],
      ['Masala Dosa', 'Tiffin', 95, 1], ['Onion Rava Dosa', 'Tiffin', 110, 1], ['Kothu Parotta', 'Tiffin', 120, 0],
      ['Gobi 65', 'Starters', 135, 1], ['Paneer Tikka', 'Starters', 190, 1], ['Chicken 65', 'Starters', 180, 0],
      ['Tandoori Chicken Half', 'Tandoor', 280, 0], ['Fish Fry', 'Tandoor', 240, 0],
      ['Veg Biryani', 'Biryanis', 160, 1], ['Chicken Biryani', 'Biryanis', 220, 0], ['Mutton Biryani', 'Biryanis', 290, 0],
      ['South Indian Veg Meals', 'Meals', 145, 1], ['Mini Meals', 'Meals', 105, 1],
      ['Paneer Butter Masala', 'Gravies', 210, 1], ['Chicken Chettinad', 'Gravies', 245, 0], ['Mutton Sukka', 'Gravies', 275, 0],
      ['Butter Naan', 'Breads', 55, 1], ['Chapati', 'Breads', 35, 1], ['Parotta', 'Breads', 40, 1],
      ['Filter Coffee', 'Beverages', 35, 1], ['Masala Tea', 'Beverages', 30, 1], ['Fresh Lime Soda', 'Beverages', 60, 1],
      ['Gulab Jamun', 'Desserts', 70, 1], ['Payasam', 'Desserts', 65, 1]
    ];
    const itemIds = {};
    for (const [name, category, price, isVeg] of menu) {
      insertRow(db, 'items', {
        name,
        category_id: categoryIds[category],
        price,
        is_veg: isVeg,
        allow_parcel: 1,
        active: 1,
        online_enabled: 1,
        online_description: `${name} prepared fresh for Palmsy guests`
      }, { orIgnore: true });
      itemIds[name] = getByName(db, 'items', name).id;
    }

    for (const table of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'AC1', 'AC2', 'AC3', 'Family1', 'Family2', 'Parcel', 'Delivery']) {
      insertRow(db, 'tables', { table_name: table, status: 'AVAILABLE', active: 1 }, { orIgnore: true });
    }

    for (const [code, value, type] of [['PALMSY10', 10, 'PERCENT'], ['FAMILY50', 50, 'AMOUNT']]) {
      insertRow(db, 'promo_codes', { code, value, value_type: type, active: 1 }, { orIgnore: true });
    }

    for (const partner of ['Zomato', 'Swiggy', 'In-house Rider']) {
      insertRow(db, 'delivery_partners', { name: partner, phone: '+91 90000 00000', active: 1 }, { orIgnore: true });
    }

    for (const customer of [
      ['Arun Kumar', '9876500001', 'arun@example.com'],
      ['Meena Priya', '9876500002', 'meena@example.com'],
      ['Selvam Traders', '9876500003', 'selvam@example.com']
    ]) {
      insertRow(db, 'customers', { name: customer[0], phone: customer[1], email: customer[2], active: 1 }, { orIgnore: true });
    }

    for (const supplier of [
      ['Arumuganeri Fresh Vegetables', '+91 90000 11111', 'Market Street, Arumuganeri'],
      ['Tuticorin Meat Suppliers', '+91 90000 22222', 'Thoothukudi'],
      ['Nellai Rice Mill', '+91 90000 33333', 'Tirunelveli']
    ]) {
      insertRow(db, 'suppliers', { name: supplier[0], phone: supplier[1], address: supplier[2], active: 1, gstin: '33ABCDE1234F1Z5' }, { orIgnore: true });
      insertRow(db, 'inventory_suppliers', { name: supplier[0], phone: supplier[1], address: supplier[2], active: 1 }, { orIgnore: true });
    }

    const ingredients = [
      ['Rice', 'kg', 80, 20, 55], ['Chicken', 'kg', 30, 8, 210], ['Mutton', 'kg', 12, 4, 620],
      ['Paneer', 'kg', 16, 3, 280], ['Dosa Batter', 'ltr', 40, 10, 45], ['Milk', 'ltr', 25, 5, 52],
      ['Tea Powder', 'kg', 5, 1, 360], ['Spice Mix', 'kg', 8, 2, 420], ['Parotta Dough', 'kg', 20, 5, 70]
    ];
    for (const [name, unit, stock, low, cost] of ingredients) {
      insertRow(db, 'ingredients', { name, unit, current_stock: stock, low_stock_alert: low, active: 1 }, { orIgnore: true });
      insertRow(db, 'inventory_ingredients', { name, unit, current_stock: stock, low_stock_level: low, cost_per_unit: cost, active: 1 }, { orIgnore: true });
    }

    const spiceGroup = insertRow(db, 'modifier_groups', { name: 'Spice Level', min_select: 0, max_select: 1, required: 0, active: 1 }, { orIgnore: true });
    const extrasGroup = insertRow(db, 'modifier_groups', { name: 'Extras', min_select: 0, max_select: 3, required: 0, active: 1 }, { orIgnore: true });
    const spiceId = getByName(db, 'modifier_groups', 'Spice Level').id;
    const extrasId = getByName(db, 'modifier_groups', 'Extras').id;
    void spiceGroup;
    void extrasGroup;
    for (const option of [['Mild', 0, spiceId], ['Medium', 0, spiceId], ['Extra Spicy', 0, spiceId], ['Extra Chutney', 15, extrasId], ['Extra Raita', 25, extrasId], ['Extra Egg', 20, extrasId]]) {
      insertRow(db, 'modifiers', { name: option[0], price_delta: option[1], group_id: option[2], active: 1 }, { orIgnore: true });
    }
    for (const item of ['Chicken Biryani', 'Mutton Biryani', 'Paneer Butter Masala', 'Masala Dosa']) {
      insertRow(db, 'item_modifier_groups', { item_id: itemIds[item], group_id: spiceId, active: 1 }, { orIgnore: true });
      insertRow(db, 'item_modifier_groups', { item_id: itemIds[item], group_id: extrasId, active: 1 }, { orIgnore: true });
    }

    insertRow(db, 'combos', { name: 'Family Biryani Combo', price: 799, active: 1 }, { orIgnore: true });
    const comboId = getByName(db, 'combos', 'Family Biryani Combo').id;
    for (const [item, quantity] of [['Chicken Biryani', 2], ['Tandoori Chicken Half', 1], ['Fresh Lime Soda', 2], ['Gulab Jamun', 2]]) {
      insertRow(db, 'combo_items', { combo_id: comboId, item_id: itemIds[item], quantity, active: 1 }, { orIgnore: true });
    }

    return {
      users: db.prepare('SELECT COUNT(*) AS count FROM users WHERE active = 1').get().count,
      kitchens: db.prepare('SELECT COUNT(*) AS count FROM kitchens WHERE active = 1').get().count,
      categories: db.prepare('SELECT COUNT(*) AS count FROM categories WHERE active = 1').get().count,
      items: db.prepare('SELECT COUNT(*) AS count FROM items WHERE active = 1').get().count,
      tables: db.prepare('SELECT COUNT(*) AS count FROM tables WHERE active = 1').get().count,
      dbPath: dbPath()
    };
  } finally {
    db.close();
  }
}

(async () => {
  const saas = await seedSaas();
  const pos = seedPos();
  console.log(JSON.stringify({
    success: true,
    restaurantId: RESTAURANT_ID,
    restaurantName: RESTAURANT_NAME,
    posUrl: POS_URL,
    licenseKey: LICENSE_KEY,
    syncToken: SYNC_TOKEN,
    ownerLogin: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    posPins: {
      admin: '1234',
      manager: '1111',
      cashier: '2222',
      captain: '3333',
      waiter: '4444',
      kitchen: '5555'
    },
    enabledModules: saas.modules,
    posCounts: pos,
    tenantId: saas.tenantId
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
