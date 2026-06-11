require('dotenv').config()

console.log('🔥🔥🔥 SERVER.JS VERSION: 2026-01-25 A 🔥🔥🔥');
console.log('🔥🔥🔥 ACTIVE DATABASE.JS – VERSION A 🔥🔥🔥');
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const axios = require('axios');
const os = require('os');

const { setupDatabase } = require('./services/dbSetup');
const { openDatabase } = require('./db/database');
const { hasPermission, permissionsForRole, seedDefaultPermissions } = require('./services/permissions');
const { getSingleRestaurantId } = require('./utils/restaurantScanner');
const { ensureRestaurantSchema, seedDefaultSettings, DEFAULT_SYSTEM_SETTINGS } = require('./services/schema');
const { runMigrations } = require('./services/migrationRunner');
const { logAudit, logComplianceEvent } = require('./services/audit');
const {
  backupRestaurantDatabase,
  getConfig: getBackupConfig,
  setConfig: setBackupConfig,
  listBackups,
  syncLatestBackupToOneDrive,
  restoreBackup,
  dueForScheduledBackup
} = require('./services/backupService');


const app = express();
app.use(bodyParser.json());

function getInvoiceVisibilityClause(role) {
  if (role === 'MANAGER_1') {
    return 'AND o.is_invoice = 1';
  }
  // MANAGER_2 & OWNER can see all
  return '';
}

function getTaxVisibilityClause(role) {
  // Only OWNER can see non-invoice in tax view
  if (role === 'OWNER') {
    return '';
  }
  // Everyone else sees invoice-only
  return 'AND o.is_invoice = 1';
}


function awardLoyaltyPoints(db, orderId, memberId, amount) {
  const points = Math.floor(amount / 100);
  if (points <= 0) return;

  db.prepare(`
    INSERT INTO loyalty_points (member_id, order_id, points, type)
    VALUES (?, ?, ?, 'EARN')
  `).run(memberId, orderId, points);
}


// ========================
// HELPERS
// ========================
function isValidPin(pin) {
  return /^\d{4}$/.test(pin);
}

function openRestaurantDatabase(restaurantId) {
  const db = openDatabase(restaurantId);
  runMigrations(db, restaurantId);
  return db;
}

function canManage(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER', 'MANAGER_2'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'admin.menu.manage') || canRole(db, role, 'admin.users.manage');
  } finally {
    db.close();
  }
}

function canSell(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER', 'MANAGER_1', 'MANAGER_2', 'CASHIER', 'WAITER'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'orders.create') || canRole(db, role, 'billing.settle');
  } finally {
    db.close();
  }
}

function canUseKds(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER_2', 'KITCHEN'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'kitchen.kds.view');
  } finally {
    db.close();
  }
}

const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'PARCEL', 'PHONE_ORDER', 'ONLINE_ORDER'];
const DELIVERY_ORDER_TYPES = ['DELIVERY', 'PHONE_ORDER', 'ONLINE_ORDER'];
const DELIVERY_STATUSES = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

function isPositiveId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normaliseText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function managerCanOverrideReservation(role) {
  return ['OWNER', 'MANAGER', 'MANAGER_1', 'MANAGER_2'].includes(role);
}

function activeReservationForTable(db, tableId) {
  if (!isPositiveId(tableId)) return null;
  return db.prepare(`
    SELECT r.*, t.table_name
    FROM reservations r
    LEFT JOIN tables t ON t.id = r.table_id
    WHERE r.table_id = ?
      AND r.status = 'BOOKED'
      AND DATETIME(r.reservation_time) BETWEEN DATETIME('now', '-30 minutes') AND DATETIME('now', '+2 hours')
    ORDER BY r.reservation_time ASC
    LIMIT 1
  `).get(tableId);
}

function isValidAmount(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function errorStatus(err) {
  if (err?.status) return err.status;
  const message = String(err?.message || '');
  if (/permission denied|permission required/i.test(message)) return 403;
  return /(already exists|already open|already received|not found|required|invalid|must|cannot|less than|insufficient|allows only|needs at least|permission denied|permission required|missing|locked|expired|does not match|changed on another device|open in another tool)/i.test(message) ? 400 : 500;
}

function friendlyErrorMessage(err) {
  return /database is locked/i.test(err.message)
    ? 'Database is currently locked or open in another tool. Close DB Browser and try again.'
    : err.message;
}

function sendError(res, err) {
  const message = friendlyErrorMessage(err);
  res.status(errorStatus({ message, status: err.status })).json({ success: false, message });
}

function normaliseOrderType(value) {
  const orderType = normaliseText(value || 'DINE_IN').toUpperCase();
  return ORDER_TYPES.includes(orderType) ? orderType : null;
}

function writeOrderStatusHistory(db, actor, orderId, status, entityType, note) {
  db.prepare(`
    INSERT INTO order_status_history (order_id, status, entity_type, note, changed_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, status, entityType || 'ORDER', note || null, actor?.id || actor?.userId || null);
}

function kdsTimestampColumn(status) {
  return {
    PREPARING: 'started_at',
    READY: 'ready_at',
    SERVED: 'served_at'
  }[status] || null;
}

function hasOpenOrderFor(db, column, id) {
  return db.prepare(`
    SELECT id FROM orders
    WHERE ${column} = ?
      AND status = 'OPEN'
      AND payment_status != 'PAID'
    LIMIT 1
  `).get(id);
}

function activeNameExists(db, tableName, nameColumn, name, id) {
  const row = db.prepare(`
    SELECT id FROM ${tableName}
    WHERE LOWER(${nameColumn}) = LOWER(?)
      AND active = 1
      AND (? IS NULL OR id != ?)
    LIMIT 1
  `).get(normaliseText(name), id || null, id || null);
  return !!row;
}

function actorFromRole(role) {
  return { role: role || null };
}

function requestIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

function writeAudit(db, actor, action, entityType, entityId, oldValue, newValue, options = {}) {
  if (newValue === undefined) {
    newValue = oldValue;
    oldValue = null;
  }
  logAudit(db, {
    restaurantId: options.restaurantId || getSingleRestaurantId(),
    actor,
    action,
    entityType,
    entityId,
    oldValue,
    newValue,
    ipAddress: options.ipAddress
  });
}

function writeCompliance(db, eventType, severity, message, entityType, entityId) {
  logComplianceEvent(db, { eventType, severity, message, entityType, entityId });
}

function calculateCartTotal(lines) {
  return lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.quantity || line.qty || 0), 0);
}

function calculateOrderTotal(db, orderId) {
  const rows = db.prepare(`
    SELECT oi.quantity, i.price
    FROM order_items oi
    JOIN items i ON oi.item_id = i.id
    WHERE oi.order_id = ?
  `).all(orderId);

  return rows.reduce((sum, r) => sum + r.quantity * r.price, 0);
}

function getSettingNumber(db, key, fallback) {
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key)
    || db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const value = Number(row?.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getConfigValue(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key);
  return row ? String(row.value ?? '') : String(fallback ?? '');
}

function getBooleanConfig(db, key, fallback = false) {
  const value = getConfigValue(db, key, fallback ? '1' : '0');
  return value === '1' || value === 'true';
}

function getNumberConfig(db, key, fallback = 0) {
  const value = Number(getConfigValue(db, key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function getAllSettings(db) {
  seedDefaultSettings(db);
  const settings = { ...DEFAULT_SYSTEM_SETTINGS };
  db.prepare('SELECT key, value FROM system_config').all().forEach((row) => {
    settings[row.key] = row.value ?? '';
  });
  return settings;
}

function setConfigValues(db, settings) {
  const setValue = db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  Object.entries(settings).forEach(([key, value]) => setValue.run(key, String(value ?? '')));
}

const DEFAULT_ENABLED_MODULES = [
  'INVENTORY',
  'KDS',
  'LOYALTY',
  'QR_ORDERING',
  'RESERVATIONS',
  'CLOUD_REPORTING',
  'MULTI_BRANCH',
  'WHITE_LABEL'
];

function enabledModules(db) {
  const raw = getConfigValue(db, 'enabled_modules', '');
  if (!raw) return DEFAULT_ENABLED_MODULES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((code) => String(code).toUpperCase()) : DEFAULT_ENABLED_MODULES;
  } catch (_) {
    return String(raw).split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
  }
}

function moduleEnabled(db, moduleCode) {
  return enabledModules(db).includes(String(moduleCode).toUpperCase());
}

function requireModule(db, moduleCode) {
  if (!moduleEnabled(db, moduleCode)) {
    const err = new Error('Module not enabled for this restaurant');
    err.status = 403;
    throw err;
  }
}

function cacheEnabledModules(db, modules) {
  if (Array.isArray(modules)) {
    setConfigValues(db, { enabled_modules: JSON.stringify(modules.map((code) => String(code).toUpperCase())) });
  }
}

function moduleGate(moduleCode) {
  return (req, res, next) => {
    const restaurantId = req.method === 'GET' ? req.query.restaurantId : req.body?.restaurantId;
    if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
    const db = openRestaurantDatabase(restaurantId);
    try {
      requireModule(db, moduleCode);
      next();
    } catch (err) {
      sendError(res, err);
    } finally {
      db.close();
    }
  };
}

async function trackModuleUsage(restaurantId, moduleCode, usageType, usageCount = 1) {
  const saasUrl = process.env.SAAS_URL;
  if (!saasUrl || !restaurantId) return;
  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    const syncToken = getConfigValue(db, 'cloud_sync_token', '');
    const license = db.prepare('SELECT license_key FROM license_status WHERE restaurant_id = ? ORDER BY last_checked DESC LIMIT 1').get(restaurantId);
    if (!syncToken && !license?.license_key) return;
    await axios.post(`${saasUrl.replace(/\/$/, '')}/modules/usage`, {
      restaurantId,
      syncToken: syncToken || null,
      licenseKey: license?.license_key || null,
      moduleCode,
      usageType,
      usageCount
    }, { timeout: 3000 });
  } catch (_) {
    // Usage tracking is best effort and must never block offline POS operations.
  } finally {
    if (db) db.close();
  }
}

function insertElectronicJournal(db, type, orderId, snapshot) {
  const amount = Number(snapshot?.payable || snapshot?.total_amount || snapshot?.total || 0);
  const result = db.prepare(`
    INSERT INTO electronic_journal (journal_type, order_id, invoice_no, kot_id, amount, snapshot)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, orderId || null, snapshot?.invoiceNo || snapshot?.invoice_no || null, snapshot?.kotId || null, amount, JSON.stringify(snapshot || {}));
  return result.lastInsertRowid;
}

function createFraudAlert(db, alertType, severity, entityType, entityId, message) {
  const existing = db.prepare(`
    SELECT id FROM fraud_alerts
    WHERE alert_type = ? AND entity_type = ? AND entity_id = ? AND status = 'OPEN'
    LIMIT 1
  `).get(alertType, entityType, entityId || null);
  if (existing) return existing.id;
  return db.prepare(`
    INSERT INTO fraud_alerts (alert_type, severity, entity_type, entity_id, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(alertType, severity || 'MEDIUM', entityType || null, entityId || null, message).lastInsertRowid;
}

function evaluateOrderFraud(db, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return;
  const discountThreshold = getNumberConfig(db, 'fraud_large_discount_threshold', 500);
  if (Number(order.loyalty_discount || 0) >= discountThreshold) {
    createFraudAlert(db, 'LARGE_DISCOUNT', 'HIGH', 'ORDER', orderId, `Large discount on order #${orderId}`);
  }
}

function queueNotification(db, eventType, channel, recipient, payload) {
  db.prepare(`
    INSERT INTO notification_logs (event_type, channel, recipient, payload, status)
    VALUES (?, ?, ?, ?, 'QUEUED')
  `).run(eventType, channel || 'SMS', recipient || null, JSON.stringify(payload || {}));
}

const SETTINGS_BOOLEAN_KEYS = new Set([
  'allow_non_invoice_orders',
  'allow_discount',
  'allow_manual_price_override',
  'allow_refund',
  'allow_order_cancel',
  'require_manager_pin_for_discount',
  'require_manager_pin_for_refund',
  'require_manager_pin_for_void',
  'show_tax_on_bill',
  'show_qr_on_bill',
  'service_charge_enabled',
  'round_off_enabled',
  'auto_print_kot',
  'print_kot_on_save',
  'print_kot_on_submit',
  'allow_kot_reprint',
  'backup_enabled',
  'require_clock_in_before_order',
  'require_open_register_for_cash_payment',
  'allow_cashier_register_close'
]);

app.use('/inventory', moduleGate('INVENTORY'));
app.use('/purchase-orders', moduleGate('INVENTORY'));
app.use('/supplier-payments', moduleGate('INVENTORY'));
app.use('/kds', moduleGate('KDS'));
app.use('/customers', moduleGate('LOYALTY'));
app.use('/loyalty', moduleGate('LOYALTY'));
app.use('/members', moduleGate('LOYALTY'));
app.use('/qr', moduleGate('QR_ORDERING'));
app.use('/reservations', moduleGate('RESERVATIONS'));
app.use('/cloud-sync', moduleGate('CLOUD_REPORTING'));

const SETTINGS_PERCENT_KEYS = new Set(['service_charge_percent']);

function normaliseSettingsInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Settings are required');
  }
  const allowed = new Set(Object.keys(DEFAULT_SYSTEM_SETTINGS));
  const output = {};
  Object.entries(input).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (SETTINGS_BOOLEAN_KEYS.has(key)) {
      if (![true, false, 'true', 'false', '1', '0', 1, 0].includes(value)) {
        throw new Error(`${key} must be true or false`);
      }
      output[key] = value === true || value === 'true' || value === 1 || value === '1' ? '1' : '0';
      return;
    }
    if (SETTINGS_PERCENT_KEYS.has(key)) {
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error(`${key} must be between 0 and 100`);
      }
      output[key] = String(percent);
      return;
    }
    if (key === 'backup_interval_minutes') {
      const interval = Number(value);
      if (!Number.isInteger(interval) || interval < 1) throw new Error('Backup interval must be a positive whole number');
      output[key] = String(interval);
      return;
    }
    if (key === 'cash_discrepancy_threshold') {
      const threshold = Number(value);
      if (!Number.isFinite(threshold) || threshold < 0) throw new Error('Cash discrepancy threshold must be numeric and >= 0');
      output[key] = String(threshold);
      return;
    }
    if (key === 'invoice_reset_frequency') {
      const frequency = normaliseText(value).toUpperCase();
      if (!['DAILY', 'MONTHLY', 'YEARLY', 'NEVER'].includes(frequency)) throw new Error('Invoice reset frequency is invalid');
      output[key] = frequency;
      return;
    }
    if (key === 'default_order_type') {
      output[key] = normaliseOrderType(value);
      return;
    }
    output[key] = normaliseText(value);
  });
  if (Object.prototype.hasOwnProperty.call(output, 'currency') && !hasText(output.currency)) throw new Error('Currency is required');
  if (Object.prototype.hasOwnProperty.call(output, 'timezone') && !hasText(output.timezone)) throw new Error('Timezone is required');
  if (Object.prototype.hasOwnProperty.call(output, 'invoice_prefix') && !hasText(output.invoice_prefix)) throw new Error('Invoice prefix is required');
  if (output.backup_enabled === '1' && !hasText(output.backup_folder_path)) throw new Error('Backup folder is required when backup is enabled');
  if (Object.keys(output).length === 0) throw new Error('No valid settings provided');
  return output;
}

function serviceChargeForAmount(db, amount) {
  if (!getBooleanConfig(db, 'service_charge_enabled', false)) return 0;
  const percent = getNumberConfig(db, 'service_charge_percent', 0);
  return Math.max(Number(amount || 0) * percent / 100, 0);
}

function applyRoundOff(db, amount) {
  return getBooleanConfig(db, 'round_off_enabled', true) ? Math.round(Number(amount || 0)) : Number(amount || 0);
}

function invoiceNumberForOrder(db, orderId) {
  const prefix = getConfigValue(db, 'invoice_prefix', 'INV') || 'INV';
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(orderId).padStart(5, '0')}`;
}

function canUseCashRegister(role) {
  return ['CASHIER', 'MANAGER_1', 'MANAGER_2', 'OWNER'].includes(role);
}

function canViewStaffReports(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER_2'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'reports.view_all');
  } finally {
    db.close();
  }
}

function currentAttendance(db, userId) {
  if (!isPositiveId(userId)) return null;
  return db.prepare("SELECT * FROM staff_attendance WHERE user_id = ? AND status = 'OPEN' ORDER BY id DESC LIMIT 1").get(userId);
}

function currentCashSession(db) {
  return db.prepare("SELECT * FROM cash_register_sessions WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();
}

function expectedCashForSession(db, sessionId) {
  const session = db.prepare('SELECT opening_cash FROM cash_register_sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('Cash register session not found');
  const cashPayments = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE cash_register_session_id = ? AND payment_mode = 'CASH'
  `).get(sessionId).total || 0;
  const movements = db.prepare(`
    SELECT type, COALESCE(SUM(amount), 0) AS total
    FROM cash_drawer_movements
    WHERE session_id = ?
    GROUP BY type
  `).all(sessionId).reduce((sum, row) => {
    if (['CASH_IN', 'ADJUSTMENT'].includes(row.type)) return sum + Number(row.total || 0);
    if (['CASH_OUT', 'PAYOUT'].includes(row.type)) return sum - Number(row.total || 0);
    return sum;
  }, 0);
  return Number(session.opening_cash || 0) + Number(cashPayments || 0) + movements;
}

function activeCashSessionForPayment(db, actor, payments) {
  const hasCash = payments.some((payment) => payment.method === 'CASH' || payment.paymentMode === 'CASH');
  if (!hasCash) return null;
  const session = currentCashSession(db);
  if (session) return session.id;
  if (getBooleanConfig(db, 'require_open_register_for_cash_payment', true) && !['OWNER', 'MANAGER_2'].includes(actor?.role)) {
    throw new Error('Open cash register is required before cash payment');
  }
  return null;
}

function requireClockInIfConfigured(db, actor) {
  if (!getBooleanConfig(db, 'require_clock_in_before_order', false)) return;
  if (!isPositiveId(actor?.id)) throw new Error('Clock-in is required before order actions');
  if (!currentAttendance(db, actor.id)) throw new Error('Please clock in before creating or editing orders');
}

function canRole(db, role, permissionCode) {
  return hasPermission(db, role, permissionCode);
}

function requirePermission(db, role, permissionCode, message = 'Permission denied') {
  if (!canRole(db, role, permissionCode)) {
    const err = new Error(message);
    err.status = 403;
    throw err;
  }
}

function localIpAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

function cleanupExpiredLocks(db) {
  db.prepare("DELETE FROM order_locks WHERE DATETIME(expires_at) <= DATETIME('now')").run();
}

function lockExpirySql() {
  return "DATETIME('now', '+2 minutes')";
}

function currentLockForTable(db, tableId) {
  cleanupExpiredLocks(db);
  return db.prepare(`
    SELECT ol.*, u.name AS locked_by_name, u.role AS locked_by_role
    FROM order_locks ol
    LEFT JOIN users u ON u.id = ol.locked_by_user_id
    WHERE ol.table_id = ?
    LIMIT 1
  `).get(tableId);
}

function touchDeviceSession(db, actor, req, deviceName) {
  if (!isPositiveId(actor?.id)) return null;
  const ip = requestIp(req);
  const existing = db.prepare(`
    SELECT id FROM device_sessions
    WHERE user_id = ? AND ip_address = ? AND active = 1
    ORDER BY id DESC LIMIT 1
  `).get(actor.id, ip);
  if (existing) {
    db.prepare('UPDATE device_sessions SET last_seen_at = CURRENT_TIMESTAMP, device_name = COALESCE(?, device_name) WHERE id = ?')
      .run(normaliseText(deviceName) || null, existing.id);
    return existing.id;
  }
  const result = db.prepare('INSERT INTO device_sessions (user_id, device_name, ip_address) VALUES (?, ?, ?)')
    .run(actor.id, normaliseText(deviceName) || null, ip);
  return result.lastInsertRowid;
}

function verifyOrderLock(db, actor, tableId, orderId, lockId) {
  if (!isPositiveId(tableId) || !isPositiveId(actor?.id)) return;
  const lock = currentLockForTable(db, tableId);
  if (!lock) throw new Error('Table lock expired. Please reopen the table.');
  if (Number(lock.locked_by_user_id) !== Number(actor.id) || (lockId && Number(lock.id) !== Number(lockId))) {
    throw new Error(`Table currently being edited by ${lock.locked_by_name || 'another user'}`);
  }
  if (orderId && lock.order_id && Number(lock.order_id) !== Number(orderId)) {
    throw new Error('Order lock does not match this order');
  }
  db.prepare(`UPDATE order_locks SET order_id = COALESCE(?, order_id), locked_at = CURRENT_TIMESTAMP, expires_at = ${lockExpirySql()} WHERE id = ?`)
    .run(orderId || null, lock.id);
}

function customerLoyaltyBalance(db, customerId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'EARN' OR type = 'ADJUSTMENT' THEN points WHEN type = 'REDEEM' THEN -points ELSE 0 END), 0) AS balance
    FROM loyalty_points
    WHERE customer_id = ?
  `).get(customerId);
  return Number(row?.balance || 0);
}

function customerWithBalance(db, customer) {
  if (!customer) return null;
  return { ...customer, loyaltyBalance: customerLoyaltyBalance(db, customer.id) };
}

function memberIdForCustomer(db, customerId) {
  const customer = db.prepare('SELECT name, phone FROM customers WHERE id = ?').get(customerId);
  if (!customer) return null;
  const existing = db.prepare('SELECT id FROM members WHERE phone = ? LIMIT 1').get(customer.phone);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO members (name, phone) VALUES (?, ?)').run(customer.name, customer.phone).lastInsertRowid;
}


// ========================
// HEALTH CHECK
// ========================
app.get('/', (req, res) => {
  res.send('POS backend is running');
});

// ========================
// ACTIVATE POS
// ========================
app.post('/activate', async (req, res) => {
  const { restaurantId, licenseKey } = req.body;

  if (!restaurantId || !licenseKey) {
    return res.status(400).json({
      success: false,
      message: 'restaurantId and licenseKey required'
    });
  }

  try {
    // Call SaaS license validation
    const response = await axios.post(
      process.env.SAAS_URL + '/license/validate',
      { restaurantId, licenseKey }
    );

    if (!response.data.valid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid license'
      });
    }

    // If valid → create local DB
setupDatabase(restaurantId);
const db = openRestaurantDatabase(restaurantId);

db.prepare(`
  INSERT OR REPLACE INTO license_status
  (restaurant_id, license_key, last_checked, expires_at, status)
  VALUES (?, ?, datetime('now'), ?, 'ACTIVE')
`).run(
  restaurantId,
  licenseKey,
  response.data.expiresAt
);

if (response.data.syncToken) {
  setConfigValues(db, { cloud_sync_token: response.data.syncToken });
}
cacheEnabledModules(db, response.data.enabledModules);

db.close();
    res.json({
      success: true,
      message: 'POS activated successfully',
      restaurantId
    });

    

  } catch (err) {
  console.error('ACTIVATION ERROR FULL:', err);

  res.status(500).json({
    success: false,
    message: err.message
  });
}
});

// ========================
// LOGIN
// ========================
app.post('/login', (req, res) => {

  const { restaurantId, username, pin } = req.body;

  if (!restaurantId || !username || !pin) {
    return res.status(400).json({
      success: false,
      message: 'Missing login details'
    });
  }

  const db = openRestaurantDatabase(restaurantId);

  // 🔹 FIRST get the user
  const user = db.prepare(`
    SELECT id, name, username, pin, pin_hash, role
    FROM users
    WHERE username = ? AND active = 1
  `).get(username);

  const pinMatches = user && (
    (user.pin_hash && bcrypt.compareSync(pin, user.pin_hash)) ||
    (!user.pin_hash && user.pin === pin)
  );

  if (pinMatches && !user.pin_hash) {
    db.prepare(`
      UPDATE users
      SET pin = '', pin_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(bcrypt.hashSync(pin, 10), user.id);
  }

  // 🔹 If no user
  if (!pinMatches) {
    writeAudit(db, { role: 'UNKNOWN' }, 'FAILED_LOGIN', 'USER', null, null, { username }, { restaurantId, ipAddress: requestIp(req) });
    writeCompliance(db, 'FAILED_LOGIN', 'MEDIUM', `Failed login for ${username}`, 'USER', null);
    db.close();
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  // 🔹 Force password change for default admin
  const publicUser = { id: user.id, name: user.name, username: user.username, role: user.role };

  if (user.username === "admin" && pin === "1234") {
    db.close();
    return res.json({
      success: true,
      forcePasswordChange: true,
      user: publicUser
    });
  }

  // 🔹 Normal login
  res.json({
    success: true,
    user: publicUser
  });
  db.close();

});

// ========================
// CREATE USER (OWNER / MANAGER_2)
// ========================
app.post('/users/create', (req, res) => {
  const { restaurantId, creatorRole, name, username, pin, role } = req.body;

  if (!restaurantId || !creatorRole || !name || !username || !pin || !role) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  if (!hasPermission(creatorRole, 'createUser')) {
    return res.status(403).json({
      success: false,
      message: 'Permission denied',
    });
  }

  if (!isValidPin(pin)) {
    return res.status(400).json({
      success: false,
      message: 'PIN must be exactly 4 digits',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      INSERT INTO users (name, username, pin, pin_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, username, '', bcrypt.hashSync(pin, 10), role);

    db.close();
    res.json({
      success: true,
      message: 'User created successfully',
    });
  } catch (err) {
    db.close();
    res.status(500).json({
      success: false,
      message: 'Username already exists or DB error',
    });
  }
});

// ========================
// DEBUG
// ========================
app.post('/debug', (req, res) => {
  res.json({
    success: true,
    message: 'DEBUG route is working',
  });
});

// ========================
// SECURE TEST
// ========================
app.post('/secure-test', (req, res) => {
  const { role } = req.body;

  if (!hasPermission(role, 'createUser')) {
    return res.status(403).json({
      success: false,
      message: 'Permission denied',
    });
  }

  res.json({
    success: true,
    message: 'You are allowed to create users',
  });
});

// ========================
// CREATE KITCHEN
// ========================
app.post('/kitchens/create', (req, res) => {
  const { restaurantId, creatorRole, name, printerName } = req.body;

  if (!restaurantId || !creatorRole || !name) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  if (!hasPermission(creatorRole, 'createUser')) {
    return res.status(403).json({
      success: false,
      message: 'Permission denied',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      INSERT INTO kitchens (name, printer_name)
      VALUES (?, ?)
    `).run(name, printerName || null);

    db.close();
    res.json({
      success: true,
      message: 'Kitchen created successfully',
    });
  } catch (err) {
    db.close();
    res.status(500).json({
      success: false,
      message: 'DB error',
    });
  }
});

// ========================
// LIST KITCHENS
// ========================
app.get('/kitchens/list', (req, res) => {

  const { restaurantId, includeInactive } = req.query;

  if (!restaurantId) {
    return res.status(400).json({
      success: false,
      message: "restaurantId required"
    });
  }

  const db = openDatabase(restaurantId);

  try {

    const kitchens = db.prepare(`
      SELECT id, name, printer_name
      FROM kitchens
      WHERE (? = 'true' OR active = 1)
      ORDER BY name
    `).all(includeInactive);

    db.close();

    res.json({
      success: true,
      kitchens
    });

  } catch (err) {

    db.close();

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});


app.post('/items/delete',(req,res)=>{

const { restaurantId,itemId } = req.body

const db=openDatabase(restaurantId)

db.prepare(`
UPDATE items
SET active=0
WHERE id=?
`).run(itemId)

db.close()

res.json({success:true})

})


app.post('/items/update',(req,res)=>{

const { restaurantId,itemId,name,price } = req.body

const db=openDatabase(restaurantId)

db.prepare(`
UPDATE items
SET name=?,price=?
WHERE id=?
`).run(name,price,itemId)

db.close()

res.json({success:true})

})


// ========================
// CREATE CATEGORY
// ========================
app.post('/categories/create', (req, res) => {
  const { restaurantId, creatorRole, name, kitchenId } = req.body;

  if (!restaurantId || !creatorRole || !name || !kitchenId) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  // OWNER / MANAGER_2 only
  if (!hasPermission(creatorRole, 'createUser')) {
    return res.status(403).json({
      success: false,
      message: 'Permission denied',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      INSERT INTO categories (name, kitchen_id)
      VALUES (?, ?)
    `).run(name, kitchenId);

    db.close();
    res.json({
      success: true,
      message: 'Category created successfully',
    });
  } catch (err) {
    db.close();
    res.status(500).json({
      success: false,
      message: 'DB error',
    });
  }
});


// ========================
// CREATE ITEM
// ========================
app.post('/items/create', (req, res) => {
  const {
    restaurantId,
    creatorRole,
    name,
    categoryId,
    price,
    isVeg,
    allowParcel
  } = req.body;

  if (!restaurantId || !creatorRole || !name || !categoryId || price == null) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  // OWNER / MANAGER_2 only
  if (!hasPermission(creatorRole, 'createUser')) {
    return res.status(403).json({
      success: false,
      message: 'Permission denied',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      INSERT INTO items (name, category_id, price, is_veg, allow_parcel)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      name,
      categoryId,
      price,
      isVeg ? 1 : 0,
      allowParcel === false ? 0 : 1
    );

    db.close();
    res.json({
      success: true,
      message: 'Item created successfully',
    });
  } catch (err) {
    console.error('ITEM CREATE ERROR:', err.message);
    db.close();
    
    res.status(500).json({
      success: false,
       message: err.message,
    });
  }
});

// ========================
// CREATE ORDER
// ========================
app.post('/orders/create', (req, res) => {
  const {
    restaurantId,
    orderType,
    tableNo,
    tableNumber,
    createdBy,
    paidAmount,
    items
  } = req.body;

  if (!restaurantId || !Array.isArray(items)) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  if (items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Order must contain at least one item',
    });
  }

  if (items.some((line) => !isPositiveId(line.itemId || line.id) || !Number.isInteger(Number(line.qty || line.quantity || 1)) || Number(line.qty || line.quantity || 1) <= 0)) {
    return res.status(400).json({
      success: false,
      message: 'Items must contain valid item IDs and quantities',
    });
  }

  const db = openRestaurantDatabase(restaurantId);

  try {
    db.transaction(() => {
      // 1️⃣ Create order
      const orderResult = db.prepare(`
        INSERT INTO orders (order_type, table_no, status, paid_amount, payment_status, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        orderType || 'DINE_IN',
        tableNo || tableNumber || null,
        'OPEN',
        paidAmount || 0,
        paidAmount ? 'PAID' : 'UNPAID',
        createdBy
      );

      const orderId = orderResult.lastInsertRowid;
      let totalAmount = 0;

      // 2️⃣ Process items
      for (const line of items) {
        const item = db.prepare(`
          SELECT i.id, i.price, c.kitchen_id
          FROM items i
          JOIN categories c ON i.category_id = c.id
          WHERE i.id = ?
        `).get(line.itemId || line.id);

        if (!item) {
          throw new Error(`Invalid itemId ${line.itemId || line.id}`);
        }

        db.prepare(`
          INSERT INTO order_items (order_id, item_id, quantity, kitchen_id, price)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          orderId,
          item.id,
          line.qty || line.quantity || 1,
          item.kitchen_id,
          item.price
        );

        totalAmount += item.price * Number(line.qty || line.quantity || 1);

      }

      db.prepare('UPDATE orders SET total_amount = ? WHERE id = ?').run(totalAmount, orderId);
      createKotJobs(db, orderId);

      res.json({
        success: true,
        message: 'Order created successfully',
        orderId
      });
    })();
  } catch (err) {
    console.error('ORDER CREATE ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// GET KOTs FOR AN ORDER
// ========================
app.get('/orders/:orderId/kots', (req, res) => {
  const { orderId } = req.params;
  const { restaurantId } = req.query;

  if (!orderId || !restaurantId) {
    return res.status(400).json({
      success: false,
      message: 'orderId and restaurantId are required',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    // 1️⃣ Fetch order
    const order = db.prepare(`
      SELECT id, order_type, table_no, created_at
      FROM orders
      WHERE id = ?
    `).get(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // 2️⃣ Fetch items grouped by kitchen
    const rows = db.prepare(`
      SELECT
        oi.kitchen_id,
        k.name AS kitchen_name,
        i.name AS item_name,
        oi.quantity
      FROM order_items oi
      JOIN kitchens k ON oi.kitchen_id = k.id
      JOIN items i ON oi.item_id = i.id
      WHERE oi.order_id = ?
      ORDER BY k.id
    `).all(orderId);

    // 3️⃣ Group into KOTs
    const kots = {};

    for (const row of rows) {
      if (!kots[row.kitchen_id]) {
        kots[row.kitchen_id] = {
          kitchenId: row.kitchen_id,
          kitchenName: row.kitchen_name,
          orderId: order.id,
          orderType: order.order_type,
          tableNo: order.table_no,
          createdAt: order.created_at,
          items: []
        };
      }

      kots[row.kitchen_id].items.push({
        name: row.item_name,
        qty: row.quantity
      });
    }

    res.json({
      success: true,
      kots: Object.values(kots)
    });

  } catch (err) {
    console.error('KOT FETCH ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// APPLY DISCOUNT
// ========================
app.post('/orders/apply-discount', (req, res) => {
  const {
    restaurantId,
    orderId,
    type,        // MEMBERSHIP | PROMO | MANUAL
    value,
    valueType,   // PERCENT | FLAT
    appliedByRole,
    promoCode
  } = req.body;

  if (!restaurantId || !orderId || !type || !value || !valueType || !appliedByRole) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  if (!['OWNER', 'MANAGER_2'].includes(appliedByRole)) {
    return res.status(403).json({
      success: false,
      message: 'Only Manager 2 or Owner can apply discounts',
    });
  }

  const db = openRestaurantDatabase(restaurantId);

  try {
    if (!getBooleanConfig(db, 'allow_discount', true)) throw new Error('Discounts are disabled in settings');
    const order = db.prepare(`
      SELECT payment_status FROM orders WHERE id = ?
    `).get(orderId);

    if (!order || order.payment_status === 'PAID') {
      throw new Error('Order already paid or not found');
    }

    // Promo validation
    if (type === 'PROMO') {
      const promo = db.prepare(`
        SELECT * FROM promo_codes WHERE code = ? AND active = 1
      `).get(promoCode);

      if (!promo) {
        throw new Error('Invalid promo code');
      }
    }

    db.prepare(`
      INSERT INTO discounts (order_id, type, value, value_type, applied_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(orderId, type, value, valueType, appliedByRole);

    // Recalculate total
    const gross = calculateOrderTotal(db, orderId);

    const discounts = db.prepare(`
      SELECT value, value_type FROM discounts WHERE order_id = ?
    `).all(orderId);

    let totalDiscount = 0;

    for (const d of discounts) {
      totalDiscount += d.value_type === 'PERCENT'
        ? (gross * d.value / 100)
        : d.value;
    }

    const net = Math.max(gross - totalDiscount, 0);

    db.prepare(`
      UPDATE orders SET total_amount = ? WHERE id = ?
    `).run(net, orderId);

    writeAudit(db, actorFromRole(appliedByRole), 'APPLY', 'DISCOUNT', orderId, null, {
      orderId,
      type,
      value,
      valueType,
      discountAmount: totalDiscount
    }, { restaurantId });
    if (type === 'MANUAL') {
      writeCompliance(db, 'MANUAL_DISCOUNT', 'MEDIUM', `Manual discount applied to order #${orderId}`, 'ORDER', orderId);
    }

    res.json({
      success: true,
      grossAmount: gross,
      discountAmount: totalDiscount,
      netPayable: net
    });

  } catch (err) {
    console.error('DISCOUNT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// ADD PAYMENT
// ========================
app.post('/orders/pay', (req, res) => {
  const {
    restaurantId,
    orderId,
    paymentMode,     // CASH | UPI | OWNER_FUND
    amount,          // amount being paid
    cashGiven,       // only for CASH
    ownerId,         // only for OWNER_FUND
    referenceNo      // UPI ref or note
  } = req.body;

  if (!restaurantId || !orderId || !paymentMode || !amount) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  const db = openRestaurantDatabase(restaurantId);

  try {
    db.transaction(() => {
      const order = db.prepare(`
        SELECT total_amount, paid_amount, payment_status
        FROM orders WHERE id = ?
      `).get(orderId);

      if (!order) throw new Error('Order not found');
      if (order.payment_status === 'PAID') throw new Error('Order already paid');

      const newPaidTotal = order.paid_amount + amount;

      if (newPaidTotal > order.total_amount) {
        throw new Error('Payment exceeds payable amount');
      }
      const cashRegisterSessionId = activeCashSessionForPayment(db, actorFromRole(null), [{ method: paymentMode }]);

      // Record payment
      const paymentResult = db.prepare(`
        INSERT INTO payments (order_id, payment_mode, amount, owner_id, reference_no, cash_register_session_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        paymentMode,
        amount,
        ownerId || null,
        referenceNo || null,
        paymentMode === 'CASH' ? cashRegisterSessionId : null
      );
      writeAudit(db, actorFromRole(null), 'CREATE', 'PAYMENT', paymentResult.lastInsertRowid, null, {
        orderId,
        paymentMode,
        amount,
        cashRegisterSessionId: paymentMode === 'CASH' ? cashRegisterSessionId : null,
        referenceNo: referenceNo || null
      }, { restaurantId });

      // Update order payment status
      let paymentStatus = 'PARTIAL';
      if (newPaidTotal === order.total_amount) {
        paymentStatus = 'PAID';
      }

      db.prepare(`
        UPDATE orders
        SET paid_amount = ?, payment_status = ?, status = ?
        WHERE id = ?
      `).run(
        newPaidTotal,
        paymentStatus,
        paymentStatus === 'PAID' ? 'PAID' : 'OPEN',
        orderId
      );

      // Cash change calculation
      let change = 0;
      if (paymentMode === 'CASH' && cashGiven) {
        change = Math.max(cashGiven - amount, 0);
      }

      res.json({
        success: true,
        message: 'Payment recorded',
        paidAmount: newPaidTotal,
        paymentStatus,
        change
      });
    })();
  } catch (err) {
    console.error('PAYMENT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// PROCESS REFUND
// ========================
app.post('/orders/refund', (req, res) => {
  const {
    restaurantId,
    orderId,
    paymentId,
    amount,
    refundMode,     // CASH | UPI | OWNER_FUND
    reason,
    refundedByRole
  } = req.body;

  if (!restaurantId || !orderId || !amount || !refundMode || !refundedByRole) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  const db = openRestaurantDatabase(restaurantId);

  try {
    requirePermission(db, refundedByRole, 'billing.refund', 'Refund permission required');
    if (!getBooleanConfig(db, 'allow_refund', true)) throw new Error('Refunds are disabled in settings');
    db.transaction(() => {
      const order = db.prepare(`
        SELECT total_amount, paid_amount
        FROM orders WHERE id = ?
      `).get(orderId);

      if (!order) throw new Error('Order not found');
      if (amount > order.paid_amount) throw new Error('Refund exceeds paid amount');

      // Insert refund record
      db.prepare(`
        INSERT INTO refunds (order_id, payment_id, refund_mode, amount, reason, refunded_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        paymentId || null,
        refundMode,
        amount,
        reason || null,
        refundedByRole
      );

      const newPaidAmount = order.paid_amount - amount;

      let paymentStatus = 'PARTIAL';
      if (newPaidAmount === 0) paymentStatus = 'UNPAID';

      db.prepare(`
        UPDATE orders
        SET paid_amount = ?, payment_status = ?
        WHERE id = ?
      `).run(
        newPaidAmount,
        paymentStatus,
        orderId
      );

      writeAudit(db, actorFromRole(refundedByRole), 'CREATE', 'REFUND', orderId, null, {
        orderId,
        paymentId: paymentId || null,
        amount,
        refundMode,
        reason: reason || null
      }, { restaurantId });
      writeCompliance(db, 'REFUND', 'HIGH', `Refund processed for order #${orderId}`, 'ORDER', orderId);
      createFraudAlert(db, 'REFUND', 'HIGH', 'ORDER', orderId, `Refund processed for order #${orderId}`);

      res.json({
        success: true,
        message: 'Refund processed',
        refundedAmount: amount,
        remainingPaid: newPaidAmount,
        paymentStatus
      });
    })();
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// SALES REPORT (ROLE-BASED)
// ========================
app.get('/reports/sales', (req, res) => {
  const {
    restaurantId,
    role,
    fromDate,
    toDate
  } = req.query;

  if (!restaurantId || !role || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters',
    });
  }

  const visibilityClause = getInvoiceVisibilityClause(role);
  const db = openDatabase(restaurantId);

  try {
    const rows = db.prepare(`
      SELECT
        DATE(o.created_at) as date,
        COUNT(o.id) as orders,
        SUM(o.total_amount) as revenue
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      ${visibilityClause}
      AND o.payment_status = 'PAID'
      GROUP BY DATE(o.created_at)
      ORDER BY DATE(o.created_at)
    `).all(fromDate, toDate);

    res.json({
      success: true,
      role,
      fromDate,
      toDate,
      data: rows
    });

  } catch (err) {
    console.error('REPORT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// DAILY SALES REPORT
// ========================
app.get('/reports/sales/daily', (req, res) => {
  const { restaurantId, role, date } = req.query;

  if (!restaurantId || !role || !date) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters',
    });
  }

  const visibilityClause = getInvoiceVisibilityClause(role);
  const db = openDatabase(restaurantId);

  try {
    const row = db.prepare(`
      SELECT
        COUNT(o.id) as orders,
        SUM(o.total_amount) as revenue
      FROM orders o
      WHERE DATE(o.created_at) = DATE(?)
      ${visibilityClause}
      AND o.payment_status = 'PAID'
    `).get(date);

    res.json({
      success: true,
      date,
      role,
      orders: row.orders || 0,
      revenue: row.revenue || 0
    });

  } catch (err) {
    console.error('DAILY REPORT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// WEEKLY SALES REPORT
// ========================
app.get('/reports/sales/weekly-legacy', (req, res) => {
  const { restaurantId, role, fromDate, toDate } = req.query;

  if (!restaurantId || !role || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters',
    });
  }

  const visibilityClause = getInvoiceVisibilityClause(role);
  const db = openDatabase(restaurantId);

  try {
    const rows = db.prepare(`
      SELECT
        DATE(o.created_at) as date,
        COUNT(o.id) as orders,
        SUM(o.total_amount) as revenue
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      ${visibilityClause}
      AND o.payment_status = 'PAID'
      GROUP BY DATE(o.created_at)
      ORDER BY DATE(o.created_at)
    `).all(fromDate, toDate);

    res.json({
      success: true,
      role,
      fromDate,
      toDate,
      data: rows
    });

  } catch (err) {
    console.error('WEEKLY REPORT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// WEEKLY SALES REPORT
// ========================
app.get('/reports/sales/weekly', (req, res) => {
  const { restaurantId, role, fromDate, toDate } = req.query;

  if (!restaurantId || !role || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters',
    });
  }

  const visibilityClause = getInvoiceVisibilityClause(role);
  const db = openDatabase(restaurantId);

  try {
    const rows = db.prepare(`
      SELECT
        DATE(o.created_at) as date,
        COUNT(o.id) as orders,
        SUM(o.total_amount) as revenue
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      ${visibilityClause}
      AND o.payment_status = 'PAID'
      GROUP BY DATE(o.created_at)
      ORDER BY DATE(o.created_at)
    `).all(fromDate, toDate);

    res.json({
      success: true,
      role,
      fromDate,
      toDate,
      data: rows
    });

  } catch (err) {
    console.error('WEEKLY REPORT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// TAX OPTIMISED REVENUE
// ========================
app.get('/reports/revenue/tax', (req, res) => {
  const {
    restaurantId,
    role,
    fromDate,
    toDate
  } = req.query;

  if (!restaurantId || !role || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters',
    });
  }

  const taxVisibilityClause = getTaxVisibilityClause(role);
  const db = openDatabase(restaurantId);

  try {
    const row = db.prepare(`
      SELECT
        COUNT(o.id) as orders,
        SUM(o.total_amount) as revenue
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
        AND o.payment_status = 'PAID'
        ${taxVisibilityClause}
    `).get(fromDate, toDate);

    res.json({
      success: true,
      role,
      fromDate,
      toDate,
      taxOptimisedRevenue: row.revenue || 0,
      ordersCount: row.orders || 0
    });

  } catch (err) {
    console.error('TAX REPORT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// ADD EXPENSE
// ========================
app.post('/expenses/add', (req, res) => {
  const {
    restaurantId,
    expenseType,
    description,
    amount,
    expenseDate,
    createdByRole
  } = req.body;

  if (!restaurantId || !expenseType || !amount || !expenseDate || !createdByRole) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  // Only MANAGER_2 or OWNER
  if (!['OWNER', 'MANAGER_2'].includes(createdByRole)) {
    return res.status(403).json({
      success: false,
      message: 'Not allowed to add expenses',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      INSERT INTO expenses (expense_type, description, amount, expense_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      expenseType,
      description || null,
      amount,
      expenseDate,
      createdByRole
    );

    res.json({
      success: true,
      message: 'Expense added successfully'
    });

  } catch (err) {
    console.error('EXPENSE ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});

// ========================
// EXPENSE SUMMARY
// ========================
app.get('/reports/expenses', (req, res) => {
  const {
    restaurantId,
    fromDate,
    toDate
  } = req.query;

  if (!restaurantId || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    const rows = db.prepare(`
      SELECT
        expense_type,
        SUM(amount) as total
      FROM expenses
      WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
      GROUP BY expense_type
    `).all(fromDate, toDate);

    const totalExpense = rows.reduce((sum, r) => sum + r.total, 0);

    res.json({
      success: true,
      fromDate,
      toDate,
      breakdown: rows,
      totalExpense
    });

  } catch (err) {
    console.error('EXPENSE REPORT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// INCOME vs EXPENSE
// ========================
app.get('/reports/profit', (req, res) => {
  const {
    restaurantId,
    role,
    fromDate,
    toDate
  } = req.query;

  if (!restaurantId || !role || !fromDate || !toDate) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters',
    });
  }

  const taxVisibilityClause = getTaxVisibilityClause(role);
  const db = openDatabase(restaurantId);

  try {
    const incomeRow = db.prepare(`
      SELECT SUM(o.total_amount) as income
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
        AND o.payment_status = 'PAID'
        ${taxVisibilityClause}
    `).get(fromDate, toDate);

    const expenseRow = db.prepare(`
      SELECT SUM(amount) as expense
      FROM expenses
      WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
    `).get(fromDate, toDate);

    const income = incomeRow.income || 0;
    const expense = expenseRow.expense || 0;

    res.json({
      success: true,
      role,
      fromDate,
      toDate,
      income,
      expense,
      profit: income - expense
    });

  } catch (err) {
    console.error('PROFIT REPORT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// CHANGE TABLE
// ========================
app.post('/orders/change-table', (req, res) => {
  const {
    restaurantId,
    orderId,
    newTableNo,
    changedByRole
  } = req.body;

  if (!restaurantId || !orderId || !newTableNo || !changedByRole) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  // Waiter, Manager allowed; audit sensitive
  if (!['WAITER', 'MANAGER_1', 'MANAGER_2', 'OWNER'].includes(changedByRole)) {
    return res.status(403).json({
      success: false,
      message: 'Not allowed',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    const order = db.prepare(`
      SELECT id, payment_status FROM orders WHERE id = ?
    `).get(orderId);

    if (!order) throw new Error('Order not found');
    if (order.payment_status === 'PAID') {
      throw new Error('Cannot change table after payment');
    }

    db.prepare(`
      UPDATE orders SET table_no = ? WHERE id = ?
    `).run(newTableNo, orderId);

    res.json({
      success: true,
      message: 'Table updated successfully',
      newTableNo
    });

  } catch (err) {
    console.error('TABLE CHANGE ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// MERGE ORDERS
// ========================
app.post('/orders/merge', (req, res) => {
  const {
    restaurantId,
    sourceOrderId,
    targetOrderId,
    mergedByRole
  } = req.body;

  if (!restaurantId || !sourceOrderId || !targetOrderId || !mergedByRole) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  // Only MANAGER or OWNER
  if (!['MANAGER_1', 'MANAGER_2', 'OWNER'].includes(mergedByRole)) {
    return res.status(403).json({
      success: false,
      message: 'Not allowed to merge orders',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.transaction(() => {
      const source = db.prepare(`
        SELECT payment_status FROM orders WHERE id = ?
      `).get(sourceOrderId);

      const target = db.prepare(`
        SELECT payment_status FROM orders WHERE id = ?
      `).get(targetOrderId);

      if (!source || !target) throw new Error('Order not found');

      if (source.payment_status === 'PAID') {
        throw new Error('Paid order cannot be merged');
      }

      // Move items
      db.prepare(`
        UPDATE order_items
        SET order_id = ?
        WHERE order_id = ?
      `).run(targetOrderId, sourceOrderId);

      // Move payments
      db.prepare(`
        UPDATE payments
        SET order_id = ?
        WHERE order_id = ?
      `).run(targetOrderId, sourceOrderId);

      // Cancel source order
      db.prepare(`
        UPDATE orders SET status = 'CANCELLED' WHERE id = ?
      `).run(sourceOrderId);

      res.json({
        success: true,
        message: 'Orders merged successfully',
        targetOrderId
      });
    });
  } catch (err) {
    console.error('MERGE ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// FETCH PENDING PRINT JOBS
// ========================
app.get('/print-jobs/pending', (req, res) => {
  const { restaurantId } = req.query;

  if (!restaurantId) {
    return res.status(400).json({
      success: false,
      message: 'restaurantId required',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    const jobs = db.prepare(`
      SELECT *
      FROM print_jobs
      WHERE status = 'PENDING'
      ORDER BY created_at
      LIMIT 10
    `).all();

    res.json({
      success: true,
      jobs
    });

  } catch (err) {
    console.error('FETCH PRINT JOBS ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// UPDATE PRINT JOB STATUS
// ========================
app.post('/print-jobs/update', (req, res) => {
  const {
    restaurantId,
    jobId,
    status,      // PRINTED | FAILED
    error
  } = req.body;

  if (!restaurantId || !jobId || !status) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      UPDATE print_jobs
      SET status = ?,
          attempts = attempts + 1,
          last_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, error || null, jobId);

    res.json({
      success: true,
      message: 'Print job updated'
    });

  } catch (err) {
    console.error('PRINT JOB UPDATE ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// RE-PRINT JOB
// ========================
app.post('/print-jobs/reprint', (req, res) => {
  const {
    restaurantId,
    type,        // KOT | BILL
    refId,       // orderId
    kitchenId,
    printerId,
    payload,
    requestedByRole
  } = req.body;

  if (!restaurantId || !type || !refId || !printerId || !payload || !requestedByRole) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
    });
  }

  if (!['MANAGER_1', 'MANAGER_2', 'OWNER'].includes(requestedByRole)) {
    return res.status(403).json({
      success: false,
      message: 'Not allowed to re-print',
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      INSERT INTO print_jobs (type, ref_id, kitchen_id, printer_id, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      type,
      refId,
      kitchenId || null,
      printerId,
      payload
    );

    res.json({
      success: true,
      message: 'Re-print job queued'
    });

  } catch (err) {
    console.error('REPRINT ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    db.close();
  }
});


// ========================
// ADD MEMBER
// ========================
app.post('/members/add', (req, res) => {
  const { restaurantId, name, phone } = req.body;

  if (!restaurantId || !name || !phone) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  const db = openDatabase(restaurantId);

  try {
    db.prepare(`
      INSERT INTO members (name, phone)
      VALUES (?, ?)
    `).run(name, phone);

    res.json({ success: true, message: 'Member added' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Member exists or DB error' });
  } finally {
    db.close();
  }
});

// ========================
// REDEEM LOYALTY POINTS
// ========================
app.post('/orders/redeem-points', (req, res) => {
  const {
    restaurantId,
    orderId,
    memberId,
    points,
    appliedByRole
  } = req.body;

  if (!restaurantId || !orderId || !memberId || !points || !appliedByRole) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  if (!['MANAGER_1', 'MANAGER_2', 'OWNER'].includes(appliedByRole)) {
    return res.status(403).json({ success: false, message: 'Not allowed' });
  }

  const db = openRestaurantDatabase(restaurantId);

  try {
    requireModule(db, 'LOYALTY');
    const balanceRow = db.prepare(`
      SELECT COALESCE(SUM(
        CASE WHEN type='EARN' THEN points ELSE -points END
      ),0) as balance
      FROM loyalty_points
      WHERE member_id = ?
    `).get(memberId);

    if (points > balanceRow.balance) {
      throw new Error('Insufficient points');
    }

    // Add redemption to ledger
    db.prepare(`
      INSERT INTO loyalty_points (member_id, order_id, points, type)
      VALUES (?, ?, ?, 'REDEEM')
    `).run(memberId, orderId, points);

    // Apply as discount (₹ per point)
    db.prepare(`
      INSERT INTO discounts (order_id, type, value, value_type, applied_by)
      VALUES (?, 'MEMBERSHIP', ?, 'FLAT', ?)
    `).run(orderId, points, appliedByRole);

    res.json({
      success: true,
      message: 'Points redeemed',
      redeemedValue: points
    });

  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});




async function checkLicenseDaily(restaurantId) {
  const db = openDatabase(restaurantId);

  db.exec(`
  CREATE TABLE IF NOT EXISTS license_status (
    restaurant_id TEXT PRIMARY KEY,
    license_key TEXT,
    last_checked DATETIME,
    expires_at DATETIME,
    status TEXT
  );
`);

  const row = db.prepare(`
    SELECT * FROM license_status WHERE restaurant_id = ?
  `).get(restaurantId);

  if (!row) {
    db.close();
    return;
  }

  const lastChecked = new Date(row.last_checked);
  const now = new Date();
  const diffHours = (now - lastChecked) / (1000 * 60 * 60);

  if (diffHours < 24) {
    db.close();
    return; // checked within 24h
  }

  try {
    const axios = require('axios');
    const saasUrl = process.env.SAAS_URL;
    if (!saasUrl) {
      console.log('License check skipped (SAAS_URL missing)');
      db.close();
      return;
    }

    const response = await axios.post(
      `${saasUrl.replace(/\/$/, '')}/license/validate`,
      {
        restaurantId: restaurantId,
        licenseKey: row.license_key
      }
    );

    db.prepare(`
      UPDATE license_status
      SET last_checked = datetime('now'),
          expires_at = ?,
          status = ?
      WHERE restaurant_id = ?
    `).run(
      response.data.expiresAt,
      response.data.valid ? 'ACTIVE' : 'EXPIRED',
      restaurantId
    );
    if (response.data.syncToken) {
      setConfigValues(db, { cloud_sync_token: response.data.syncToken });
    }
    cacheEnabledModules(db, response.data.enabledModules);
    if (!response.data.valid) {
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
      writeCompliance(db, 'LICENSE_EXPIRED', 'HIGH', 'License validation failed or expired', 'LICENSE', null);
    }

  } catch (err) {
    console.log('License check skipped (offline)');
  }

  db.close();
}

function getActivatedRestaurant() {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '../data');
  const files = fs.readdirSync(dataDir);

  const dbFiles = files.filter(file => file.startsWith('restaurant_') && file.endsWith('.db'));

  if (dbFiles.length === 0) {
    return null;
  }

  // Only one restaurant per POS machine (as per your design)
  const fileName = dbFiles[0];

const restaurantId = getSingleRestaurantId();

  return restaurantId;
}

setInterval(() => {
  const restaurantId = getSingleRestaurantId();

  if (!restaurantId) {
    console.log('No activated restaurant found');
    return;
  }

  checkLicenseDaily(restaurantId);

}, 6 * 60 * 60 * 1000);

const activeRestaurant = getSingleRestaurantId();
if (activeRestaurant) {
  try {
    const startupDb = openRestaurantDatabase(activeRestaurant);
    startupDb.close();
    checkLicenseDaily(activeRestaurant);
  } catch (err) {
    console.error('Startup migration skipped:', err.message);
  }
}

const path = require('path');
app.use(express.static(path.join(__dirname,'public')));


// ========================
// LIST CATEGORIES
// ========================
app.get('/categories/list', (req, res) => {
  const { restaurantId, includeInactive } = req.query;

  if (!restaurantId) {
    return res.status(400).json({
      success: false,
      message: 'restaurantId required'
    });
  }

  const db = openDatabase(restaurantId);

  try {
    const categories = db.prepare(`
      SELECT id, name
      FROM categories
      WHERE (? = 'true' OR active = 1)
      ORDER BY name
    `).all(includeInactive);

    db.close();

    res.json({
      success: true,
      categories
    });

  } catch (err) {
    db.close();
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// ========================
// LIST ITEMS BY CATEGORY
// ========================
app.get('/items/list', (req, res) => {
  const { restaurantId, categoryId, includeInactive } = req.query;

  if (!restaurantId) {
    return res.status(400).json({
      success: false,
      message: 'restaurantId required'
    });
  }

  const db = openDatabase(restaurantId);

  try {
    const items = categoryId
      ? db.prepare(`
        SELECT id, name, category_id, price
        FROM items
        WHERE category_id = ? AND (? = 'true' OR active = 1)
        ORDER BY name
      `).all(categoryId, includeInactive)
      : db.prepare(`
        SELECT i.id, i.name, i.category_id, i.price, c.name AS category
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id
        WHERE (? = 'true' OR i.active = 1)
        ORDER BY i.name
      `).all(includeInactive);

    db.close();

    res.json({
      success: true,
      items
    });

  } catch (err) {
    db.close();
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// ========================
// CREATE ORDER
// ========================
app.post('/orders/create-basic', (req, res) => {
  const { restaurantId, tableNumber, items, createdBy } = req.body;

  if (!restaurantId || !items || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order data'
    });
  }

  const db = openDatabase(restaurantId);

  try {
    db.exec('BEGIN TRANSACTION');

    // 1️⃣ Create order
    const orderResult = db.prepare(`
      INSERT INTO orders (order_type, table_no, status, created_by)
      VALUES ('DINE_IN', ?, 'OPEN', ?)
    `).run(
      tableNumber || null,
      createdBy || null
    );

    const orderId = orderResult.lastInsertRowid;

    // 2️⃣ Insert items
    items.forEach(item => {
      const menuItem = db.prepare(`
        SELECT i.id, i.price, c.kitchen_id
        FROM items i
        JOIN categories c ON c.id = i.category_id
        WHERE i.id = ?
      `).get(item.id);

      if (!menuItem) {
        throw new Error('Invalid item');
      }

      db.prepare(`
        INSERT INTO order_items (order_id, item_id, quantity, kitchen_id, price)
        VALUES (?, ?, ?, ?, ?)
      `).run(orderId, menuItem.id, item.qty || item.quantity || 1, menuItem.kitchen_id, menuItem.price);
    });

    // 3️⃣ Group items by kitchen
    const kitchenItems = db.prepare(`
      SELECT 
        oi.item_id,
        i.name,
        oi.quantity,
        k.id as kitchen_id,
        k.printer_id
      FROM order_items oi
      JOIN items i ON i.id = oi.item_id
      JOIN categories c ON c.id = i.category_id
      JOIN kitchens k ON k.id = c.kitchen_id
      WHERE oi.order_id = ?
    `).all(orderId);

    const grouped = {};

    kitchenItems.forEach(row => {
      if (!grouped[row.kitchen_id]) {
        grouped[row.kitchen_id] = {
          printer_id: row.printer_id,
          items: []
        };
      }

      grouped[row.kitchen_id].items.push({
        name: row.name,
        quantity: row.quantity
      });
    });

    // 4️⃣ Create KOT print jobs
    Object.keys(grouped).forEach(kitchenId => {
      const data = grouped[kitchenId];

      const payload = {
        orderId,
        tableNumber,
        items: data.items,
        time: new Date().toISOString()
      };

      db.prepare(`
        INSERT INTO print_jobs 
        (type, ref_id, kitchen_id, printer_id, payload, status)
        VALUES ('KOT', ?, ?, ?, ?, 'PENDING')
      `).run(
        orderId,
        kitchenId,
        data.printer_id || 1,
        JSON.stringify(payload)
      );
    });

    db.exec('COMMIT');

    db.close();

    res.json({
      success: true,
      orderId
    });

  } catch (err) {
    db.exec('ROLLBACK');
    db.close();

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.post('/users/change-pin',(req,res)=>{

const { restaurantId, username, newPin } = req.body

if (!restaurantId || !username || !isValidPin(newPin)) {
  return res.status(400).json({
    success: false,
    message: 'restaurantId, username and a 4 digit PIN are required'
  })
}

const db = openDatabase(restaurantId)

db.prepare(`
UPDATE users
SET pin=?, pin_hash=?, updated_at=CURRENT_TIMESTAMP
WHERE username=?
`).run('',bcrypt.hashSync(newPin, 10),username)

db.close()

res.json({success:true})

})

// ========================
// PHASE 1-8 PROFESSIONAL POS MODULES
// ========================
// These routes are additive so older API names stay available while the new admin/POS UI has complete CRUD.

app.get('/admin/bootstrap', (req, res) => {
  const { restaurantId, includeInactive } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      kitchens: db.prepare("SELECT id, name, printer_name, printer_id, active FROM kitchens WHERE (? = 'true' OR active = 1) ORDER BY name").all(includeInactive),
      categories: db.prepare(`
        SELECT c.id, c.name, c.kitchen_id, c.active, k.name AS kitchen_name
        FROM categories c LEFT JOIN kitchens k ON k.id = c.kitchen_id
        WHERE (? = 'true' OR c.active = 1)
        ORDER BY c.name
      `).all(includeInactive),
      items: db.prepare(`
        SELECT i.id, i.name, i.category_id, i.price, i.is_veg, i.allow_parcel, i.active, c.name AS category_name, k.name AS kitchen_name
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id
        LEFT JOIN kitchens k ON k.id = c.kitchen_id
        WHERE (? = 'true' OR i.active = 1)
        ORDER BY i.name
      `).all(includeInactive),
      users: db.prepare("SELECT id, name, username, role, active, created_at FROM users WHERE (? = 'true' OR active = 1) ORDER BY name").all(includeInactive),
      tables: db.prepare("SELECT id, table_name, status, active, created_at FROM tables WHERE (? = 'true' OR active = 1) ORDER BY id").all(includeInactive),
      enabledModules: enabledModules(db)
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/expenses/categories', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, categories: db.prepare('SELECT * FROM expense_categories WHERE active = 1 ORDER BY name').all() });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/expenses/save', (req, res) => {
  const { restaurantId, actor, categoryId, categoryName, description, amount, expenseDate } = req.body;
  if (!restaurantId || !isValidAmount(amount) || Number(amount) <= 0 || !expenseDate) {
    return res.status(400).json({ success: false, message: 'Expense date and positive amount are required' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    if (!['OWNER', 'MANAGER_2'].includes(actor?.role)) {
      throw new Error('Expense management requires OWNER or MANAGER_2');
    }
    requirePermission(db, actor?.role, 'reports.view_all', 'Expense management requires OWNER or MANAGER_2');
    let finalCategoryId = isPositiveId(categoryId) ? Number(categoryId) : null;
    let finalCategoryName = normaliseText(categoryName);
    if (finalCategoryId) {
      const category = db.prepare('SELECT * FROM expense_categories WHERE id = ? AND active = 1').get(finalCategoryId);
      if (!category) throw new Error('Expense category not found');
      finalCategoryName = category.name;
    } else if (hasText(finalCategoryName)) {
      const result = db.prepare('INSERT OR IGNORE INTO expense_categories (name) VALUES (?)').run(finalCategoryName);
      finalCategoryId = result.lastInsertRowid || db.prepare('SELECT id FROM expense_categories WHERE name = ?').get(finalCategoryName).id;
    } else {
      throw new Error('Expense category is required');
    }
    const result = db.prepare(`
      INSERT INTO expenses (expense_type, category_id, description, amount, expense_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(finalCategoryName, finalCategoryId, normaliseText(description), Number(amount), expenseDate, actor?.id || null);
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
    writeAudit(db, actor, 'CREATE', 'EXPENSE', result.lastInsertRowid, null, expense);
    res.json({ success: true, expense });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

function profitDashboard(db, fromDate, toDate) {
  const sales = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) AS sales
    FROM orders
    WHERE payment_status = 'PAID'
      AND COALESCE(status, '') != 'CANCELLED'
      AND DATE(COALESCE(settled_at, created_at)) BETWEEN DATE(?) AND DATE(?)
  `).get(fromDate, toDate).sales || 0;
  const refunds = tableExists(db, 'refunds') ? db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)").get(fromDate, toDate).total || 0 : 0;
  const discounts = tableExists(db, 'discounts') ? db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN UPPER(value_type) IN ('AMOUNT', 'FLAT') THEN value ELSE 0 END), 0) AS total
    FROM discounts
    WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
  `).get(fromDate, toDate).total || 0 : 0;
  const expenses = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)').get(fromDate, toDate).total || 0;
  const byCategory = db.prepare(`
    SELECT COALESCE(ec.name, e.expense_type) AS category, COALESCE(SUM(e.amount), 0) AS total
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE DATE(e.expense_date) BETWEEN DATE(?) AND DATE(?)
    GROUP BY COALESCE(ec.name, e.expense_type)
    ORDER BY total DESC
  `).all(fromDate, toDate);
  return { sales, refunds, discounts, expenses, profit: Number(sales) - Number(refunds) - Number(discounts) - Number(expenses), byCategory };
}

app.get('/reports/profit-dashboard', (req, res) => {
  const { restaurantId, role, fromDate, toDate } = req.query;
  if (!restaurantId || !fromDate || !toDate || !['OWNER', 'MANAGER_2'].includes(role)) {
    return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, fromDate, toDate, ...profitDashboard(db, fromDate, toDate) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/reports/profit/export', (req, res) => {
  const { restaurantId, role, fromDate, toDate } = req.query;
  if (!restaurantId || !fromDate || !toDate || !['OWNER', 'MANAGER_2'].includes(role)) {
    return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    const report = profitDashboard(db, fromDate, toDate);
    const rows = [
      ['metric', 'amount'],
      ['sales', report.sales],
      ['refunds', report.refunds],
      ['discounts', report.discounts],
      ['expenses', report.expenses],
      ['profit', report.profit],
      [],
      ['category', 'expense_total'],
      ...report.byCategory.map((row) => [row.category, row.total])
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="profit_report.csv"');
    res.send(rows.map((row) => row.map(csvCell).join(',')).join('\n'));
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/analytics/dashboard', (req, res) => {
  const { restaurantId, fromDate = todayIso(), toDate = todayIso() } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const salesTrend = db.prepare(`
      SELECT DATE(COALESCE(settled_at, created_at)) AS date, SUM(total_amount) AS total, COUNT(*) AS orders
      FROM orders
      WHERE payment_status = 'PAID' AND COALESCE(status, '') != 'CANCELLED'
        AND DATE(COALESCE(settled_at, created_at)) BETWEEN DATE(?) AND DATE(?)
      GROUP BY DATE(COALESCE(settled_at, created_at))
      ORDER BY date
    `).all(fromDate, toDate);
    const peakHours = db.prepare(`
      SELECT STRFTIME('%H', COALESCE(settled_at, created_at)) AS hour, COUNT(*) AS orders, SUM(total_amount) AS sales
      FROM orders
      WHERE payment_status = 'PAID' AND COALESCE(status, '') != 'CANCELLED'
      GROUP BY STRFTIME('%H', COALESCE(settled_at, created_at))
      ORDER BY orders DESC
      LIMIT 8
    `).all();
    const itemRows = db.prepare(`
      SELECT i.name, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.price) AS sales
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN items i ON i.id = oi.item_id
      WHERE o.payment_status = 'PAID' AND COALESCE(o.status, '') != 'CANCELLED'
      GROUP BY i.name
      ORDER BY sales DESC
    `).all();
    const dailyAverage = salesTrend.length ? salesTrend.reduce((sum, row) => sum + Number(row.total || 0), 0) / salesTrend.length : 0;
    const ingredientForecast = db.prepare(`
      SELECT ing.name, ing.unit, ing.current_stock, ing.low_stock_alert,
             COALESCE(SUM(oi.quantity * ri.quantity), 0) AS estimated_daily_usage
      FROM ingredients ing
      LEFT JOIN recipe_items ri ON ri.ingredient_id = ing.id AND ri.active = 1
      LEFT JOIN recipes r ON r.id = ri.recipe_id AND r.active = 1
      LEFT JOIN order_items oi ON oi.item_id = r.menu_item_id
      LEFT JOIN orders o ON o.id = oi.order_id AND DATE(COALESCE(o.settled_at, o.created_at)) >= DATE('now', '-7 days')
      WHERE ing.active = 1
      GROUP BY ing.id
      ORDER BY ing.current_stock ASC
      LIMIT 25
    `).all().map((row) => ({ ...row, predicted_stock_tomorrow: Number(row.current_stock || 0) - Number(row.estimated_daily_usage || 0) / 7 }));
    const riskAlerts = db.prepare("SELECT * FROM fraud_alerts WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 20").all();
    res.json({
      success: true,
      salesTrend,
      peakHours,
      bestSellingItems: itemRows.slice(0, 10),
      worstSellingItems: itemRows.slice(-10).reverse(),
      revenueForecast: { nextDay: dailyAverage, nextWeek: dailyAverage * 7 },
      ingredientForecast,
      alertCenter: riskAlerts
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/reports/advanced', (req, res) => {
  const { restaurantId, fromDate = todayIso(), toDate = todayIso() } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const profit = profitDashboard(db, fromDate, toDate);
    const hourlySales = db.prepare(`
      SELECT STRFTIME('%H', COALESCE(settled_at, created_at)) AS hour, SUM(total_amount) AS sales, COUNT(*) AS orders
      FROM orders
      WHERE payment_status = 'PAID' AND DATE(COALESCE(settled_at, created_at)) BETWEEN DATE(?) AND DATE(?)
      GROUP BY hour ORDER BY hour
    `).all(fromDate, toDate);
    const waiterPerformance = db.prepare(`
      SELECT COALESCE(u.name, 'Unknown') AS waiter, COUNT(o.id) AS orders, COALESCE(SUM(o.total_amount), 0) AS sales
      FROM orders o LEFT JOIN users u ON u.id = o.created_by
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY u.id, u.name ORDER BY sales DESC
    `).all(fromDate, toDate);
    const paymentSummary = db.prepare(`
      SELECT payment_mode, COUNT(*) AS payments, SUM(amount) AS total
      FROM payments
      WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY payment_mode
    `).all(fromDate, toDate);
    const inventoryValuation = db.prepare('SELECT name, unit, current_stock, current_stock * 0 AS valuation_placeholder FROM ingredients WHERE active = 1 ORDER BY name').all();
    const wastageCost = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock_movements WHERE movement_type = 'WASTAGE' AND DATE(created_at) BETWEEN DATE(?) AND DATE(?)").get(fromDate, toDate);
    const supplierOutstanding = tableExists(db, 'purchase_orders') ? db.prepare(`
      SELECT s.name, COALESCE(SUM(po.total_amount), 0) - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS outstanding
      FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id = s.id
      GROUP BY s.id ORDER BY outstanding DESC
    `).all() : [];
    res.json({ success: true, profitAndLoss: profit, hourlySales, waiterPerformance, paymentSummary, inventoryValuation, wastageCost, supplierOutstanding });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/reports/advanced/export', (req, res) => {
  const { restaurantId, fromDate = todayIso(), toDate = todayIso() } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const report = profitDashboard(db, fromDate, toDate);
    const rows = [['metric', 'amount'], ['sales', report.sales], ['refunds', report.refunds], ['discounts', report.discounts], ['expenses', report.expenses], ['profit', report.profit]];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="advanced_report.csv"');
    res.send(rows.map((row) => row.map(csvCell).join(',')).join('\n'));
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/journal/search', (req, res) => {
  const { restaurantId, invoiceNo, orderId, fromDate, toDate, minAmount, maxAmount } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT * FROM electronic_journal
      WHERE (? IS NULL OR invoice_no = ?)
        AND (? IS NULL OR order_id = ?)
        AND (? IS NULL OR DATE(created_at) >= DATE(?))
        AND (? IS NULL OR DATE(created_at) <= DATE(?))
        AND (? IS NULL OR amount >= ?)
        AND (? IS NULL OR amount <= ?)
      ORDER BY created_at DESC LIMIT 200
    `).all(invoiceNo || null, invoiceNo || null, orderId || null, orderId || null, fromDate || null, fromDate || null, toDate || null, toDate || null, minAmount || null, minAmount || null, maxAmount || null, maxAmount || null);
    res.json({ success: true, entries: rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/journal/export', (req, res) => {
  const { restaurantId, format = 'csv' } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare('SELECT * FROM electronic_journal ORDER BY created_at DESC LIMIT 1000').all();
    if (format === 'json') return res.json({ success: true, entries: rows.map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot || '{}') })) });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="electronic_journal.csv"');
    res.send([['type', 'order_id', 'invoice_no', 'amount', 'created_at'], ...rows.map((row) => [row.journal_type, row.order_id, row.invoice_no, row.amount, row.created_at])].map((row) => row.map(csvCell).join(',')).join('\n'));
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/fraud/alerts', (req, res) => {
  const { restaurantId, status = 'OPEN' } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, alerts: db.prepare('SELECT * FROM fraud_alerts WHERE (? = "ALL" OR status = ?) ORDER BY created_at DESC LIMIT 200').all(status, status) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/fraud/settings', (req, res) => {
  const { restaurantId, actor, settings } = req.body;
  if (!restaurantId || !['OWNER', 'MANAGER_2'].includes(actor?.role)) return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    setConfigValues(db, settings || {});
    writeAudit(db, actor, 'UPDATE', 'FRAUD_SETTINGS', null, null, settings || {});
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/credit/accounts/save', (req, res) => {
  const { restaurantId, actor, customerId, creditLimit } = req.body;
  if (!restaurantId || !isPositiveId(customerId) || !isValidAmount(creditLimit)) return res.status(400).json({ success: false, message: 'Customer and credit limit required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'billing.settle', 'Credit account permission required');
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND active = 1').get(customerId);
    if (!customer) throw new Error('Customer not found');
    const result = db.prepare(`
      INSERT INTO customer_credit_accounts (customer_id, credit_limit, active)
      VALUES (?, ?, 1)
      ON CONFLICT(customer_id) DO UPDATE SET credit_limit = excluded.credit_limit, active = 1
    `).run(customerId, Number(creditLimit));
    writeAudit(db, actor, 'UPSERT', 'CREDIT_ACCOUNT', customerId, null, { customerId, creditLimit });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/credit/sale', (req, res) => {
  const { restaurantId, actor, customerId, orderId, amount, note } = req.body;
  if (!restaurantId || !isPositiveId(customerId) || !isPositiveId(orderId) || !isValidAmount(amount) || Number(amount) <= 0) return res.status(400).json({ success: false, message: 'Customer, order and amount required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const account = db.prepare('SELECT * FROM customer_credit_accounts WHERE customer_id = ? AND active = 1').get(customerId);
    if (!account) throw new Error('Credit account not found');
    const balance = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'SALE' THEN amount ELSE -amount END), 0) AS balance FROM credit_transactions WHERE customer_id = ?").get(customerId).balance || 0;
    if (Number(balance) + Number(amount) > Number(account.credit_limit || 0)) throw new Error('Credit limit exceeded');
    const result = db.prepare('INSERT INTO credit_transactions (credit_account_id, customer_id, order_id, type, amount, note) VALUES (?, ?, ?, "SALE", ?, ?)').run(account.id, customerId, orderId, Number(amount), normaliseText(note) || null);
    db.prepare("UPDATE orders SET payment_status = 'CREDIT', status = 'PAID', settled_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId);
    writeAudit(db, actor, 'CREATE', 'CREDIT_SALE', result.lastInsertRowid, null, { customerId, orderId, amount });
    res.json({ success: true, transactionId: result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/credit/payment', (req, res) => {
  const { restaurantId, actor, customerId, amount, note } = req.body;
  if (!restaurantId || !isPositiveId(customerId) || !isValidAmount(amount) || Number(amount) <= 0) return res.status(400).json({ success: false, message: 'Customer and amount required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const account = db.prepare('SELECT * FROM customer_credit_accounts WHERE customer_id = ? AND active = 1').get(customerId);
    if (!account) throw new Error('Credit account not found');
    const result = db.prepare('INSERT INTO credit_transactions (credit_account_id, customer_id, type, amount, note) VALUES (?, ?, "PAYMENT", ?, ?)').run(account.id, customerId, Number(amount), normaliseText(note) || null);
    writeAudit(db, actor, 'CREATE', 'CREDIT_PAYMENT', result.lastInsertRowid, null, { customerId, amount });
    res.json({ success: true, transactionId: result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/credit/statement', (req, res) => {
  const { restaurantId, customerId } = req.query;
  if (!restaurantId || !isPositiveId(customerId)) return res.status(400).json({ success: false, message: 'restaurantId and customerId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const account = db.prepare('SELECT * FROM customer_credit_accounts WHERE customer_id = ?').get(customerId);
    const transactions = db.prepare('SELECT * FROM credit_transactions WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    const balance = transactions.reduce((sum, row) => sum + (row.type === 'SALE' ? Number(row.amount) : -Number(row.amount)), 0);
    res.json({ success: true, account, balance, transactions });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/credit/aging-report', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT c.name, c.phone, cca.credit_limit,
             COALESCE(SUM(CASE WHEN ct.type = 'SALE' THEN ct.amount ELSE -ct.amount END), 0) AS balance,
             MIN(CASE WHEN ct.type = 'SALE' THEN ct.created_at END) AS oldest_sale
      FROM customer_credit_accounts cca
      JOIN customers c ON c.id = cca.customer_id
      LEFT JOIN credit_transactions ct ON ct.customer_id = c.id
      WHERE cca.active = 1
      GROUP BY cca.id
      ORDER BY balance DESC
    `).all();
    res.json({ success: true, rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/payments/providers', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, providers: db.prepare('SELECT code, name, active FROM payment_providers ORDER BY name').all() });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/payments/intent', (req, res) => {
  const { restaurantId, orderId, providerCode, amount, currency } = req.body;
  if (!restaurantId || !providerCode || !isValidAmount(amount) || Number(amount) <= 0) return res.status(400).json({ success: false, message: 'Provider and amount required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const provider = db.prepare('SELECT * FROM payment_providers WHERE code = ? AND active = 1').get(String(providerCode).toUpperCase());
    if (!provider) throw new Error('Payment provider not configured');
    const reference = `PI-${Date.now()}`;
    const result = db.prepare('INSERT INTO payment_transactions (provider_code, order_id, amount, currency, status, provider_reference, request_payload) VALUES (?, ?, ?, ?, "PENDING", ?, ?)').run(provider.code, isPositiveId(orderId) ? orderId : null, Number(amount), currency || 'INR', reference, JSON.stringify(req.body));
    res.json({ success: true, transactionId: result.lastInsertRowid, providerReference: reference, status: 'PENDING' });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/payments/transaction-status', (req, res) => {
  const { restaurantId, transactionId, status, responsePayload } = req.body;
  if (!restaurantId || !isPositiveId(transactionId) || !['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) return res.status(400).json({ success: false, message: 'Valid transaction and status required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    db.prepare('UPDATE payment_transactions SET status = ?, response_payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, JSON.stringify(responsePayload || {}), transactionId);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/notifications/templates', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, templates: db.prepare('SELECT * FROM notification_templates ORDER BY event_type').all() });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/notifications/send-placeholder', (req, res) => {
  const { restaurantId, eventType, channel, recipient, payload } = req.body;
  if (!restaurantId || !eventType || !channel) return res.status(400).json({ success: false, message: 'Event type and channel required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    queueNotification(db, eventType, channel, recipient, payload || {});
    res.json({ success: true, status: 'QUEUED' });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/privacy/customer-export', (req, res) => {
  const { restaurantId, customerId } = req.query;
  if (!restaurantId || !isPositiveId(customerId)) return res.status(400).json({ success: false, message: 'restaurantId and customerId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    const loyalty = db.prepare('SELECT * FROM loyalty_points WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    res.json({ success: true, customer, orders, loyalty });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/privacy/customer-anonymize', (req, res) => {
  const { restaurantId, actor, customerId } = req.body;
  if (!restaurantId || !isPositiveId(customerId) || !['OWNER', 'MANAGER_2'].includes(actor?.role)) return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!oldValue) throw new Error('Customer not found');
    db.prepare("UPDATE customers SET name = 'Anonymized Customer', phone = NULL, email = NULL, birthday = NULL, address = NULL WHERE id = ?").run(customerId);
    const newValue = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    writeAudit(db, actor, 'ANONYMIZE', 'CUSTOMER', customerId, oldValue, newValue);
    res.json({ success: true, customer: newValue });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/diagnostics', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const backup = getBackupConfig(db);
    const pendingPrintJobs = db.prepare("SELECT COUNT(*) AS count FROM print_jobs WHERE status = 'PENDING'").get().count;
    const license = db.prepare('SELECT status, expires_at, last_checked FROM license_status WHERE restaurant_id = ?').get(restaurantId);
    res.json({
      success: true,
      pos: { version: posPackageInfo().version, timestamp: new Date().toISOString() },
      database: { status: 'OK' },
      backup: { lastBackupAt: backup.last_backup_at || null, enabled: backup.backup_enabled === '1' },
      printer: { pendingPrintJobs, status: pendingPrintJobs > 0 ? 'PENDING' : 'OK' },
      license,
      modules: enabledModules(db)
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/disaster/check', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const integrity = db.pragma('integrity_check');
    const ok = integrity?.[0]?.integrity_check === 'ok';
    setConfigValues(db, { emergency_read_only_mode: ok ? '0' : '1' });
    res.json({ success: true, databaseOk: ok, integrity, emergencyReadOnlyMode: !ok });
  } catch (err) {
    res.status(503).json({ success: false, databaseOk: false, message: friendlyErrorMessage(err), emergencyReadOnlyMode: true });
  } finally {
    db.close();
  }
});

app.post('/disaster/restore-latest-backup', (req, res) => {
  const { restaurantId, actor } = req.body;
  if (!restaurantId || !['OWNER', 'MANAGER_2'].includes(actor?.role)) return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const backups = listBackups(db, restaurantId);
    if (!backups.length) throw new Error('No backups available');
    const latest = backups[0].filename;
    const restored = restoreBackup(db, restaurantId, latest);
    if (restored.success) {
      const auditDb = openRestaurantDatabase(restaurantId);
      try {
        writeAudit(auditDb, actor, 'RESTORE_LATEST_BACKUP', 'DISASTER_RECOVERY', null, null, { filename: latest, restored });
      } finally {
        auditDb.close();
      }
    }
    res.json({ success: true, restored });
  } catch (err) {
    sendError(res, err);
  } finally {
    if (db.open) db.close();
  }
});

app.post('/demo/reset', (req, res) => {
  const { restaurantId, actor } = req.body;
  if (!restaurantId || !['OWNER', 'MANAGER_2'].includes(actor?.role)) return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const result = db.transaction(() => {
      const kitchenId = db.prepare("INSERT OR IGNORE INTO kitchens (name, printer_name, active) VALUES ('Demo Kitchen', 'Demo Printer', 1)").run().lastInsertRowid
        || db.prepare("SELECT id FROM kitchens WHERE name = 'Demo Kitchen'").get().id;
      const categoryId = db.prepare("INSERT OR IGNORE INTO categories (name, kitchen_id, active) VALUES ('Demo Menu', ?, 1)").run(kitchenId).lastInsertRowid
        || db.prepare("SELECT id FROM categories WHERE name = 'Demo Menu'").get().id;
      [
        ['Demo Tea', 20],
        ['Demo Burger', 120],
        ['Demo Thali', 180]
      ].forEach(([name, price]) => db.prepare('INSERT OR IGNORE INTO items (name, category_id, price, active) VALUES (?, ?, ?, 1)').run(name, categoryId, price));
      db.prepare("INSERT OR IGNORE INTO users (name, username, pin, role, active) VALUES ('Demo Cashier', 'demo_cashier', '1234', 'CASHIER', 1)").run();
      db.prepare("INSERT OR IGNORE INTO tables (table_name, status, active) VALUES ('Demo Table', 'AVAILABLE', 1)").run();
      const item = db.prepare("SELECT id, price FROM items WHERE name = 'Demo Tea'").get();
      const table = db.prepare("SELECT id, table_name FROM tables WHERE table_name = 'Demo Table'").get();
      const orderId = db.prepare("INSERT INTO orders (order_type, table_id, table_no, status, total_amount, payment_status, order_source) VALUES ('DINE_IN', ?, ?, 'PAID', ?, 'PAID', 'DEMO')").run(table.id, table.table_name, item.price).lastInsertRowid;
      db.prepare('INSERT INTO order_items (order_id, item_id, quantity, kitchen_id, price) VALUES (?, ?, 1, ?, ?)').run(orderId, item.id, kitchenId, item.price);
      insertElectronicJournal(db, 'BILL', orderId, { orderId, invoiceNo: `DEMO-${orderId}`, payable: item.price });
      writeAudit(db, actor, 'RESET', 'DEMO_DATA', orderId, null, { orderId });
      return { orderId };
    })();
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/kitchens/save', (req, res) => {
  const { restaurantId, actor, id, name, printerName, active } = req.body;
  if (!restaurantId || !hasText(name) || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Kitchen name and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (activeNameExists(db, 'kitchens', 'name', name, id)) throw new Error('Kitchen name already exists');
    const oldValue = id ? db.prepare('SELECT * FROM kitchens WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE kitchens SET name = ?, printer_name = ?, active = ? WHERE id = ?').run(normaliseText(name), normaliseText(printerName) || null, active === false ? 0 : 1, id)
      : db.prepare('INSERT INTO kitchens (name, printer_name, active) VALUES (?, ?, 1)').run(normaliseText(name), normaliseText(printerName) || null);
    const newValue = db.prepare('SELECT * FROM kitchens WHERE id = ?').get(id || result.lastInsertRowid);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'KITCHEN', id || result.lastInsertRowid, oldValue, newValue);
    res.json({ success: true, id: id || result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/kitchens/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !id || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Kitchen and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM kitchens WHERE id = ?').get(id);
    db.prepare('UPDATE kitchens SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM kitchens WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'KITCHEN', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/categories/save', (req, res) => {
  const { restaurantId, actor, id, name, kitchenId, active } = req.body;
  if (!restaurantId || !hasText(name) || !isPositiveId(kitchenId) || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Category name, kitchen and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (activeNameExists(db, 'categories', 'name', name, id)) throw new Error('Category name already exists');
    const oldValue = id ? db.prepare('SELECT * FROM categories WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE categories SET name = ?, kitchen_id = ?, active = ? WHERE id = ?').run(name, kitchenId, active === false ? 0 : 1, id)
      : db.prepare('INSERT INTO categories (name, kitchen_id, active) VALUES (?, ?, 1)').run(name, kitchenId);
    const newValue = db.prepare('SELECT * FROM categories WHERE id = ?').get(id || result.lastInsertRowid);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'CATEGORY', id || result.lastInsertRowid, oldValue, newValue);
    res.json({ success: true, id: id || result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/categories/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !id || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Category and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'CATEGORY', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/items/save', (req, res) => {
  const { restaurantId, actor, id, name, categoryId, price, isVeg, allowParcel, active } = req.body;
  if (!restaurantId || !hasText(name) || !isPositiveId(categoryId) || !isValidAmount(price) || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Item name, category, valid price and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (activeNameExists(db, 'items', 'name', name, id)) throw new Error('Item name already exists');
    const oldValue = id ? db.prepare('SELECT * FROM items WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE items SET name = ?, category_id = ?, price = ?, is_veg = ?, allow_parcel = ?, active = ? WHERE id = ?')
          .run(name, categoryId, price, isVeg ? 1 : 0, allowParcel === false ? 0 : 1, active === false ? 0 : 1, id)
      : db.prepare('INSERT INTO items (name, category_id, price, is_veg, allow_parcel, active) VALUES (?, ?, ?, ?, ?, 1)')
          .run(name, categoryId, price, isVeg ? 1 : 0, allowParcel === false ? 0 : 1);
    const newValue = db.prepare('SELECT * FROM items WHERE id = ?').get(id || result.lastInsertRowid);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'ITEM', id || result.lastInsertRowid, oldValue, newValue);
    if (id && oldValue && Number(oldValue.price) !== Number(newValue.price)) {
      writeCompliance(db, 'PRICE_CHANGED', 'MEDIUM', `Item price changed from ${oldValue.price} to ${newValue.price}`, 'ITEM', id);
    }
    res.json({ success: true, id: id || result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/items/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !id || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Item and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'ITEM', id, oldValue, newValue);
    writeCompliance(db, 'DELETED_ITEM', 'HIGH', `Menu item deleted: ${oldValue?.name || id}`, 'ITEM', id);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/items/toggle', (req, res) => {
  const { restaurantId, actor, id, active } = req.body;
  if (!restaurantId || !id || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Item and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    db.prepare('UPDATE items SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    writeAudit(db, actor, active ? 'ACTIVATE' : 'DEACTIVATE', 'ITEM', id);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/users/save', (req, res) => {
  const { restaurantId, actor, id, name, username, pin, role, active } = req.body;
  const roles = ['OWNER', 'MANAGER', 'MANAGER_2', 'CASHIER', 'WAITER', 'KITCHEN'];
  if (!restaurantId || !name || !username || !roles.includes(role) || !canManage(actor?.role)) {
    return res.status(400).json({ success: false, message: 'User name, username, role and manager permission are required' });
  }
  if ((!id || pin) && !isValidPin(pin)) return res.status(400).json({ success: false, message: 'PIN must be exactly 4 digits' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (activeNameExists(db, 'users', 'username', username, id)) throw new Error('Username already exists');
    const oldValue = id ? db.prepare('SELECT id, name, username, role, active FROM users WHERE id = ?').get(id) : null;
    let result;
    if (id) {
      db.prepare('UPDATE users SET name = ?, username = ?, role = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name, username, role, active === false ? 0 : 1, id);
      if (pin) db.prepare('UPDATE users SET pin = ?, pin_hash = ? WHERE id = ?').run('', bcrypt.hashSync(pin, 10), id);
      result = { lastInsertRowid: id };
    } else {
      result = db.prepare('INSERT INTO users (name, username, pin, pin_hash, role, active) VALUES (?, ?, ?, ?, ?, 1)')
        .run(name, username, '', bcrypt.hashSync(pin, 10), role);
    }
    const newValue = db.prepare('SELECT id, name, username, role, active FROM users WHERE id = ?').get(id || result.lastInsertRowid);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'USER', id || result.lastInsertRowid, oldValue, newValue);
    res.json({ success: true, id: id || result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/admin/users/disable', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !id || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'User and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT id, name, username, role, active FROM users WHERE id = ?').get(id);
    db.prepare('UPDATE users SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT id, name, username, role, active FROM users WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'USER', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/tables/save', (req, res) => {
  const { restaurantId, actor, id, tableName, status } = req.body;
  const tableStatuses = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'INACTIVE'];
  if (!restaurantId || !hasText(tableName) || !tableStatuses.includes(status || 'AVAILABLE') || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Table name, valid status and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (activeNameExists(db, 'tables', 'table_name', tableName, id)) throw new Error('Table name already exists');
    const oldValue = id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE tables SET table_name = ?, status = ? WHERE id = ?').run(tableName, status || 'AVAILABLE', id)
      : db.prepare('INSERT INTO tables (table_name, status) VALUES (?, ?)').run(tableName, status || 'AVAILABLE');
    const newValue = db.prepare('SELECT * FROM tables WHERE id = ?').get(id || result.lastInsertRowid);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'TABLE', id || result.lastInsertRowid, oldValue, newValue);
    res.json({ success: true, id: id || result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/tables/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !id || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Table and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (hasOpenOrderFor(db, 'table_id', id)) throw new Error('Cannot delete a table with an open order');
    const oldValue = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    db.prepare("UPDATE tables SET active = 0, status = 'INACTIVE', table_name = table_name || ' (deleted ' || id || ')' WHERE id = ?").run(id);
    const newValue = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'TABLE', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/reservations/list', (req, res) => {
  const { restaurantId, fromDate, toDate } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT r.*, t.table_name
      FROM reservations r
      LEFT JOIN tables t ON t.id = r.table_id
      WHERE (? IS NULL OR DATE(r.reservation_time) >= DATE(?))
        AND (? IS NULL OR DATE(r.reservation_time) <= DATE(?))
      ORDER BY r.reservation_time DESC
      LIMIT 200
    `).all(fromDate || null, fromDate || null, toDate || null, toDate || null);
    res.json({ success: true, reservations: rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/reservations/save', (req, res) => {
  const { restaurantId, actor, id, customerName, phone, tableId, guestCount, reservationTime, status, notes } = req.body;
  if (!restaurantId || !hasText(customerName) || !isPositiveId(tableId) || !reservationTime) {
    return res.status(400).json({ success: false, message: 'Customer, table and reservation time are required' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'orders.create', 'Reservation permission required');
    const selectedStatus = ['BOOKED', 'ARRIVED', 'CANCELLED', 'COMPLETED'].includes(status) ? status : 'BOOKED';
    const oldValue = id ? db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare(`UPDATE reservations SET customer_name = ?, phone = ?, table_id = ?, guest_count = ?, reservation_time = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(normaliseText(customerName), normaliseText(phone), tableId, Number(guestCount || 1), reservationTime, selectedStatus, normaliseText(notes), id)
      : db.prepare(`INSERT INTO reservations (customer_name, phone, table_id, guest_count, reservation_time, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(normaliseText(customerName), normaliseText(phone), tableId, Number(guestCount || 1), reservationTime, selectedStatus, normaliseText(notes));
    const reservationId = id || result.lastInsertRowid;
    const newValue = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'RESERVATION', reservationId, oldValue, newValue);
    res.json({ success: true, reservation: newValue });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/reservations/cancel', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Reservation id required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'orders.cancel', 'Reservation cancel permission required');
    const oldValue = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
    if (!oldValue) throw new Error('Reservation not found');
    db.prepare("UPDATE reservations SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    const newValue = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
    writeAudit(db, actor, 'CANCEL', 'RESERVATION', id, oldValue, newValue);
    res.json({ success: true, reservation: newValue });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/pos/bootstrap', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      tables: db.prepare(`
        SELECT t.*,
               CASE WHEN r.id IS NOT NULL AND t.status = 'AVAILABLE' THEN 'RESERVED' ELSE t.status END AS status,
               r.id AS reservation_id,
               r.customer_name AS reservation_customer,
               r.reservation_time
        FROM tables t
        LEFT JOIN reservations r ON r.id = (
          SELECT id FROM reservations
          WHERE table_id = t.id
            AND status = 'BOOKED'
            AND DATETIME(reservation_time) BETWEEN DATETIME('now', '-30 minutes') AND DATETIME('now', '+2 hours')
          ORDER BY reservation_time ASC
          LIMIT 1
        )
        WHERE t.active = 1
        ORDER BY t.id
      `).all(),
      categories: db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name').all(),
      items: db.prepare('SELECT id, name, category_id, price FROM items WHERE active = 1 ORDER BY name').all(),
      modifierGroups: db.prepare(`
        SELECT img.item_id, mg.id, mg.name, mg.min_select, mg.max_select, mg.required
        FROM item_modifier_groups img
        JOIN modifier_groups mg ON mg.id = img.group_id
        WHERE img.active = 1 AND mg.active = 1
        ORDER BY mg.name
      `).all(),
      modifiers: db.prepare(`
        SELECT m.id, m.group_id, m.name, m.price_delta
        FROM modifiers m
        JOIN modifier_groups mg ON mg.id = m.group_id
        WHERE m.active = 1 AND mg.active = 1
        ORDER BY m.name
      `).all(),
      combos: db.prepare('SELECT id, name, price FROM combos WHERE active = 1 ORDER BY name').all(),
      comboItems: db.prepare(`
        SELECT ci.combo_id, ci.item_id, ci.quantity, i.name AS item_name
        FROM combo_items ci
        JOIN items i ON i.id = ci.item_id
        WHERE ci.active = 1 AND i.active = 1
        ORDER BY ci.combo_id, i.name
      `).all(),
      deliveryPartners: db.prepare('SELECT id, name, phone FROM delivery_partners WHERE active = 1 ORDER BY name').all(),
      enabledModules: enabledModules(db),
      settings: {
        currency: getConfigValue(db, 'currency', 'INR'),
        defaultOrderType: getConfigValue(db, 'default_order_type', 'DINE_IN'),
        allowDiscount: getBooleanConfig(db, 'allow_discount', true),
        allowRefund: getBooleanConfig(db, 'allow_refund', true),
        allowOrderCancel: getBooleanConfig(db, 'allow_order_cancel', true),
        serviceChargeEnabled: getBooleanConfig(db, 'service_charge_enabled', false),
        serviceChargePercent: getNumberConfig(db, 'service_charge_percent', 0),
        roundOffEnabled: getBooleanConfig(db, 'round_off_enabled', true)
      }
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

function createKotJobs(db, orderId) {
  const kotSettings = {
    headerText: getConfigValue(db, 'kot_header_text', ''),
    footerText: getConfigValue(db, 'kot_footer_text', ''),
    autoPrint: getBooleanConfig(db, 'auto_print_kot', true)
  };
  const orderMeta = db.prepare(`
    SELECT
      o.id,
      o.order_type,
      o.table_no,
      c.name AS customer_name,
      d.delivery_address,
      d.delivery_phone
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN delivery_orders d ON d.order_id = o.id
    WHERE o.id = ?
  `).get(orderId);
  const rows = db.prepare(`
    SELECT oi.id AS order_item_id, oi.item_id, oi.quantity, oi.price, oi.combo_id, oi.combo_name, i.name, c.kitchen_id, k.printer_id, k.name AS kitchen_name
    FROM order_items oi
    JOIN items i ON i.id = oi.item_id
    JOIN categories c ON c.id = i.category_id
    JOIN kitchens k ON k.id = c.kitchen_id
    WHERE oi.order_id = ? AND oi.kot_id IS NULL
    ORDER BY c.kitchen_id
  `).all(orderId);
  const modifiersByOrderItem = rows.length === 0 ? {} : db.prepare(`
    SELECT order_item_id, name, price_delta
    FROM order_item_modifiers
    WHERE order_item_id IN (${rows.map(() => '?').join(',')})
    ORDER BY id
  `).all(...rows.map((row) => row.order_item_id)).reduce((map, modifier) => {
    map[modifier.order_item_id] ||= [];
    map[modifier.order_item_id].push({ name: modifier.name, priceDelta: modifier.price_delta });
    return map;
  }, {});

  const grouped = rows.reduce((map, row) => {
    map[row.kitchen_id] ||= { kitchenId: row.kitchen_id, kitchenName: row.kitchen_name, printerId: row.printer_id || 1, items: [] };
    map[row.kitchen_id].items.push({ ...row, modifiers: modifiersByOrderItem[row.order_item_id] || [] });
    return map;
  }, {});

  Object.values(grouped).forEach((group) => {
    const kot = db.prepare('INSERT INTO kots (order_id, kitchen_id) VALUES (?, ?)').run(orderId, group.kitchenId);
    group.items.forEach((item) => db.prepare('UPDATE order_items SET kot_id = ? WHERE id = ?').run(kot.lastInsertRowid, item.order_item_id));
    db.prepare(`
      INSERT INTO print_jobs (type, ref_id, kitchen_id, printer_id, payload, status)
      VALUES ('KOT', ?, ?, ?, ?, 'PENDING')
    `).run(orderId, group.kitchenId, group.printerId, JSON.stringify({
      kotId: kot.lastInsertRowid,
      orderId,
      kitchen: group.kitchenName,
      headerText: kotSettings.headerText,
      footerText: kotSettings.footerText,
      autoPrint: kotSettings.autoPrint,
      orderType: orderMeta?.order_type || 'DINE_IN',
      tableName: orderMeta?.table_no || null,
      customerName: orderMeta?.customer_name || null,
      deliveryNote: orderMeta?.delivery_address || null,
      deliveryPhone: orderMeta?.delivery_phone || null,
      items: group.items
    }));
    insertElectronicJournal(db, 'KOT', orderId, {
      kotId: kot.lastInsertRowid,
      orderId,
      kitchen: group.kitchenName,
      orderType: orderMeta?.order_type || 'DINE_IN',
      tableName: orderMeta?.table_no || null,
      customerName: orderMeta?.customer_name || null,
      items: group.items
    });
  });
}

app.get('/qr/menu', (req, res) => {
  const { restaurantId, tableId } = req.query;
  if (!restaurantId || !isPositiveId(tableId)) return res.status(400).json({ success: false, message: 'restaurantId and tableId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const table = db.prepare('SELECT id, table_name, status FROM tables WHERE id = ? AND active = 1').get(tableId);
    if (!table) throw new Error('Table not found');
    res.json({
      success: true,
      table,
      restaurant: {
        displayName: getConfigValue(db, 'restaurant_display_name', 'Restaurant POS'),
        currency: getConfigValue(db, 'currency', 'INR')
      },
      categories: db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name').all(),
      items: db.prepare('SELECT id, name, category_id, price FROM items WHERE active = 1 ORDER BY name').all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/qr/orders/place', (req, res) => {
  const { restaurantId, tableId, customerName, customerPhone, items } = req.body;
  if (!restaurantId || !isPositiveId(tableId) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'restaurantId, table and items are required' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      const table = db.prepare('SELECT * FROM tables WHERE id = ? AND active = 1').get(tableId);
      if (!table) throw new Error('Table not found');
      const reservation = activeReservationForTable(db, table.id);
      if (reservation) throw new Error(`This table is reserved for ${reservation.customer_name}. Please contact staff.`);
      let customerId = null;
      if (hasText(customerName) || hasText(customerPhone)) {
        const existing = hasText(customerPhone) ? db.prepare('SELECT id FROM customers WHERE phone = ? AND active = 1').get(normaliseText(customerPhone)) : null;
        customerId = existing?.id || db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(normaliseText(customerName) || 'QR Customer', normaliseText(customerPhone) || null).lastInsertRowid;
      }
      const order = db.prepare(`
        INSERT INTO orders (order_type, table_id, table_no, status, total_amount, payment_status, customer_id, order_source)
        VALUES ('DINE_IN', ?, ?, 'OPEN', 0, 'UNPAID', ?, 'QR')
      `).run(table.id, table.table_name, customerId);
      let total = 0;
      items.forEach((line) => {
        const quantity = Number(line.quantity || 1);
        if (!isPositiveId(line.itemId) || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid QR order item');
        const item = db.prepare(`
          SELECT i.id, i.name, i.price, c.kitchen_id
          FROM items i
          JOIN categories c ON c.id = i.category_id
          WHERE i.id = ? AND i.active = 1
        `).get(line.itemId);
        if (!item) throw new Error('Menu item not found');
        db.prepare('INSERT INTO order_items (order_id, item_id, quantity, kitchen_id, price) VALUES (?, ?, ?, ?, ?)')
          .run(order.lastInsertRowid, item.id, quantity, item.kitchen_id, item.price);
        total += Number(item.price || 0) * quantity;
      });
      db.prepare("UPDATE orders SET total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(total, order.lastInsertRowid);
      db.prepare("UPDATE tables SET status = 'OCCUPIED' WHERE id = ?").run(table.id);
      createKotJobs(db, order.lastInsertRowid);
      writeAudit(db, { role: 'QR' }, 'CREATE', 'ORDER', order.lastInsertRowid, null, { orderSource: 'QR', total });
      return { orderId: order.lastInsertRowid, total };
    })();
    trackModuleUsage(restaurantId, 'QR_ORDERING', 'QR_ORDER_PLACED').catch(() => {});
    res.json({ success: true, ...saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/online/menu', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      restaurant: {
        displayName: getConfigValue(db, 'restaurant_display_name', 'Restaurant POS'),
        currency: getConfigValue(db, 'currency', 'INR')
      },
      categories: db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name').all(),
      items: db.prepare('SELECT id, name, category_id, price FROM items WHERE active = 1 ORDER BY name').all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/online/orders/place', (req, res) => {
  const { restaurantId, orderType, customerName, customerPhone, deliveryAddress, items } = req.body;
  const selectedOrderType = normaliseOrderType(orderType || 'TAKEAWAY');
  if (!restaurantId || !['TAKEAWAY', 'DELIVERY', 'ONLINE_ORDER'].includes(selectedOrderType) || !hasText(customerName) || !hasText(customerPhone) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Customer, order type and items are required' });
  }
  if (selectedOrderType === 'DELIVERY' && !hasText(deliveryAddress)) return res.status(400).json({ success: false, message: 'Delivery address required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      const existingCustomer = db.prepare('SELECT id FROM customers WHERE phone = ? AND active = 1').get(normaliseText(customerPhone));
      const customerId = existingCustomer?.id || db.prepare('INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)').run(normaliseText(customerName), normaliseText(customerPhone), normaliseText(deliveryAddress) || null).lastInsertRowid;
      const order = db.prepare(`
        INSERT INTO orders (order_type, table_no, status, total_amount, payment_status, customer_id, delivery_fee, order_source)
        VALUES (?, ?, 'OPEN', 0, 'UNPAID', ?, 0, 'ONLINE')
      `).run(selectedOrderType, selectedOrderType.replace(/_/g, ' '), customerId);
      let total = 0;
      items.forEach((line) => {
        const quantity = Number(line.quantity || 1);
        if (!isPositiveId(line.itemId) || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid online order item');
        const item = db.prepare(`
          SELECT i.id, i.price, c.kitchen_id
          FROM items i JOIN categories c ON c.id = i.category_id
          WHERE i.id = ? AND i.active = 1
        `).get(line.itemId);
        if (!item) throw new Error('Menu item not found');
        db.prepare('INSERT INTO order_items (order_id, item_id, quantity, kitchen_id, price) VALUES (?, ?, ?, ?, ?)').run(order.lastInsertRowid, item.id, quantity, item.kitchen_id, item.price);
        total += Number(item.price || 0) * quantity;
      });
      db.prepare('UPDATE orders SET total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(total, order.lastInsertRowid);
      if (selectedOrderType === 'DELIVERY') {
        db.prepare('INSERT INTO delivery_orders (order_id, customer_id, delivery_address, delivery_phone, delivery_status) VALUES (?, ?, ?, ?, "RECEIVED")').run(order.lastInsertRowid, customerId, normaliseText(deliveryAddress), normaliseText(customerPhone));
      }
      createKotJobs(db, order.lastInsertRowid);
      queueNotification(db, 'ORDER_CONFIRMATION', 'SMS', normaliseText(customerPhone), { orderId: order.lastInsertRowid, total });
      writeAudit(db, { role: 'ONLINE' }, 'CREATE', 'ORDER', order.lastInsertRowid, null, { orderSource: 'ONLINE', total });
      return { orderId: order.lastInsertRowid, total };
    })();
    res.json({ success: true, ...saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// Inventory sale consumption is tracked separately so an order can only deduct stock once.
function deductInventoryForOrder(db, actor, orderId, reason) {
  if (db.prepare('SELECT order_id FROM order_inventory_deductions WHERE order_id = ?').get(orderId)) {
    return { deducted: false, rows: [] };
  }

  const rows = db.prepare(`
    SELECT ri.ingredient_id, SUM(oi.quantity * ri.quantity) AS quantity
    FROM order_items oi
    JOIN recipes r ON r.menu_item_id = oi.item_id AND r.active = 1
    JOIN recipe_items ri ON ri.recipe_id = r.id AND ri.active = 1
    WHERE oi.order_id = ?
    GROUP BY ri.ingredient_id
  `).all(orderId);

  if (rows.length === 0) {
    return { deducted: false, rows };
  }

  const updateIngredient = db.prepare('UPDATE ingredients SET current_stock = current_stock - ? WHERE id = ? AND active = 1');
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (ingredient_id, movement_type, quantity, reference_type, reference_id, notes)
    VALUES (?, 'SALE_CONSUMPTION', ?, 'ORDER', ?, ?)
  `);

  rows.forEach((row) => {
    updateIngredient.run(Number(row.quantity || 0), row.ingredient_id);
    insertMovement.run(row.ingredient_id, Number(row.quantity || 0), orderId, reason);
  });
  db.prepare('INSERT OR IGNORE INTO order_inventory_deductions (order_id, reason) VALUES (?, ?)').run(orderId, reason);
  writeAudit(db, actor, 'SALE_CONSUMPTION', 'INVENTORY_ORDER', orderId, null, { reason, rows });
  return { deducted: true, rows };
}

function reverseInventoryDeductionForOrder(db, actor, orderId) {
  if (!db.prepare('SELECT order_id FROM order_inventory_deductions WHERE order_id = ?').get(orderId)) {
    return;
  }

  const rows = db.prepare(`
    SELECT ingredient_id, SUM(quantity) AS quantity
    FROM stock_movements
    WHERE movement_type = 'SALE_CONSUMPTION'
      AND reference_type = 'ORDER'
      AND reference_id = ?
    GROUP BY ingredient_id
  `).all(orderId);

  rows.forEach((row) => {
    db.prepare('UPDATE ingredients SET current_stock = current_stock + ? WHERE id = ?').run(Number(row.quantity || 0), row.ingredient_id);
  });
  db.prepare("DELETE FROM stock_movements WHERE movement_type = 'SALE_CONSUMPTION' AND reference_type = 'ORDER' AND reference_id = ?").run(orderId);
  db.prepare('DELETE FROM order_inventory_deductions WHERE order_id = ?').run(orderId);
  writeAudit(db, actor, 'REVERSE_SALE_CONSUMPTION', 'INVENTORY_ORDER', orderId, null, { rows });
}

app.post('/orders/save', (req, res) => {
  const {
    restaurantId,
    actor,
    orderId,
    tableId,
    tableName,
    customerId,
    items,
    orderType,
    deliveryAddress,
    deliveryPhone,
    deliveryFee,
    deliveryPartnerId,
    expectedDeliveryTime,
    orderSource,
    managerOverride,
    lockId,
    latestUpdatedAt
  } = req.body;
  if (!restaurantId || !Array.isArray(items) || items.length === 0 || !canSell(actor?.role)) {
    return res.status(400).json({ success: false, message: 'Restaurant, order items and sales permission are required' });
  }

  const selectedOrderType = normaliseOrderType(orderType);
  if (!selectedOrderType) return res.status(400).json({ success: false, message: 'Invalid order type' });
  if (selectedOrderType === 'DINE_IN' && !isPositiveId(tableId)) {
    return res.status(400).json({ success: false, message: 'Table is required for dine-in orders' });
  }
  if (selectedOrderType === 'DELIVERY' && (!hasText(deliveryPhone) || !hasText(deliveryAddress))) {
    return res.status(400).json({ success: false, message: 'Delivery phone and address are required' });
  }
  if (hasText(deliveryPhone) && !/^[0-9+\-\s()]{6,20}$/.test(deliveryPhone.trim())) {
    return res.status(400).json({ success: false, message: 'Delivery phone is invalid' });
  }
  if (!isValidAmount(deliveryFee || 0)) {
    return res.status(400).json({ success: false, message: 'Delivery fee must be numeric and zero or more' });
  }

  if (items.some((item) => (!isPositiveId(item.itemId || item.id) && !isPositiveId(item.comboId)) || !Number.isInteger(Number(item.quantity || item.qty || 1)) || Number(item.quantity || item.qty || 1) <= 0)) {
    return res.status(400).json({ success: false, message: 'Items must contain valid item or combo IDs and quantities' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'orders.create', 'Order creation permission required');
    const reservation = activeReservationForTable(db, tableId);
    if (reservation && !managerCanOverrideReservation(actor?.role)) {
      throw new Error(`Table is reserved for ${reservation.customer_name}. Manager override required.`);
    }
    if (lockId || latestUpdatedAt) verifyOrderLock(db, actor, tableId, orderId, lockId);
    if (orderId) {
      const existingOrder = db.prepare('SELECT id, status, payment_status, updated_at FROM orders WHERE id = ?').get(orderId);
      if (!existingOrder) throw new Error('Order not found');
      if (existingOrder.payment_status === 'PAID' || existingOrder.status === 'PAID') throw new Error('Settled order cannot be edited');
      if (latestUpdatedAt && existingOrder.updated_at && String(existingOrder.updated_at) !== String(latestUpdatedAt)) {
        throw new Error('This order changed on another device. Refresh before saving.');
      }
    }
    requireClockInIfConfigured(db, actor);
    const saved = db.transaction(() => {
      let total = 0;
      const safeDeliveryFee = selectedOrderType === 'DELIVERY' ? Number(deliveryFee || 0) : 0;
      const safeTableId = selectedOrderType === 'DINE_IN' ? tableId : null;
      const safeTableName = selectedOrderType === 'DINE_IN' ? tableName : selectedOrderType.replace(/_/g, ' ');

      let id = orderId;
      const oldValue = id ? db.prepare('SELECT * FROM orders WHERE id = ?').get(id) : null;
      if (!id) {
        const result = db.prepare(`
          INSERT INTO orders (order_type, table_id, table_no, status, total_amount, payment_status, created_by, customer_id, delivery_fee, order_source)
          VALUES (?, ?, ?, 'OPEN', ?, 'UNPAID', ?, ?, ?, ?)
        `).run(selectedOrderType, safeTableId || null, safeTableName || null, total, actor?.id || null, isPositiveId(customerId) ? customerId : null, safeDeliveryFee, normaliseText(orderSource || 'POS').toUpperCase());
        id = result.lastInsertRowid;
        writeOrderStatusHistory(db, actor, id, 'OPEN', 'ORDER', `${selectedOrderType} order created`);
      } else {
        db.prepare("UPDATE orders SET order_type = ?, table_id = ?, table_no = ?, total_amount = ?, status = 'OPEN', customer_id = COALESCE(?, customer_id), delivery_fee = ?, order_source = COALESCE(order_source, 'POS'), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(selectedOrderType, safeTableId || null, safeTableName || null, 0, isPositiveId(customerId) ? customerId : null, safeDeliveryFee, id);
        const existingOrderItems = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(id).map((row) => row.id);
        if (existingOrderItems.length > 0) {
          db.prepare(`DELETE FROM order_item_modifiers WHERE order_item_id IN (${existingOrderItems.map(() => '?').join(',')})`).run(...existingOrderItems);
        }
        reverseInventoryDeductionForOrder(db, actor, id);
        db.prepare("DELETE FROM print_jobs WHERE type = 'KOT' AND ref_id = ? AND status = 'PENDING'").run(id);
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
        db.prepare('DELETE FROM kots WHERE order_id = ?').run(id);
      }

      items.forEach((item) => {
        const quantity = Number(item.quantity || item.qty || 1);
        if (item.comboId) {
          const combo = db.prepare('SELECT * FROM combos WHERE id = ? AND active = 1').get(item.comboId);
          if (!combo) throw new Error('Combo not found');
          const comboItems = db.prepare(`
            SELECT ci.item_id, ci.quantity, c.kitchen_id
            FROM combo_items ci
            JOIN items i ON i.id = ci.item_id
            JOIN categories c ON c.id = i.category_id
            WHERE ci.combo_id = ? AND ci.active = 1 AND i.active = 1
            ORDER BY ci.id
          `).all(item.comboId);
          if (comboItems.length === 0) throw new Error('Combo has no active items');
          comboItems.forEach((comboItem, index) => {
            const componentQuantity = quantity * Number(comboItem.quantity || 1);
            const pricedQuantity = index === 0 ? componentQuantity : 1;
            const componentPrice = index === 0 ? Number(combo.price) * quantity / pricedQuantity : 0;
            db.prepare('INSERT INTO order_items (order_id, item_id, quantity, kitchen_id, price, combo_id, combo_name, combo_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
              .run(id, comboItem.item_id, componentQuantity, comboItem.kitchen_id, componentPrice, combo.id, combo.name, quantity);
          });
          total += Number(combo.price) * quantity;
          return;
        }

        const itemId = item.itemId || item.id;
        const menu = db.prepare(`
          SELECT i.id, i.price, c.kitchen_id
          FROM items i JOIN categories c ON c.id = i.category_id
          WHERE i.id = ? AND i.active = 1
        `).get(itemId);
        if (!menu) throw new Error('Menu item not found');
        const modifiers = validateSelectedModifiers(db, itemId, selectedModifierIds(item));
        const unitPrice = Number(menu.price) + modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta || 0), 0);
        const result = db.prepare('INSERT INTO order_items (order_id, item_id, quantity, kitchen_id, price) VALUES (?, ?, ?, ?, ?)')
          .run(id, itemId, quantity, menu.kitchen_id, unitPrice);
        insertOrderItemModifiers(db, result.lastInsertRowid, modifiers);
        total += unitPrice * quantity;
      });

      if (isPositiveId(customerId)) {
        const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND active = 1').get(customerId);
        if (!customer) throw new Error('Customer not found');
      }
      total += safeDeliveryFee;
      db.prepare('UPDATE orders SET total_amount = ?, customer_id = COALESCE(?, customer_id), delivery_fee = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(total, isPositiveId(customerId) ? customerId : null, safeDeliveryFee, id);
      if (DELIVERY_ORDER_TYPES.includes(selectedOrderType)) {
        if (isPositiveId(deliveryPartnerId) && !db.prepare('SELECT id FROM delivery_partners WHERE id = ? AND active = 1').get(deliveryPartnerId)) {
          throw new Error('Delivery partner not found');
        }
        db.prepare(`
          INSERT INTO delivery_orders (order_id, customer_id, delivery_address, delivery_phone, delivery_partner_id, delivery_fee, delivery_status, expected_delivery_time)
          VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?)
          ON CONFLICT(order_id) DO UPDATE SET
            customer_id = excluded.customer_id,
            delivery_address = excluded.delivery_address,
            delivery_phone = excluded.delivery_phone,
            delivery_partner_id = excluded.delivery_partner_id,
            delivery_fee = excluded.delivery_fee,
            expected_delivery_time = excluded.expected_delivery_time
        `).run(
          id,
          isPositiveId(customerId) ? customerId : null,
          normaliseText(deliveryAddress) || null,
          normaliseText(deliveryPhone) || null,
          isPositiveId(deliveryPartnerId) ? deliveryPartnerId : null,
          safeDeliveryFee,
          hasText(expectedDeliveryTime) ? normaliseText(expectedDeliveryTime) : null
        );
      }
      if (safeTableId) db.prepare("UPDATE tables SET status = 'OCCUPIED' WHERE id = ?").run(safeTableId);
      const newValue = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (lockId) db.prepare('UPDATE order_locks SET order_id = ? WHERE id = ? AND locked_by_user_id = ?').run(id, lockId, actor?.id || null);
      writeAudit(db, actor, orderId ? 'UPDATE' : 'CREATE', 'ORDER', id, oldValue, newValue);
      return { id, total };
    })();

    res.json({ success: true, orderId: saved.id, total: saved.total });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/orders/open', (req, res) => {
  const { restaurantId, tableId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const order = db.prepare(`
      SELECT * FROM orders
      WHERE status = 'OPEN' AND payment_status != 'PAID' AND (? IS NULL OR table_id = ?)
      ORDER BY created_at DESC LIMIT 1
    `).get(tableId || null, tableId || null);
    const items = order ? db.prepare(`
      SELECT oi.id AS order_item_id, oi.item_id AS id, i.name, oi.quantity, oi.price, oi.kot_id, oi.combo_id, oi.combo_name, oi.combo_quantity
      FROM order_items oi JOIN items i ON i.id = oi.item_id
      WHERE oi.order_id = ?
    `).all(order.id) : [];
    const modifiers = items.length === 0 ? [] : db.prepare(`
      SELECT order_item_id, modifier_id AS id, group_id, name, price_delta
      FROM order_item_modifiers
      WHERE order_item_id IN (${items.map(() => '?').join(',')})
      ORDER BY id
    `).all(...items.map((item) => item.order_item_id));
    const modifiersByItem = modifiers.reduce((map, modifier) => {
      map[modifier.order_item_id] ||= [];
      map[modifier.order_item_id].push(modifier);
      return map;
    }, {});
    items.forEach((item) => {
      item.modifiers = modifiersByItem[item.order_item_id] || [];
    });
    const comboLines = new Map();
    const plainItems = [];
    items.forEach((item) => {
      if (!item.combo_id) {
        plainItems.push(item);
        return;
      }
      if (!comboLines.has(item.combo_id)) {
        comboLines.set(item.combo_id, {
          order_item_id: item.order_item_id,
          id: item.id,
          comboId: item.combo_id,
        combo_id: item.combo_id,
        name: item.combo_name,
        quantity: item.combo_quantity || 1,
          price: 0,
          modifiers: []
        });
      }
      const comboLine = comboLines.get(item.combo_id);
      comboLine.price += Number(item.quantity || 0) * Number(item.price || 0);
      comboLine.modifiers.push({ id: 0, name: `${item.name} x${item.quantity}`, price_delta: 0 });
    });
    comboLines.forEach((line) => {
      line.price = Number(line.price || 0) / Number(line.quantity || 1);
    });
    const customer = order?.customer_id ? customerWithBalance(db, db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id)) : null;
    const lock = tableId ? currentLockForTable(db, tableId) : null;
    res.json({ success: true, order, items: [...plainItems, ...comboLines.values()], customer, lock });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/customer-display/current', (req, res) => {
  const { restaurantId, tableId, orderId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const order = orderId
      ? db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
      : db.prepare(`
        SELECT * FROM orders
        WHERE payment_status != 'PAID'
          AND status NOT IN ('CANCELLED', 'PAID')
          AND (? IS NULL OR table_id = ?)
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `).get(tableId || null, tableId || null);
    if (!order) return res.json({ success: true, order: null, items: [], totals: null });
    const items = db.prepare(`
      SELECT i.name, oi.quantity, oi.price, oi.quantity * oi.price AS line_total
      FROM order_items oi
      JOIN items i ON i.id = oi.item_id
      WHERE oi.order_id = ?
      ORDER BY oi.id
    `).all(order.id);
    const subtotal = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    const discount = Number(order.loyalty_discount || 0);
    const tax = Number(order.tax_amount || 0);
    const grandTotal = Number(order.total_amount || subtotal + tax - discount);
    res.json({ success: true, order, items, totals: { subtotal, discount, tax, grandTotal, paymentStatus: order.payment_status } });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/network/info', (req, res) => {
  const port = process.env.PORT || 3000;
  const ips = localIpAddresses();
  res.json({
    success: true,
    hostname: os.hostname(),
    localIpAddresses: ips,
    posUrls: ips.map((ip) => `http://${ip}:${port}/login.html`),
    waiterUrls: ips.map((ip) => `http://${ip}:${port}/waiter.html`),
    port: Number(port),
    activeRestaurantId: getSingleRestaurantId(),
    localhost: `http://localhost:${port}/login.html`
  });
});

app.post('/device-sessions/touch', (req, res) => {
  const { restaurantId, actor, deviceName } = req.body;
  if (!restaurantId || !isPositiveId(actor?.id)) return res.status(400).json({ success: false, message: 'Device user is required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const id = touchDeviceSession(db, actor, req, deviceName);
    res.json({ success: true, deviceSessionId: id });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/device-sessions/list', (req, res) => {
  const { restaurantId, role } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, role, 'admin.view', 'Admin view permission required');
    const devices = db.prepare(`
      SELECT ds.*, u.name AS user_name, u.role
      FROM device_sessions ds
      LEFT JOIN users u ON u.id = ds.user_id
      WHERE ds.active = 1
      ORDER BY ds.last_seen_at DESC
      LIMIT 100
    `).all();
    res.json({ success: true, devices });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/device-sessions/force-logout', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Device session required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'admin.settings.manage', 'Device monitor permission required');
    const oldValue = db.prepare('SELECT * FROM device_sessions WHERE id = ?').get(id);
    db.prepare('UPDATE device_sessions SET active = 0, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    writeAudit(db, actor, 'FORCE_LOGOUT', 'DEVICE_SESSION', id, oldValue, { id, active: 0 });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/lock', (req, res) => {
  const { restaurantId, actor, tableId, orderId, deviceName } = req.body;
  if (!restaurantId || !isPositiveId(tableId) || !isPositiveId(actor?.id)) return res.status(400).json({ success: false, message: 'Table and user are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'orders.create', 'Order creation permission required');
    touchDeviceSession(db, actor, req, deviceName);
    const existing = currentLockForTable(db, tableId);
    if (existing && Number(existing.locked_by_user_id) !== Number(actor.id)) {
      return res.status(409).json({ success: false, message: `Table currently being edited by ${existing.locked_by_name || 'another user'}`, lock: existing });
    }
    const openOrder = orderId
      ? db.prepare('SELECT id FROM orders WHERE id = ? AND payment_status != ?').get(orderId, 'PAID')
      : db.prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'OPEN' AND payment_status != 'PAID' ORDER BY id DESC LIMIT 1").get(tableId);
    if (existing) {
      db.prepare(`UPDATE order_locks SET order_id = ?, locked_at = CURRENT_TIMESTAMP, expires_at = ${lockExpirySql()} WHERE id = ?`)
        .run(openOrder?.id || orderId || null, existing.id);
      return res.json({ success: true, lock: db.prepare('SELECT * FROM order_locks WHERE id = ?').get(existing.id) });
    }
    const result = db.prepare(`INSERT INTO order_locks (order_id, table_id, locked_by_user_id, expires_at) VALUES (?, ?, ?, ${lockExpirySql()})`)
      .run(openOrder?.id || orderId || null, tableId, actor.id);
    res.json({ success: true, lock: db.prepare('SELECT * FROM order_locks WHERE id = ?').get(result.lastInsertRowid) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/lock/renew', (req, res) => {
  const { restaurantId, actor, lockId, tableId, deviceName } = req.body;
  if (!restaurantId || !isPositiveId(actor?.id)) return res.status(400).json({ success: false, message: 'User is required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    touchDeviceSession(db, actor, req, deviceName);
    cleanupExpiredLocks(db);
    const lock = lockId
      ? db.prepare('SELECT * FROM order_locks WHERE id = ?').get(lockId)
      : db.prepare('SELECT * FROM order_locks WHERE table_id = ?').get(tableId);
    if (!lock) throw new Error('Table lock expired');
    if (Number(lock.locked_by_user_id) !== Number(actor.id)) throw new Error('Table lock belongs to another user');
    db.prepare(`UPDATE order_locks SET locked_at = CURRENT_TIMESTAMP, expires_at = ${lockExpirySql()} WHERE id = ?`).run(lock.id);
    res.json({ success: true, lock: db.prepare('SELECT * FROM order_locks WHERE id = ?').get(lock.id) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/unlock', (req, res) => {
  const { restaurantId, actor, lockId, tableId } = req.body;
  if (!restaurantId || !isPositiveId(actor?.id)) return res.status(400).json({ success: false, message: 'User is required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const lock = lockId
      ? db.prepare('SELECT * FROM order_locks WHERE id = ?').get(lockId)
      : db.prepare('SELECT * FROM order_locks WHERE table_id = ?').get(tableId);
    if (lock && Number(lock.locked_by_user_id) !== Number(actor.id)) throw new Error('Table lock belongs to another user');
    if (lock) db.prepare('DELETE FROM order_locks WHERE id = ?').run(lock.id);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/force-unlock', (req, res) => {
  const { restaurantId, actor, tableId, orderId } = req.body;
  if (!restaurantId || (!isPositiveId(tableId) && !isPositiveId(orderId))) return res.status(400).json({ success: false, message: 'Table or order is required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'orders.cancel', 'Force unlock permission required');
    const oldValue = isPositiveId(tableId)
      ? db.prepare('SELECT * FROM order_locks WHERE table_id = ?').get(tableId)
      : db.prepare('SELECT * FROM order_locks WHERE order_id = ?').get(orderId);
    if (isPositiveId(tableId)) db.prepare('DELETE FROM order_locks WHERE table_id = ?').run(tableId);
    if (isPositiveId(orderId)) db.prepare('DELETE FROM order_locks WHERE order_id = ?').run(orderId);
    writeAudit(db, actor, 'FORCE_UNLOCK', 'ORDER_LOCK', oldValue?.id || null, oldValue, { tableId, orderId });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/submit-kot', (req, res) => {
  const { restaurantId, actor, orderId } = req.body;
  if (!restaurantId || !orderId || !canSell(actor?.role)) return res.status(400).json({ success: false, message: 'Order and sales permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    db.transaction(() => {
      createKotJobs(db, orderId);
      deductInventoryForOrder(db, actor, orderId, 'KOT_SUBMIT');
      const order = db.prepare('SELECT order_type FROM orders WHERE id = ?').get(orderId);
      if (order && DELIVERY_ORDER_TYPES.includes(order.order_type)) {
        db.prepare("UPDATE delivery_orders SET delivery_status = 'PREPARING' WHERE order_id = ? AND delivery_status IN ('RECEIVED', 'ACCEPTED')").run(orderId);
        writeOrderStatusHistory(db, actor, orderId, 'PREPARING', 'DELIVERY', 'KOT submitted');
      }
      writeAudit(db, actor, 'SUBMIT_KOT', 'ORDER', orderId);
    })();
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/cancel', (req, res) => {
  const { restaurantId, actor, orderId } = req.body;
  if (!restaurantId || !orderId || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Order and manager permission are required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'orders.cancel', 'Order cancel permission required');
    if (!getBooleanConfig(db, 'allow_order_cancel', true)) throw new Error('Order cancellation is disabled in settings');
    const oldValue = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const order = db.prepare('SELECT table_id FROM orders WHERE id = ?').get(orderId);
    db.prepare("UPDATE orders SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId);
    db.prepare("UPDATE delivery_orders SET delivery_status = 'CANCELLED' WHERE order_id = ?").run(orderId);
    if (order?.table_id) db.prepare("UPDATE tables SET status = 'AVAILABLE' WHERE id = ?").run(order.table_id);
    writeOrderStatusHistory(db, actor, orderId, 'CANCELLED', 'ORDER', 'Order cancelled');
    const newValue = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    writeAudit(db, actor, 'DELETE', 'ORDER', orderId, oldValue, newValue);
    writeCompliance(db, 'VOIDED_BILL', 'HIGH', `Order cancelled #${orderId}`, 'ORDER', orderId);
    createFraudAlert(db, 'VOIDED_BILL', 'HIGH', 'ORDER', orderId, `Order cancelled #${orderId}`);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/settle', (req, res) => {
  const { restaurantId, actor, orderId, customerId, redeemPoints, payments } = req.body;
  if (!restaurantId || !orderId || !Array.isArray(payments) || !canSell(actor?.role)) {
    return res.status(400).json({ success: false, message: 'Order, payments and sales permission are required' });
  }

  const paymentMethods = ['CASH', 'CARD', 'UPI'];
  if ((payments.length === 0 && Number(redeemPoints || 0) <= 0) || payments.some((payment) => !paymentMethods.includes(payment.method) || !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0)) {
    return res.status(400).json({ success: false, message: 'Payments must include valid methods and positive amounts' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'billing.settle', 'Billing settlement permission required');
    const settled = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new Error('Order not found');
      const cashRegisterSessionId = activeCashSessionForPayment(db, actor, payments);
      const linkedCustomerId = isPositiveId(customerId) ? Number(customerId) : order.customer_id;
      if (linkedCustomerId) {
        const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND active = 1').get(linkedCustomerId);
        if (!customer) throw new Error('Customer not found');
      }
      const pointValue = getSettingNumber(db, 'loyalty_point_value', 1);
      const redeem = Number(redeemPoints || 0);
      if (redeem > 0) requireModule(db, 'LOYALTY');
      if (!Number.isInteger(redeem) || redeem < 0) throw new Error('Redeem points must be a whole number');
      if (redeem > 0 && !linkedCustomerId) throw new Error('Customer required to redeem points');
      const balance = linkedCustomerId ? customerLoyaltyBalance(db, linkedCustomerId) : 0;
      if (redeem > balance) throw new Error('Insufficient loyalty points');
      const grossAmount = Number(order.total_amount || 0);
      const serviceCharge = serviceChargeForAmount(db, grossAmount);
      const payableBeforeRoundOff = Math.max(grossAmount + serviceCharge - Math.min(redeem * pointValue, grossAmount + serviceCharge), 0);
      const payable = applyRoundOff(db, payableBeforeRoundOff);
      const roundOff = payable - payableBeforeRoundOff;
      const loyaltyDiscount = Math.min(redeem * pointValue, grossAmount + serviceCharge);
      const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      if (paid < payable) throw new Error('Payment is less than payable total');
      const invoiceNo = order.invoice_no || invoiceNumberForOrder(db, orderId);

      if (redeem > 0) {
        const memberId = memberIdForCustomer(db, linkedCustomerId);
        db.prepare(`
          INSERT INTO loyalty_points (member_id, customer_id, order_id, points, type, note)
          VALUES (?, ?, ?, ?, 'REDEEM', ?)
        `).run(memberId, linkedCustomerId, orderId, redeem, 'Redeemed during billing');
      }

      payments.forEach((payment) => {
        const sessionId = payment.method === 'CASH' ? cashRegisterSessionId : null;
        const paymentResult = db.prepare('INSERT INTO payments (order_id, payment_mode, amount, reference_no, cash_register_session_id) VALUES (?, ?, ?, ?, ?)')
          .run(orderId, payment.method, payment.amount, payment.referenceNo || null, sessionId);
        writeAudit(db, actor, 'CREATE', 'PAYMENT', paymentResult.lastInsertRowid, null, {
          orderId,
          paymentMode: payment.method,
          amount: payment.amount,
          cashRegisterSessionId: sessionId,
          referenceNo: payment.referenceNo || null
        });
      });
      db.prepare(`
        UPDATE orders
        SET total_amount = ?, paid_amount = ?, payment_status = 'PAID', status = 'PAID', invoice_no = ?, settled_at = CURRENT_TIMESTAMP,
            customer_id = COALESCE(?, customer_id), redeemed_points = ?, loyalty_discount = ?
        WHERE id = ?
      `).run(payable, paid, invoiceNo, linkedCustomerId || null, redeem, loyaltyDiscount, orderId);
      if (linkedCustomerId) {
        db.prepare('INSERT INTO customer_visits (customer_id, order_id, amount) VALUES (?, ?, ?)')
          .run(linkedCustomerId, orderId, paid);
        const earnAmount = getSettingNumber(db, 'loyalty_earn_amount', 100);
        const earnedPoints = Math.floor(paid / earnAmount);
        if (earnedPoints > 0 && !db.prepare("SELECT id FROM loyalty_points WHERE customer_id = ? AND order_id = ? AND type = 'EARN' LIMIT 1").get(linkedCustomerId, orderId)) {
          const memberId = memberIdForCustomer(db, linkedCustomerId);
          db.prepare(`
            INSERT INTO loyalty_points (member_id, customer_id, order_id, points, type, note)
            VALUES (?, ?, ?, ?, 'EARN', ?)
          `).run(memberId, linkedCustomerId, orderId, earnedPoints, 'Earned from bill settlement');
        }
      }
      deductInventoryForOrder(db, actor, orderId, 'BILL_SETTLE');
      if (order.table_id) db.prepare("UPDATE tables SET status = 'AVAILABLE' WHERE id = ?").run(order.table_id);
      if (DELIVERY_ORDER_TYPES.includes(order.order_type)) {
        writeOrderStatusHistory(db, actor, orderId, 'PAID', 'ORDER', 'Bill settled');
      }
      db.prepare(`
        INSERT INTO print_jobs (type, ref_id, kitchen_id, printer_id, payload, status)
        VALUES ('BILL', ?, NULL, 1, ?, 'PENDING')
      `).run(orderId, JSON.stringify({
        orderId,
        invoiceNo,
        restaurantProfile: {
          displayName: getConfigValue(db, 'restaurant_display_name', ''),
          legalName: getConfigValue(db, 'legal_name', ''),
          gstin: getConfigValue(db, 'gstin', ''),
          addressLine1: getConfigValue(db, 'address_line_1', ''),
          addressLine2: getConfigValue(db, 'address_line_2', ''),
          city: getConfigValue(db, 'city', ''),
          state: getConfigValue(db, 'state', ''),
          country: getConfigValue(db, 'country', ''),
          phone: getConfigValue(db, 'phone', ''),
          email: getConfigValue(db, 'email', ''),
          currency: getConfigValue(db, 'currency', 'INR'),
          upiId: getConfigValue(db, 'upi_id', ''),
          showTaxOnBill: getBooleanConfig(db, 'show_tax_on_bill', true),
          showQrOnBill: getBooleanConfig(db, 'show_qr_on_bill', false)
        },
        payments,
        customerId: linkedCustomerId || null,
        redeemedPoints: redeem,
        loyaltyDiscount,
        serviceCharge,
        roundOff,
        payable
      }));
      const billSnapshot = {
        orderId,
        invoiceNo,
        payments,
        customerId: linkedCustomerId || null,
        redeemedPoints: redeem,
        loyaltyDiscount,
        serviceCharge,
        roundOff,
        payable,
        settledAt: new Date().toISOString()
      };
      insertElectronicJournal(db, 'BILL', orderId, billSnapshot);
      evaluateOrderFraud(db, orderId);
      if (linkedCustomerId) {
        const customer = db.prepare('SELECT phone, email FROM customers WHERE id = ?').get(linkedCustomerId);
        queueNotification(db, 'ORDER_CONFIRMATION', customer?.phone ? 'SMS' : 'EMAIL', customer?.phone || customer?.email || null, billSnapshot);
      }
      const newValue = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      writeAudit(db, actor, 'UPDATE', 'ORDER', orderId, order, newValue);
      if (Number(order.is_invoice) === 0) {
        writeCompliance(db, 'NON_INVOICE_ORDER', 'MEDIUM', `Non-invoice order settled #${orderId}`, 'ORDER', orderId);
      }
      return { invoiceNo, paid, payable, redeemedPoints: redeem, loyaltyDiscount, serviceCharge, roundOff };
    })();

    res.json({ success: true, invoiceNo: settled.invoiceNo, paidAmount: settled.paid, payable: settled.payable, redeemedPoints: settled.redeemedPoints, loyaltyDiscount: settled.loyaltyDiscount, serviceCharge: settled.serviceCharge, roundOff: settled.roundOff });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/delivery/partners', (req, res) => {
  const { restaurantId, includeInactive } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const partners = db.prepare(`
      SELECT * FROM delivery_partners
      WHERE (? = 'true' OR active = 1)
      ORDER BY name
    `).all(includeInactive === 'true' ? 'true' : 'false');
    res.json({ success: true, partners });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/delivery/partners/save', (req, res) => {
  const { restaurantId, actor, id, name, phone } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !hasText(name)) {
    return res.status(400).json({ success: false, message: 'Partner name and permission are required' });
  }
  if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone.trim())) {
    return res.status(400).json({ success: false, message: 'Partner phone is invalid' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      const oldValue = isPositiveId(id) ? db.prepare('SELECT * FROM delivery_partners WHERE id = ?').get(id) : null;
      const duplicate = db.prepare(`
        SELECT id FROM delivery_partners
        WHERE LOWER(name) = LOWER(?) AND active = 1 AND (? IS NULL OR id != ?)
        LIMIT 1
      `).get(normaliseText(name), isPositiveId(id) ? id : null, isPositiveId(id) ? id : null);
      if (duplicate) throw new Error('Delivery partner already exists');
      let partnerId = id;
      if (isPositiveId(id)) {
        db.prepare('UPDATE delivery_partners SET name = ?, phone = ? WHERE id = ?').run(normaliseText(name), normaliseText(phone) || null, id);
      } else {
        partnerId = db.prepare('INSERT INTO delivery_partners (name, phone) VALUES (?, ?)').run(normaliseText(name), normaliseText(phone) || null).lastInsertRowid;
      }
      const newValue = db.prepare('SELECT * FROM delivery_partners WHERE id = ?').get(partnerId);
      writeAudit(db, actor, isPositiveId(id) ? 'UPDATE' : 'CREATE', 'DELIVERY_PARTNER', partnerId, oldValue, newValue);
      return newValue;
    })();
    res.json({ success: true, partner: saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/delivery/partners/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !isPositiveId(id) || !canManage(actor?.role)) {
    return res.status(400).json({ success: false, message: 'Partner and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM delivery_partners WHERE id = ?').get(id);
    if (!oldValue) return res.status(404).json({ success: false, message: 'Delivery partner not found' });
    db.prepare('UPDATE delivery_partners SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM delivery_partners WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'DELIVERY_PARTNER', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/orders/live', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const orders = db.prepare(`
      SELECT
        o.id,
        o.order_type,
        o.table_no,
        o.status,
        o.payment_status,
        o.total_amount,
        o.delivery_fee,
        o.created_at,
        c.name AS customer_name,
        c.phone AS customer_phone,
        d.delivery_address,
        d.delivery_phone,
        d.delivery_status,
        d.expected_delivery_time,
        d.delivery_partner_id,
        dp.name AS delivery_partner_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN delivery_orders d ON d.order_id = o.id
      LEFT JOIN delivery_partners dp ON dp.id = d.delivery_partner_id
      WHERE o.payment_status != 'PAID'
        AND o.status NOT IN ('CANCELLED', 'PAID')
      ORDER BY o.created_at DESC
      LIMIT 100
    `).all();
    res.json({ success: true, orders });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/update-status', (req, res) => {
  const { restaurantId, actor, orderId, status } = req.body;
  if (!restaurantId || !isPositiveId(orderId) || !DELIVERY_STATUSES.includes(status) || !canManage(actor?.role)) {
    return res.status(400).json({ success: false, message: 'Valid order status and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const updated = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new Error('Order not found');
      const oldDelivery = db.prepare('SELECT * FROM delivery_orders WHERE order_id = ?').get(orderId);
      if (status === 'CANCELLED') {
        db.prepare("UPDATE orders SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP) WHERE id = ?").run(orderId);
        if (order.table_id) db.prepare("UPDATE tables SET status = 'AVAILABLE' WHERE id = ?").run(order.table_id);
      } else if (order.status === 'CANCELLED') {
        throw new Error('Cancelled orders must be reopened before status changes');
      }
      if (oldDelivery) {
        db.prepare('UPDATE delivery_orders SET delivery_status = ? WHERE order_id = ?').run(status, orderId);
      } else if (status !== 'CANCELLED') {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
      }
      writeOrderStatusHistory(db, actor, orderId, status, oldDelivery ? 'DELIVERY' : 'ORDER', 'Status updated from order management');
      const newOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      writeAudit(db, actor, 'UPDATE_STATUS', 'ORDER', orderId, order, newOrder);
      return newOrder;
    })();
    res.json({ success: true, order: updated });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/assign-delivery-partner', (req, res) => {
  const { restaurantId, actor, orderId, deliveryPartnerId } = req.body;
  if (!restaurantId || !isPositiveId(orderId) || !isPositiveId(deliveryPartnerId) || !canManage(actor?.role)) {
    return res.status(400).json({ success: false, message: 'Order, delivery partner and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM delivery_orders WHERE order_id = ?').get(orderId);
    if (!oldValue) return res.status(404).json({ success: false, message: 'Delivery order not found' });
    if (!db.prepare('SELECT id FROM delivery_partners WHERE id = ? AND active = 1').get(deliveryPartnerId)) {
      return res.status(404).json({ success: false, message: 'Delivery partner not found' });
    }
    db.prepare('UPDATE delivery_orders SET delivery_partner_id = ? WHERE order_id = ?').run(deliveryPartnerId, orderId);
    writeOrderStatusHistory(db, actor, orderId, 'PARTNER_ASSIGNED', 'DELIVERY', `Partner ${deliveryPartnerId} assigned`);
    const newValue = db.prepare('SELECT * FROM delivery_orders WHERE order_id = ?').get(orderId);
    writeAudit(db, actor, 'UPDATE', 'DELIVERY_ORDER', oldValue.id, oldValue, newValue);
    res.json({ success: true, deliveryOrder: newValue });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/orders/reopen', (req, res) => {
  const { restaurantId, actor, orderId } = req.body;
  if (!restaurantId || !isPositiveId(orderId) || !canManage(actor?.role)) {
    return res.status(400).json({ success: false, message: 'Order and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.payment_status === 'PAID') return res.status(400).json({ success: false, message: 'Paid orders cannot be reopened' });
    db.prepare("UPDATE orders SET status = 'OPEN', cancelled_at = NULL WHERE id = ?").run(orderId);
    db.prepare("UPDATE delivery_orders SET delivery_status = 'RECEIVED' WHERE order_id = ?").run(orderId);
    if (order.table_id) db.prepare("UPDATE tables SET status = 'OCCUPIED' WHERE id = ?").run(order.table_id);
    writeOrderStatusHistory(db, actor, orderId, 'REOPENED', 'ORDER', 'Unpaid order reopened');
    const newValue = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    writeAudit(db, actor, 'REOPEN', 'ORDER', orderId, order, newValue);
    res.json({ success: true, order: newValue });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/reports/order-types', (req, res) => {
  const { restaurantId, fromDate, toDate } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const params = [fromDate || '1970-01-01', toDate || '2999-12-31'];
    const orderTypeSummary = db.prepare(`
      SELECT order_type, COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS sales
      FROM orders
      WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY order_type
      ORDER BY sales DESC
    `).all(...params);
    const deliverySales = orderTypeSummary.filter((row) => ['DELIVERY', 'PHONE_ORDER', 'ONLINE_ORDER'].includes(row.order_type));
    const takeawaySales = orderTypeSummary.filter((row) => ['TAKEAWAY', 'PARCEL'].includes(row.order_type));
    const deliveryPartnerReport = db.prepare(`
      SELECT dp.id, dp.name, COUNT(d.order_id) AS order_count, COALESCE(SUM(o.total_amount), 0) AS sales, COALESCE(SUM(d.delivery_fee), 0) AS delivery_fees
      FROM delivery_orders d
      LEFT JOIN delivery_partners dp ON dp.id = d.delivery_partner_id
      JOIN orders o ON o.id = d.order_id
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY dp.id, dp.name
      ORDER BY sales DESC
    `).all(...params);
    res.json({ success: true, orderTypeSummary, deliverySales, takeawaySales, deliveryPartnerReport });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// KITCHEN DISPLAY SYSTEM
// ========================

app.get('/kds/orders', (req, res) => {
  const { restaurantId, kitchenId, role } = req.query;
  if (!restaurantId || !isPositiveId(kitchenId) || !canUseKds(role)) {
    return res.status(400).json({ success: false, message: 'Kitchen, restaurant and KDS permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT
        o.id AS order_id,
        o.table_no,
        o.order_type,
        o.created_at AS order_created_at,
        oi.id AS order_item_id,
        oi.item_id,
        oi.quantity,
        oi.price,
        CASE WHEN oi.status = 'PLACED' THEN 'PENDING' ELSE oi.status END AS status,
        oi.started_at,
        oi.ready_at,
        oi.served_at,
        i.name AS item_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN items i ON i.id = oi.item_id
      WHERE oi.kitchen_id = ?
        AND o.status != 'CANCELLED'
        AND COALESCE(oi.status, 'PLACED') NOT IN ('SERVED', 'CANCELLED')
      ORDER BY o.created_at, oi.id
    `).all(kitchenId);

    const modifiersByItem = rows.length === 0 ? {} : db.prepare(`
      SELECT order_item_id, name, price_delta
      FROM order_item_modifiers
      WHERE order_item_id IN (${rows.map(() => '?').join(',')})
      ORDER BY id
    `).all(...rows.map((row) => row.order_item_id)).reduce((map, modifier) => {
      map[modifier.order_item_id] ||= [];
      map[modifier.order_item_id].push({ name: modifier.name, priceDelta: modifier.price_delta });
      return map;
    }, {});

    const orders = rows.reduce((map, row) => {
      map[row.order_id] ||= {
        orderId: row.order_id,
        tableName: row.table_no || row.order_type || 'Parcel',
        createdAt: row.order_created_at,
        items: []
      };
      map[row.order_id].items.push({
        orderItemId: row.order_item_id,
        itemId: row.item_id,
        name: row.item_name,
        quantity: row.quantity,
        price: row.price,
        status: row.status || 'PENDING',
        startedAt: row.started_at,
        readyAt: row.ready_at,
        servedAt: row.served_at,
        modifiers: modifiersByItem[row.order_item_id] || []
      });
      return map;
    }, {});

    res.json({ success: true, orders: Object.values(orders) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/kds/item-status', (req, res) => {
  const { restaurantId, actor, orderItemId, status } = req.body;
  const statuses = ['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
  if (!restaurantId || !canUseKds(actor?.role) || !isPositiveId(orderItemId) || !statuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Valid item, status and KDS permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM order_items WHERE id = ?').get(orderItemId);
    if (!oldValue) throw new Error('Order item not found');
    const timestampColumn = kdsTimestampColumn(status);
    if (timestampColumn) {
      db.prepare(`UPDATE order_items SET status = ?, ${timestampColumn} = CURRENT_TIMESTAMP WHERE id = ?`).run(status, orderItemId);
    } else {
      db.prepare('UPDATE order_items SET status = ? WHERE id = ?').run(status === 'PENDING' ? 'PLACED' : status, orderItemId);
    }
    const newValue = db.prepare('SELECT * FROM order_items WHERE id = ?').get(orderItemId);
    writeAudit(db, actor, 'UPDATE', 'KDS_ITEM', orderItemId, oldValue, newValue);
    trackModuleUsage(restaurantId, 'KDS', 'ITEM_STATUS_UPDATED').catch(() => {});
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/kds/order-status', (req, res) => {
  const { restaurantId, actor, orderId, kitchenId, status } = req.body;
  const statuses = ['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
  if (!restaurantId || !canUseKds(actor?.role) || !isPositiveId(orderId) || !statuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Valid order, status and KDS permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT id, order_id, status, kitchen_id FROM order_items WHERE order_id = ?').all(orderId);
    const timestampColumn = kdsTimestampColumn(status);
    const params = [status === 'PENDING' ? 'PLACED' : status, orderId];
    let sql = 'UPDATE order_items SET status = ?';
    if (timestampColumn) sql += `, ${timestampColumn} = CURRENT_TIMESTAMP`;
    sql += ' WHERE order_id = ?';
    if (isPositiveId(kitchenId)) {
      sql += ' AND kitchen_id = ?';
      params.push(kitchenId);
    }
    db.prepare(sql).run(...params);
    const newValue = db.prepare('SELECT id, order_id, status, kitchen_id FROM order_items WHERE order_id = ?').all(orderId);
    writeAudit(db, actor, 'UPDATE', 'KDS_ORDER', orderId, oldValue, newValue);
    trackModuleUsage(restaurantId, 'KDS', 'ORDER_STATUS_UPDATED').catch(() => {});
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// CUSTOMER CRM & LOYALTY
// ========================

app.get('/customers/search', (req, res) => {
  const { restaurantId, phone } = req.query;
  if (!restaurantId || !hasText(phone)) return res.status(400).json({ success: false, message: 'Phone is required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE phone = ? AND active = 1 LIMIT 1').get(normaliseText(phone));
    res.json({ success: true, customer: customerWithBalance(db, customer) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/customers/list', (req, res) => {
  const { restaurantId, includeInactive } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const customers = db.prepare(`
      SELECT c.*, COALESCE(SUM(CASE WHEN lp.type = 'EARN' OR lp.type = 'ADJUSTMENT' THEN lp.points WHEN lp.type = 'REDEEM' THEN -lp.points ELSE 0 END), 0) AS loyaltyBalance
      FROM customers c
      LEFT JOIN loyalty_points lp ON lp.customer_id = c.id
      WHERE (? = 'true' OR c.active = 1)
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all(includeInactive);
    res.json({ success: true, customers });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/customers/create', (req, res) => {
  const { restaurantId, actor, name, phone, email, birthday, address } = req.body;
  if (!restaurantId || !hasText(name) || !hasText(phone)) return res.status(400).json({ success: false, message: 'Customer name and phone are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const duplicate = db.prepare('SELECT id FROM customers WHERE phone = ? AND active = 1 LIMIT 1').get(normaliseText(phone));
    if (duplicate) return res.status(409).json({ success: false, message: 'Customer phone already exists' });
    const result = db.prepare('INSERT INTO customers (name, phone, email, birthday, address) VALUES (?, ?, ?, ?, ?)')
      .run(normaliseText(name), normaliseText(phone), normaliseText(email) || null, birthday || null, normaliseText(address) || null);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
    writeAudit(db, actor, 'CREATE', 'CUSTOMER', result.lastInsertRowid, null, customer);
    trackModuleUsage(restaurantId, 'LOYALTY', 'CUSTOMER_CREATED').catch(() => {});
    res.json({ success: true, customer: customerWithBalance(db, customer) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/customers/update', (req, res) => {
  const { restaurantId, actor, id, name, phone, email, birthday, address } = req.body;
  if (!restaurantId || !isPositiveId(id) || !hasText(name) || !hasText(phone)) return res.status(400).json({ success: false, message: 'Customer id, name and phone are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const duplicate = db.prepare('SELECT id FROM customers WHERE phone = ? AND active = 1 AND id != ? LIMIT 1').get(normaliseText(phone), id);
    if (duplicate) return res.status(409).json({ success: false, message: 'Customer phone already exists' });
    const oldValue = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    db.prepare('UPDATE customers SET name = ?, phone = ?, email = ?, birthday = ?, address = ?, active = 1 WHERE id = ?')
      .run(normaliseText(name), normaliseText(phone), normaliseText(email) || null, birthday || null, normaliseText(address) || null, id);
    const newValue = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    writeAudit(db, actor, 'UPDATE', 'CUSTOMER', id, oldValue, newValue);
    res.json({ success: true, customer: customerWithBalance(db, newValue) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/customers/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !isPositiveId(id) || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Customer and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'CUSTOMER', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/customers/notes/create', (req, res) => {
  const { restaurantId, actor, customerId, note } = req.body;
  if (!restaurantId || !isPositiveId(customerId) || !hasText(note) || !canManage(actor?.role)) return res.status(400).json({ success: false, message: 'Customer note and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const result = db.prepare('INSERT INTO customer_notes (customer_id, note, created_by) VALUES (?, ?, ?)').run(customerId, normaliseText(note), actor?.id || null);
    const newValue = db.prepare('SELECT * FROM customer_notes WHERE id = ?').get(result.lastInsertRowid);
    writeAudit(db, actor, 'CREATE', 'CUSTOMER_NOTE', result.lastInsertRowid, null, newValue);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/customers/profile', (req, res) => {
  const { restaurantId, customerId } = req.query;
  if (!restaurantId || !isPositiveId(customerId)) return res.status(400).json({ success: false, message: 'customerId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    const visits = db.prepare(`
      SELECT cv.*, o.invoice_no, o.table_no, o.total_amount
      FROM customer_visits cv
      LEFT JOIN orders o ON o.id = cv.order_id
      WHERE cv.customer_id = ?
      ORDER BY cv.visit_at DESC
    `).all(customerId);
    const notes = db.prepare('SELECT * FROM customer_notes WHERE customer_id = ? AND active = 1 ORDER BY created_at DESC').all(customerId);
    const ledger = db.prepare('SELECT * FROM loyalty_points WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    const spend = db.prepare('SELECT COALESCE(SUM(amount), 0) AS totalSpend, COUNT(*) AS visits FROM customer_visits WHERE customer_id = ?').get(customerId);
    res.json({ success: true, customer: customerWithBalance(db, customer), visits, notes, ledger, totalSpend: spend.totalSpend, visitCount: spend.visits });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/customers/reports', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      topCustomers: db.prepare(`
        SELECT c.id, c.name, c.phone, COUNT(cv.id) AS visits, COALESCE(SUM(cv.amount), 0) AS total_spend
        FROM customers c LEFT JOIN customer_visits cv ON cv.customer_id = c.id
        WHERE c.active = 1
        GROUP BY c.id ORDER BY total_spend DESC LIMIT 10
      `).all(),
      repeatCustomers: db.prepare(`
        SELECT c.id, c.name, c.phone, COUNT(cv.id) AS visits
        FROM customers c JOIN customer_visits cv ON cv.customer_id = c.id
        WHERE c.active = 1
        GROUP BY c.id HAVING COUNT(cv.id) > 1
        ORDER BY visits DESC
      `).all(),
      inactiveCustomers: db.prepare(`
        SELECT c.id, c.name, c.phone, MAX(cv.visit_at) AS last_visit
        FROM customers c LEFT JOIN customer_visits cv ON cv.customer_id = c.id
        WHERE c.active = 1
        GROUP BY c.id
        HAVING last_visit IS NULL OR DATE(last_visit) < DATE('now', '-60 day')
        ORDER BY last_visit
      `).all(),
      birthdayCustomers: db.prepare(`
        SELECT id, name, phone, birthday FROM customers
        WHERE active = 1 AND birthday IS NOT NULL AND strftime('%m', birthday) = strftime('%m', 'now')
        ORDER BY strftime('%d', birthday)
      `).all(),
      loyaltySummary: db.prepare(`
        SELECT type, COALESCE(SUM(points), 0) AS points, COUNT(*) AS rows
        FROM loyalty_points
        WHERE customer_id IS NOT NULL
        GROUP BY type
      `).all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/loyalty/settings', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      earnAmount: getSettingNumber(db, 'loyalty_earn_amount', 100),
      pointValue: getSettingNumber(db, 'loyalty_point_value', 1)
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/loyalty/settings', (req, res) => {
  const { restaurantId, actor, earnAmount, pointValue } = req.body;
  if (!restaurantId || !isPositiveNumber(earnAmount) || !isPositiveNumber(pointValue)) {
    return res.status(400).json({ success: false, message: 'Valid loyalty settings and permission are required' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, actor?.role, 'admin.settings.manage', 'Settings permission required');
    const oldValue = db.prepare("SELECT * FROM settings WHERE key IN ('loyalty_earn_amount', 'loyalty_point_value')").all();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('loyalty_earn_amount', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").run(String(Number(earnAmount)));
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('loyalty_point_value', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").run(String(Number(pointValue)));
    const newValue = db.prepare("SELECT * FROM settings WHERE key IN ('loyalty_earn_amount', 'loyalty_point_value')").all();
    writeAudit(db, actor, 'UPDATE', 'LOYALTY_SETTINGS', null, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/reports/dashboard', (req, res) => {
  const { restaurantId, fromDate, toDate, role } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const from = fromDate || new Date().toISOString().slice(0, 10);
  const to = toDate || from;

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (role) {
      requirePermission(db, role, canRole(db, role, 'reports.view_all') ? 'reports.view_all' : 'reports.view_invoice_only', 'Reports permission required');
    }
    res.json({
      success: true,
      dailySales: db.prepare(`
        SELECT DATE(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total_amount), 0) AS total
        FROM orders WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN DATE(?) AND DATE(?) GROUP BY DATE(created_at)
      `).all(from, to),
      topSellingItems: db.prepare(`
        SELECT i.name, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.price) AS total
        FROM order_items oi JOIN items i ON i.id = oi.item_id JOIN orders o ON o.id = oi.order_id
        WHERE o.payment_status = 'PAID' AND DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
        GROUP BY i.id ORDER BY quantity DESC LIMIT 10
      `).all(from, to),
      orderSummary: db.prepare(`
        SELECT status, payment_status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total
        FROM orders WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?) GROUP BY status, payment_status
      `).all(from, to),
      taxSummary: db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) AS taxableSales, COALESCE(SUM(tax_amount), 0) AS tax
        FROM orders WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN DATE(?) AND DATE(?)
      `).get(from, to)
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// RESTAURANT SETTINGS & CONFIGURATION CENTER
// ========================
// Local settings are stored in the per-restaurant SQLite system_config table so POS stays offline-capable.

function canManageSettings(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER_2'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'admin.settings.manage');
  } finally {
    db.close();
  }
}

app.get('/settings', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, settings: getAllSettings(db) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/settings/update', (req, res) => {
  const { restaurantId, actor, settings, updatedByRole } = req.body;
  const role = actor?.role || updatedByRole;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, role, 'admin.settings.manage', 'Settings permission required');
    const safeSettings = normaliseSettingsInput(settings);
    const oldValue = {};
    Object.keys(safeSettings).forEach((key) => {
      oldValue[key] = getConfigValue(db, key, DEFAULT_SYSTEM_SETTINGS[key]);
    });
    setConfigValues(db, safeSettings);
    const newValue = {};
    Object.keys(safeSettings).forEach((key) => {
      newValue[key] = getConfigValue(db, key, DEFAULT_SYSTEM_SETTINGS[key]);
    });
    writeAudit(db, actorFromRole(role), 'UPDATE', 'SETTINGS', Object.keys(safeSettings).join(','), oldValue, newValue);
    res.json({ success: true, settings: getAllSettings(db) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/settings/reset-defaults', (req, res) => {
  const { restaurantId, actor, updatedByRole } = req.body;
  const role = actor?.role || updatedByRole;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    requirePermission(db, role, 'admin.settings.manage', 'Settings permission required');
    const oldValue = getAllSettings(db);
    setConfigValues(db, DEFAULT_SYSTEM_SETTINGS);
    const newValue = getAllSettings(db);
    writeAudit(db, actorFromRole(role), 'RESET_DEFAULTS', 'SETTINGS', null, oldValue, newValue);
    res.json({ success: true, settings: newValue });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// ROLE-BASED ACCESS CONTROL & PERMISSION MATRIX
// ========================

app.get('/permissions/bootstrap', (req, res) => {
  const { restaurantId, role } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    seedDefaultPermissions(db);
    const currentRole = role || 'WAITER';
    const currentPermissions = permissionsForRole(db, currentRole).filter((permission) => Number(permission.allowed) === 1).map((permission) => permission.code);
    const response = { success: true, role: currentRole, currentPermissions };
    if (currentRole === 'OWNER') {
      response.roles = db.prepare('SELECT * FROM roles WHERE active = 1 ORDER BY name').all();
      response.permissions = db.prepare('SELECT * FROM permissions WHERE active = 1 ORDER BY module, code').all();
      response.matrix = db.prepare(`
        SELECT r.name AS role, p.code AS permission_code, COALESCE(rp.allowed, 0) AS allowed
        FROM roles r
        CROSS JOIN permissions p
        LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
        WHERE r.active = 1 AND p.active = 1
        ORDER BY r.name, p.module, p.code
      `).all();
    }
    res.json(response);
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/permissions/update', (req, res) => {
  const { restaurantId, actor, role, permissions } = req.body;
  if (!restaurantId || actor?.role !== 'OWNER' || !hasText(role) || !permissions || typeof permissions !== 'object') {
    return res.status(403).json({ success: false, message: 'Only OWNER can edit permissions' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      seedDefaultPermissions(db);
      const targetRole = db.prepare('SELECT * FROM roles WHERE name = ? AND active = 1').get(role);
      if (!targetRole) throw new Error('Role not found');
      const permissionRows = db.prepare('SELECT * FROM permissions WHERE active = 1').all();
      const oldValue = db.prepare(`
        SELECT p.code, COALESCE(rp.allowed, 0) AS allowed
        FROM permissions p
        LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = ?
        WHERE p.active = 1
      `).all(targetRole.id);
      const upsert = db.prepare(`
        INSERT INTO role_permissions (role_id, permission_id, allowed)
        VALUES (?, ?, ?)
        ON CONFLICT(role_id, permission_id) DO UPDATE SET allowed = excluded.allowed
      `);
      permissionRows.forEach((permission) => {
        if (Object.prototype.hasOwnProperty.call(permissions, permission.code)) {
          upsert.run(targetRole.id, permission.id, permissions[permission.code] ? 1 : 0);
        }
      });
      const newValue = db.prepare(`
        SELECT p.code, COALESCE(rp.allowed, 0) AS allowed
        FROM permissions p
        LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = ?
        WHERE p.active = 1
      `).all(targetRole.id);
      writeAudit(db, actor, 'UPDATE', 'ROLE_PERMISSIONS', role, oldValue, newValue);
      return permissionsForRole(db, role);
    })();
    res.json({ success: true, permissions: saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// STAFF ATTENDANCE, SHIFTS & CASH REGISTER
// ========================

app.post('/attendance/clock-in', (req, res) => {
  const { restaurantId, actor, userId, openingNote } = req.body;
  const staffUserId = Number(userId || actor?.id);
  if (!restaurantId || !isPositiveId(staffUserId)) return res.status(400).json({ success: false, message: 'User is required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (currentAttendance(db, staffUserId)) throw new Error('User is already clocked in');
    const result = db.prepare('INSERT INTO staff_attendance (user_id, opening_note, status) VALUES (?, ?, ?)')
      .run(staffUserId, normaliseText(openingNote) || null, 'OPEN');
    const row = db.prepare('SELECT * FROM staff_attendance WHERE id = ?').get(result.lastInsertRowid);
    writeAudit(db, actor || { id: staffUserId, role: 'STAFF' }, 'CLOCK_IN', 'STAFF_ATTENDANCE', result.lastInsertRowid, null, row);
    res.json({ success: true, attendance: row });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/attendance/clock-out', (req, res) => {
  const { restaurantId, actor, userId, closingNote } = req.body;
  const staffUserId = Number(userId || actor?.id);
  if (!restaurantId || !isPositiveId(staffUserId)) return res.status(400).json({ success: false, message: 'User is required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = currentAttendance(db, staffUserId);
    if (!oldValue) throw new Error('User is not clocked in');
    db.prepare("UPDATE staff_attendance SET status = 'CLOSED', clock_out_at = CURRENT_TIMESTAMP, closing_note = ? WHERE id = ?")
      .run(normaliseText(closingNote) || null, oldValue.id);
    const row = db.prepare(`
      SELECT *, ROUND((JULIANDAY(clock_out_at) - JULIANDAY(clock_in_at)) * 24 * 60, 0) AS duration_minutes
      FROM staff_attendance WHERE id = ?
    `).get(oldValue.id);
    writeAudit(db, actor || { id: staffUserId, role: 'STAFF' }, 'CLOCK_OUT', 'STAFF_ATTENDANCE', oldValue.id, oldValue, row);
    res.json({ success: true, attendance: row });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/attendance/current', (req, res) => {
  const { restaurantId, userId } = req.query;
  if (!restaurantId || !isPositiveId(userId)) return res.status(400).json({ success: false, message: 'restaurantId and userId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, attendance: currentAttendance(db, userId) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/attendance/report', (req, res) => {
  const { restaurantId, role, fromDate, toDate, userId } = req.query;
  if (!restaurantId || !canViewStaffReports(role)) return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const params = [fromDate || '1970-01-01', toDate || '2999-12-31'];
    const userClause = isPositiveId(userId) ? 'AND sa.user_id = ?' : '';
    if (userClause) params.push(Number(userId));
    const rows = db.prepare(`
      SELECT sa.*, u.name AS user_name, u.role,
             ROUND((JULIANDAY(COALESCE(sa.clock_out_at, CURRENT_TIMESTAMP)) - JULIANDAY(sa.clock_in_at)) * 24 * 60, 0) AS duration_minutes
      FROM staff_attendance sa
      LEFT JOIN users u ON u.id = sa.user_id
      WHERE DATE(sa.clock_in_at) BETWEEN DATE(?) AND DATE(?)
      ${userClause}
      ORDER BY sa.clock_in_at DESC
    `).all(...params);
    res.json({ success: true, attendance: rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/cash-register/open', (req, res) => {
  const { restaurantId, actor, openingCash, note } = req.body;
  if (!restaurantId || !canUseCashRegister(actor?.role) || !isPositiveId(actor?.id)) {
    return res.status(403).json({ success: false, message: 'Cash register permission and user are required' });
  }
  if (!isValidAmount(openingCash)) return res.status(400).json({ success: false, message: 'Opening cash must be numeric and >= 0' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (currentCashSession(db)) throw new Error('A cash register session is already open');
    const result = db.prepare('INSERT INTO cash_register_sessions (opened_by, opening_cash, note, status) VALUES (?, ?, ?, ?)')
      .run(actor.id, Number(openingCash), normaliseText(note) || null, 'OPEN');
    const row = db.prepare('SELECT * FROM cash_register_sessions WHERE id = ?').get(result.lastInsertRowid);
    writeAudit(db, actor, 'OPEN', 'CASH_REGISTER_SESSION', row.id, null, row);
    res.json({ success: true, session: row });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/cash-register/current', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const session = currentCashSession(db);
    res.json({ success: true, session, expectedCash: session ? expectedCashForSession(db, session.id) : 0 });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/cash-register/movement', (req, res) => {
  const { restaurantId, actor, type, amount, reason } = req.body;
  if (!restaurantId || !canUseCashRegister(actor?.role) || !isPositiveId(actor?.id)) {
    return res.status(403).json({ success: false, message: 'Cash register permission and user are required' });
  }
  if (!['CASH_IN', 'CASH_OUT', 'PAYOUT', 'ADJUSTMENT'].includes(type)) return res.status(400).json({ success: false, message: 'Invalid cash movement type' });
  if (!isPositiveNumber(amount)) return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const session = currentCashSession(db);
    if (!session) throw new Error('No open cash register session');
    const result = db.prepare('INSERT INTO cash_drawer_movements (session_id, type, amount, reason, performed_by) VALUES (?, ?, ?, ?, ?)')
      .run(session.id, type, Number(amount), normaliseText(reason) || null, actor.id);
    const row = db.prepare('SELECT * FROM cash_drawer_movements WHERE id = ?').get(result.lastInsertRowid);
    writeAudit(db, actor, type, 'CASH_DRAWER_MOVEMENT', row.id, null, row);
    res.json({ success: true, movement: row, expectedCash: expectedCashForSession(db, session.id) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/cash-register/close', (req, res) => {
  const { restaurantId, actor, closingCash, note } = req.body;
  if (!restaurantId || !canUseCashRegister(actor?.role) || !isPositiveId(actor?.id)) {
    return res.status(403).json({ success: false, message: 'Cash register permission and user are required' });
  }
  if (!isValidAmount(closingCash)) return res.status(400).json({ success: false, message: 'Closing cash must be numeric and >= 0' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = currentCashSession(db);
    if (!oldValue) throw new Error('No open cash register session');
    const expectedCash = expectedCashForSession(db, oldValue.id);
    const difference = Number(closingCash) - expectedCash;
    const threshold = getNumberConfig(db, 'cash_discrepancy_threshold', 0);
    const hasDiscrepancy = Math.abs(difference) > threshold;
    const cashierCanClose = getBooleanConfig(db, 'allow_cashier_register_close', false);
    if (hasDiscrepancy && !['OWNER', 'MANAGER_2'].includes(actor.role)) throw new Error('Only OWNER or MANAGER_2 can close with cash discrepancy');
    if (!hasDiscrepancy && !cashierCanClose && !['OWNER', 'MANAGER_2'].includes(actor.role)) throw new Error('Only OWNER or MANAGER_2 can close register');
    db.prepare(`
      UPDATE cash_register_sessions
      SET status = 'CLOSED', closed_by = ?, closed_at = CURRENT_TIMESTAMP, closing_cash = ?, expected_cash = ?, cash_difference = ?, note = COALESCE(?, note)
      WHERE id = ?
    `).run(actor.id, Number(closingCash), expectedCash, difference, normaliseText(note) || null, oldValue.id);
    const row = db.prepare('SELECT * FROM cash_register_sessions WHERE id = ?').get(oldValue.id);
    writeAudit(db, actor, 'CLOSE', 'CASH_REGISTER_SESSION', row.id, oldValue, row);
    if (hasDiscrepancy) writeCompliance(db, 'CASH_DISCREPANCY', 'HIGH', `Cash discrepancy ${difference.toFixed(2)} on session #${row.id}`, 'CASH_REGISTER_SESSION', row.id);
    res.json({ success: true, session: row, expectedCash, cashDifference: difference });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/cash-register/report', (req, res) => {
  const { restaurantId, role, fromDate, toDate } = req.query;
  if (!restaurantId || !canViewStaffReports(role)) return res.status(403).json({ success: false, message: 'OWNER or MANAGER_2 required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const params = [fromDate || '1970-01-01', toDate || '2999-12-31'];
    const sessions = db.prepare(`
      SELECT crs.*, ou.name AS opened_by_name, cu.name AS closed_by_name
      FROM cash_register_sessions crs
      LEFT JOIN users ou ON ou.id = crs.opened_by
      LEFT JOIN users cu ON cu.id = crs.closed_by
      WHERE DATE(crs.opened_at) BETWEEN DATE(?) AND DATE(?)
      ORDER BY crs.opened_at DESC
    `).all(...params);
    const movements = db.prepare(`
      SELECT cdm.*, u.name AS performed_by_name
      FROM cash_drawer_movements cdm
      LEFT JOIN users u ON u.id = cdm.performed_by
      WHERE DATE(cdm.created_at) BETWEEN DATE(?) AND DATE(?)
      ORDER BY cdm.created_at DESC
    `).all(...params);
    const discrepancies = sessions.filter((session) => Math.abs(Number(session.cash_difference || 0)) > 0);
    res.json({ success: true, sessions, movements, discrepancies });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// MODIFIERS & COMBOS
// ========================

app.get('/modifiers/bootstrap', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      groups: db.prepare('SELECT * FROM modifier_groups WHERE active = 1 ORDER BY name').all(),
      modifiers: db.prepare(`
        SELECT m.*, mg.name AS group_name
        FROM modifiers m
        JOIN modifier_groups mg ON mg.id = m.group_id
        WHERE m.active = 1 AND mg.active = 1
        ORDER BY mg.name, m.name
      `).all(),
      assignments: db.prepare(`
        SELECT img.id, img.item_id, img.group_id, i.name AS item_name, mg.name AS group_name
        FROM item_modifier_groups img
        JOIN items i ON i.id = img.item_id
        JOIN modifier_groups mg ON mg.id = img.group_id
        WHERE img.active = 1 AND i.active = 1 AND mg.active = 1
        ORDER BY i.name, mg.name
      `).all(),
      combos: db.prepare('SELECT * FROM combos WHERE active = 1 ORDER BY name').all(),
      comboItems: db.prepare(`
        SELECT ci.id, ci.combo_id, ci.item_id, ci.quantity, c.name AS combo_name, i.name AS item_name
        FROM combo_items ci
        JOIN combos c ON c.id = ci.combo_id
        JOIN items i ON i.id = ci.item_id
        WHERE ci.active = 1 AND c.active = 1 AND i.active = 1
        ORDER BY c.name, i.name
      `).all(),
      menuItems: db.prepare('SELECT id, name, price FROM items WHERE active = 1 ORDER BY name').all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/modifiers/groups/save', (req, res) => {
  const { restaurantId, actor, id, name, minSelect, maxSelect, required } = req.body;
  const min = Number(minSelect || 0);
  const max = Number(maxSelect || 1);
  if (!restaurantId || !canManage(actor?.role) || !hasText(name) || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 0 || (max > 0 && min > max)) {
    return res.status(400).json({ success: false, message: 'Valid group name and selection limits are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    if (activeNameExists(db, 'modifier_groups', 'name', name, id)) throw new Error('Modifier group already exists');
    const oldValue = id ? db.prepare('SELECT * FROM modifier_groups WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE modifier_groups SET name = ?, min_select = ?, max_select = ?, required = ?, active = 1 WHERE id = ?')
          .run(normaliseText(name), min, max, required ? 1 : 0, id)
      : db.prepare('INSERT INTO modifier_groups (name, min_select, max_select, required) VALUES (?, ?, ?, ?)')
          .run(normaliseText(name), min, max, required ? 1 : 0);
    const savedId = id || result.lastInsertRowid;
    const newValue = db.prepare('SELECT * FROM modifier_groups WHERE id = ?').get(savedId);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'MODIFIER_GROUP', savedId, oldValue, newValue);
    res.json({ success: true, id: savedId });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/modifiers/groups/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Group and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM modifier_groups WHERE id = ?').get(id);
    db.prepare('UPDATE modifier_groups SET active = 0 WHERE id = ?').run(id);
    db.prepare('UPDATE modifiers SET active = 0 WHERE group_id = ?').run(id);
    db.prepare('UPDATE item_modifier_groups SET active = 0 WHERE group_id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM modifier_groups WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'MODIFIER_GROUP', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/modifiers/options/save', (req, res) => {
  const { restaurantId, actor, id, groupId, name, priceDelta } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !isPositiveId(groupId) || !hasText(name) || !isValidAmount(priceDelta || 0)) {
    return res.status(400).json({ success: false, message: 'Valid modifier name, group and price are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const group = db.prepare('SELECT id FROM modifier_groups WHERE id = ? AND active = 1').get(groupId);
    if (!group) throw new Error('Modifier group not found');
    const duplicate = db.prepare(`
      SELECT id FROM modifiers
      WHERE group_id = ? AND LOWER(name) = LOWER(?) AND active = 1 AND (? IS NULL OR id != ?)
      LIMIT 1
    `).get(groupId, normaliseText(name), id || null, id || null);
    if (duplicate) throw new Error('Modifier already exists in this group');
    const oldValue = id ? db.prepare('SELECT * FROM modifiers WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE modifiers SET group_id = ?, name = ?, price_delta = ?, active = 1 WHERE id = ?')
          .run(groupId, normaliseText(name), Number(priceDelta || 0), id)
      : db.prepare('INSERT INTO modifiers (group_id, name, price_delta) VALUES (?, ?, ?)')
          .run(groupId, normaliseText(name), Number(priceDelta || 0));
    const savedId = id || result.lastInsertRowid;
    const newValue = db.prepare('SELECT * FROM modifiers WHERE id = ?').get(savedId);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'MODIFIER', savedId, oldValue, newValue);
    res.json({ success: true, id: savedId });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/modifiers/options/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Modifier and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM modifiers WHERE id = ?').get(id);
    db.prepare('UPDATE modifiers SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM modifiers WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'MODIFIER', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/modifiers/assign/save', (req, res) => {
  const { restaurantId, actor, itemId, groupId } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !isPositiveId(itemId) || !isPositiveId(groupId)) return res.status(400).json({ success: false, message: 'Item and group are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const item = db.prepare('SELECT id FROM items WHERE id = ? AND active = 1').get(itemId);
    const group = db.prepare('SELECT id FROM modifier_groups WHERE id = ? AND active = 1').get(groupId);
    if (!item || !group) throw new Error('Active item and modifier group are required');
    const result = db.prepare(`
      INSERT INTO item_modifier_groups (item_id, group_id, active)
      VALUES (?, ?, 1)
      ON CONFLICT(item_id, group_id) DO UPDATE SET active = 1
    `).run(itemId, groupId);
    writeAudit(db, actor, 'UPSERT', 'ITEM_MODIFIER_GROUP', result.lastInsertRowid || null, null, { itemId, groupId });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/modifiers/assign/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Assignment and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM item_modifier_groups WHERE id = ?').get(id);
    db.prepare('UPDATE item_modifier_groups SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM item_modifier_groups WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'ITEM_MODIFIER_GROUP', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/combos/save', (req, res) => {
  const { restaurantId, actor, id, name, price, items } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !hasText(name) || !isValidAmount(price) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Combo name, price and items are required' });
  }
  if (items.some((item) => !isPositiveId(item.itemId) || !Number.isInteger(Number(item.quantity || 1)) || Number(item.quantity || 1) <= 0)) {
    return res.status(400).json({ success: false, message: 'Combo items must have valid items and quantities' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      if (activeNameExists(db, 'combos', 'name', name, id)) throw new Error('Combo name already exists');
      const uniqueItemIds = [...new Set(items.map((item) => Number(item.itemId)))];
      const foundItems = db.prepare(`SELECT id FROM items WHERE active = 1 AND id IN (${uniqueItemIds.map(() => '?').join(',')})`).all(...uniqueItemIds);
      if (foundItems.length !== uniqueItemIds.length) throw new Error('One or more combo items are invalid');
      const oldValue = id ? db.prepare('SELECT * FROM combos WHERE id = ?').get(id) : null;
      const result = id
        ? db.prepare('UPDATE combos SET name = ?, price = ?, active = 1 WHERE id = ?').run(normaliseText(name), Number(price), id)
        : db.prepare('INSERT INTO combos (name, price) VALUES (?, ?)').run(normaliseText(name), Number(price));
      const comboId = id || result.lastInsertRowid;
      db.prepare('UPDATE combo_items SET active = 0 WHERE combo_id = ?').run(comboId);
      const upsert = db.prepare(`
        INSERT INTO combo_items (combo_id, item_id, quantity, active)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(combo_id, item_id) DO UPDATE SET quantity = excluded.quantity, active = 1
      `);
      items.forEach((item) => upsert.run(comboId, item.itemId, Number(item.quantity || 1)));
      const newValue = db.prepare('SELECT * FROM combos WHERE id = ?').get(comboId);
      writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'COMBO', comboId, oldValue, newValue);
      return comboId;
    })();
    res.json({ success: true, id: saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/combos/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Combo and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
    db.prepare('UPDATE combos SET active = 0 WHERE id = ?').run(id);
    db.prepare('UPDATE combo_items SET active = 0 WHERE combo_id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'COMBO', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// INVENTORY MANAGEMENT
// ========================
// Restaurant inventory lives in the same per-restaurant SQLite database and does not alter order or billing routes.

function canManageInventory(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER', 'MANAGER_2'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'inventory.manage');
  } finally {
    db.close();
  }
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function selectedModifierIds(line) {
  return [...new Set((line.modifiers || line.modifierIds || []).map((modifier) => Number(modifier.id || modifier)).filter((id) => Number.isInteger(id) && id > 0))];
}

function loadItemModifierConfig(db, itemId) {
  const groups = db.prepare(`
    SELECT mg.*
    FROM item_modifier_groups img
    JOIN modifier_groups mg ON mg.id = img.group_id
    WHERE img.item_id = ? AND img.active = 1 AND mg.active = 1
    ORDER BY mg.name
  `).all(itemId);
  const modifiers = db.prepare(`
    SELECT m.*
    FROM item_modifier_groups img
    JOIN modifiers m ON m.group_id = img.group_id
    WHERE img.item_id = ? AND img.active = 1 AND m.active = 1
  `).all(itemId);
  return { groups, modifiers };
}

function validateSelectedModifiers(db, itemId, modifierIds) {
  const { groups, modifiers } = loadItemModifierConfig(db, itemId);
  const modifierById = new Map(modifiers.map((modifier) => [modifier.id, modifier]));
  const selected = modifierIds.map((id) => modifierById.get(id));
  if (selected.some((modifier) => !modifier)) throw new Error('Invalid modifier selected for item');

  groups.forEach((group) => {
    const count = selected.filter((modifier) => modifier.group_id === group.id).length;
    if (group.required && count < Number(group.min_select || 1)) throw new Error(`${group.name} is required`);
    if (count < Number(group.min_select || 0)) throw new Error(`${group.name} needs at least ${group.min_select} selection(s)`);
    if (Number(group.max_select || 0) > 0 && count > Number(group.max_select)) throw new Error(`${group.name} allows only ${group.max_select} selection(s)`);
  });

  return selected;
}

function insertOrderItemModifiers(db, orderItemId, modifiers) {
  const insert = db.prepare(`
    INSERT INTO order_item_modifiers (order_item_id, modifier_id, group_id, name, price_delta)
    VALUES (?, ?, ?, ?, ?)
  `);
  modifiers.forEach((modifier) => insert.run(orderItemId, modifier.id, modifier.group_id, modifier.name, Number(modifier.price_delta || 0)));
}

function canManagePurchases(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER_2'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'inventory.purchase_orders');
  } finally {
    db.close();
  }
}

function canViewPurchases(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER_2', 'MANAGER_1'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'inventory.purchase_orders') || canRole(db, role, 'inventory.view');
  } finally {
    db.close();
  }
}

function nextPurchaseOrderNumber(db) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PO-${today}-`;
  const row = db.prepare('SELECT po_number FROM purchase_orders WHERE po_number LIKE ? ORDER BY po_number DESC LIMIT 1').get(`${prefix}%`);
  const next = row?.po_number ? Number(row.po_number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

function normalisePurchaseItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Purchase order items are required');
  return items.map((item) => {
    const ingredientId = Number(item.ingredientId || item.ingredient_id);
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.unitCost ?? item.unit_cost ?? 0);
    const taxRate = Number(item.taxRate ?? item.tax_rate ?? 0);
    if (!isPositiveId(ingredientId) || !isPositiveNumber(quantity) || !isValidAmount(unitPrice) || !isValidAmount(taxRate)) {
      throw new Error('Purchase items must have valid ingredient, quantity, price and tax');
    }
    const subtotal = quantity * unitPrice;
    const tax = subtotal * taxRate / 100;
    return { ingredientId, quantity, unitPrice, taxRate, lineTotal: subtotal + tax };
  });
}

function purchaseTotals(items) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice * item.taxRate / 100, 0);
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

function paidForPurchaseOrder(db, purchaseOrderId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE purchase_order_id = ?').get(purchaseOrderId).paid || 0;
}

app.get('/inventory/bootstrap', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      suppliers: db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name').all(),
      ingredients: db.prepare(`
        SELECT id, name, unit, current_stock, low_stock_alert, low_stock_alert AS low_stock_level, active, created_at
        FROM ingredients
        WHERE active = 1
        ORDER BY name
      `).all(),
      purchaseOrders: db.prepare(`
        SELECT po.*, s.name AS supplier_name,
               COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_order_id = po.id), 0) AS paid_amount,
               po.total_amount - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_order_id = po.id), 0) AS outstanding_amount
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.active = 1
        ORDER BY po.created_at DESC
        LIMIT 100
      `).all(),
      supplierPayments: db.prepare(`
        SELECT sp.*, s.name AS supplier_name, po.po_number
        FROM supplier_payments sp
        JOIN suppliers s ON s.id = sp.supplier_id
        LEFT JOIN purchase_orders po ON po.id = sp.purchase_order_id
        ORDER BY sp.paid_at DESC
        LIMIT 100
      `).all(),
      supplierBalances: db.prepare(`
        SELECT s.id, s.name,
               COALESCE(SUM(po.total_amount), 0) AS billed_amount,
               COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS paid_amount,
               COALESCE(SUM(po.total_amount), 0) - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS outstanding_amount
        FROM suppliers s
        LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND po.active = 1 AND po.status != 'CANCELLED'
        WHERE s.active = 1
        GROUP BY s.id, s.name
        ORDER BY outstanding_amount DESC, s.name
      `).all(),
      recipes: db.prepare(`
        SELECT ri.id, r.menu_item_id, ri.ingredient_id, ri.quantity AS quantity_per_item, i.name AS item_name, ing.name AS ingredient_name, ing.unit
        FROM recipe_items ri
        JOIN recipes r ON r.id = ri.recipe_id
        JOIN items i ON i.id = r.menu_item_id
        JOIN ingredients ing ON ing.id = ri.ingredient_id
        WHERE r.active = 1 AND ri.active = 1
        ORDER BY i.name, ing.name
      `).all(),
      menuItems: db.prepare('SELECT id, name FROM items WHERE active = 1 ORDER BY name').all(),
      lowStockAlerts: db.prepare(`
        SELECT id, name, unit, current_stock, low_stock_alert, low_stock_alert AS low_stock_level
        FROM ingredients
        WHERE active = 1 AND current_stock <= low_stock_alert
        ORDER BY name
      `).all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/suppliers/save', (req, res) => {
  const { restaurantId, actor, id, name, phone, email, address, gstin } = req.body;
  if (!restaurantId || !canManageInventory(actor?.role) || !hasText(name)) {
    return res.status(400).json({ success: false, message: 'Supplier name and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const duplicate = activeNameExists(db, 'suppliers', 'name', name, id);
    if (duplicate) return res.status(409).json({ success: false, message: 'Supplier name already exists' });
    const oldValue = id ? db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, gstin = ?, active = 1 WHERE id = ?')
          .run(normaliseText(name), normaliseText(phone) || null, normaliseText(email) || null, normaliseText(address) || null, normaliseText(gstin) || null, id)
      : db.prepare('INSERT INTO suppliers (name, phone, email, address, gstin) VALUES (?, ?, ?, ?, ?)')
          .run(normaliseText(name), normaliseText(phone) || null, normaliseText(email) || null, normaliseText(address) || null, normaliseText(gstin) || null);
    const savedId = id || result.lastInsertRowid;
    const newValue = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(savedId);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'INVENTORY_SUPPLIER', savedId, oldValue, newValue);
    res.json({ success: true, id: savedId });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/suppliers/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManageInventory(actor?.role) || !isPositiveId(id)) {
    return res.status(400).json({ success: false, message: 'Supplier and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'INVENTORY_SUPPLIER', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/purchase-orders/create', (req, res) => {
  const { restaurantId, actor, supplierId, items, notes } = req.body;
  if (!restaurantId || !canManagePurchases(actor?.role) || !isPositiveId(supplierId)) {
    return res.status(400).json({ success: false, message: 'Supplier and purchase permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ? AND active = 1').get(supplierId);
      if (!supplier) throw new Error('Supplier not found');
      const safeItems = normalisePurchaseItems(items);
      const foundIngredients = db.prepare(`SELECT id FROM ingredients WHERE active = 1 AND id IN (${safeItems.map(() => '?').join(',')})`).all(...safeItems.map((item) => item.ingredientId));
      if (foundIngredients.length !== new Set(safeItems.map((item) => item.ingredientId)).size) throw new Error('One or more ingredients are invalid');
      const totals = purchaseTotals(safeItems);
      const poNumber = nextPurchaseOrderNumber(db);
      const result = db.prepare(`
        INSERT INTO purchase_orders (supplier_id, po_number, status, subtotal, tax_amount, total_amount, created_by, notes)
        VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?)
      `).run(supplierId, poNumber, totals.subtotal, totals.taxAmount, totals.totalAmount, actor?.id || null, normaliseText(notes) || null);
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost, unit_price, tax_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      safeItems.forEach((item) => insertItem.run(result.lastInsertRowid, item.ingredientId, item.quantity, item.unitPrice, item.unitPrice, item.taxRate, item.lineTotal));
      const newValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(result.lastInsertRowid);
      writeAudit(db, actor, 'CREATE', 'PURCHASE_ORDER', result.lastInsertRowid, null, newValue);
      return { id: result.lastInsertRowid, poNumber, ...totals };
    })();
    res.json({ success: true, ...saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/purchase-orders/list', (req, res) => {
  const { restaurantId, role, status } = req.query;
  if (!restaurantId || !canViewPurchases(role)) return res.status(403).json({ success: false, message: 'Purchase view permission required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT po.*, s.name AS supplier_name,
             COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_order_id = po.id), 0) AS paid_amount,
             po.total_amount - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_order_id = po.id), 0) AS outstanding_amount
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.active = 1 AND (? = '' OR po.status = ?)
      ORDER BY po.created_at DESC
    `).all(status || '', status || '');
    res.json({ success: true, purchaseOrders: rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/purchase-orders/detail', (req, res) => {
  const { restaurantId, role, id } = req.query;
  if (!restaurantId || !canViewPurchases(role) || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Purchase order and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const order = db.prepare('SELECT po.*, s.name AS supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ? AND po.active = 1').get(id);
    if (!order) throw new Error('Purchase order not found');
    const items = db.prepare(`
      SELECT poi.*, ing.name AS ingredient_name, ing.unit
      FROM purchase_order_items poi
      JOIN ingredients ing ON ing.id = poi.ingredient_id
      WHERE poi.purchase_order_id = ?
      ORDER BY poi.id
    `).all(id);
    const payments = db.prepare('SELECT * FROM supplier_payments WHERE purchase_order_id = ? ORDER BY paid_at DESC').all(id);
    res.json({ success: true, order, items, payments, paidAmount: paidForPurchaseOrder(db, id), outstandingAmount: Number(order.total_amount || 0) - paidForPurchaseOrder(db, id) });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/purchase-orders/update', (req, res) => {
  const { restaurantId, actor, id, supplierId, status, items, notes } = req.body;
  if (!restaurantId || !canManagePurchases(actor?.role) || !isPositiveId(id) || !isPositiveId(supplierId)) {
    return res.status(400).json({ success: false, message: 'Purchase order, supplier and permission are required' });
  }
  const safeStatus = normaliseText(status || 'DRAFT').toUpperCase();
  if (!['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'].includes(safeStatus)) return res.status(400).json({ success: false, message: 'Invalid purchase order status' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      const oldValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND active = 1').get(id);
      if (!oldValue) throw new Error('Purchase order not found');
      if (oldValue.status === 'RECEIVED' && actor.role !== 'OWNER') throw new Error('Only OWNER can edit received purchase orders');
      if (oldValue.status === 'CANCELLED') throw new Error('Cannot edit cancelled purchase order');
      const safeItems = normalisePurchaseItems(items);
      const totals = purchaseTotals(safeItems);
      db.prepare(`
        UPDATE purchase_orders
        SET supplier_id = ?, status = ?, subtotal = ?, tax_amount = ?, total_amount = ?, notes = ?
        WHERE id = ?
      `).run(supplierId, safeStatus, totals.subtotal, totals.taxAmount, totals.totalAmount, normaliseText(notes) || null, id);
      db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(id);
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost, unit_price, tax_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      safeItems.forEach((item) => insertItem.run(id, item.ingredientId, item.quantity, item.unitPrice, item.unitPrice, item.taxRate, item.lineTotal));
      const newValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
      writeAudit(db, actor, 'UPDATE', 'PURCHASE_ORDER', id, oldValue, newValue);
      return { id, ...totals };
    })();
    res.json({ success: true, ...saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/purchase-orders/cancel', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManagePurchases(actor?.role) || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Purchase order and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND active = 1').get(id);
    if (!oldValue) throw new Error('Purchase order not found');
    if (oldValue.status === 'RECEIVED') throw new Error('Cannot cancel received purchase order');
    db.prepare("UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = ?").run(id);
    const newValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    writeAudit(db, actor, 'CANCEL', 'PURCHASE_ORDER', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/purchase-orders/receive', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManagePurchases(actor?.role) || !isPositiveId(id)) return res.status(400).json({ success: false, message: 'Purchase order and permission are required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const received = db.transaction(() => {
      const oldValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND active = 1').get(id);
      if (!oldValue) throw new Error('Purchase order not found');
      if (oldValue.status === 'CANCELLED') throw new Error('Cannot receive cancelled purchase order');
      if (oldValue.status === 'RECEIVED') throw new Error('Purchase order already received');
      const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(id);
      if (items.length === 0) throw new Error('Purchase order has no items');
      const updateStock = db.prepare('UPDATE ingredients SET current_stock = current_stock + ? WHERE id = ?');
      const insertMovement = db.prepare(`
        INSERT INTO stock_movements (ingredient_id, movement_type, quantity, reference_type, reference_id, purchase_order_id, notes)
        VALUES (?, 'PURCHASE', ?, 'PURCHASE_ORDER', ?, ?, ?)
      `);
      items.forEach((item) => {
        updateStock.run(item.quantity, item.ingredient_id);
        insertMovement.run(item.ingredient_id, item.quantity, id, id, `Received purchase order ${oldValue.po_number || id}`);
      });
      db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', received_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      const newValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
      writeAudit(db, actor, 'RECEIVE', 'PURCHASE_ORDER', id, oldValue, newValue);
      return newValue;
    })();
    res.json({ success: true, order: received });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/supplier-payments/add', (req, res) => {
  const { restaurantId, actor, supplierId, purchaseOrderId, amount, paymentMode, referenceNo } = req.body;
  if (!restaurantId || !canManagePurchases(actor?.role) || !isPositiveId(supplierId) || !isPositiveNumber(amount)) {
    return res.status(400).json({ success: false, message: 'Supplier, amount and permission are required' });
  }
  const mode = normaliseText(paymentMode).toUpperCase();
  if (!['CASH', 'UPI', 'BANK', 'CARD'].includes(mode)) return res.status(400).json({ success: false, message: 'Invalid supplier payment mode' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ? AND active = 1').get(supplierId);
    if (!supplier) throw new Error('Supplier not found');
    if (isPositiveId(purchaseOrderId)) {
      const po = db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND supplier_id = ? AND active = 1').get(purchaseOrderId, supplierId);
      if (!po) throw new Error('Purchase order not found for supplier');
    }
    const result = db.prepare(`
      INSERT INTO supplier_payments (supplier_id, purchase_order_id, amount, payment_mode, reference_no, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(supplierId, isPositiveId(purchaseOrderId) ? purchaseOrderId : null, Number(amount), mode, normaliseText(referenceNo) || null, actor?.id || null);
    const newValue = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(result.lastInsertRowid);
    writeAudit(db, actor, 'CREATE', 'SUPPLIER_PAYMENT', result.lastInsertRowid, null, newValue);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/supplier-payments/list', (req, res) => {
  const { restaurantId, role, supplierId } = req.query;
  if (!restaurantId || !canViewPurchases(role)) return res.status(403).json({ success: false, message: 'Purchase view permission required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT sp.*, s.name AS supplier_name, po.po_number
      FROM supplier_payments sp
      JOIN suppliers s ON s.id = sp.supplier_id
      LEFT JOIN purchase_orders po ON po.id = sp.purchase_order_id
      WHERE (? IS NULL OR sp.supplier_id = ?)
      ORDER BY sp.paid_at DESC
    `).all(isPositiveId(supplierId) ? Number(supplierId) : null, isPositiveId(supplierId) ? Number(supplierId) : null);
    res.json({ success: true, payments: rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/supplier-payments/summary', (req, res) => {
  const { restaurantId, role } = req.query;
  if (!restaurantId || !canViewPurchases(role)) return res.status(403).json({ success: false, message: 'Purchase view permission required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT s.id, s.name,
             COALESCE(SUM(po.total_amount), 0) AS billed_amount,
             COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS paid_amount,
             COALESCE(SUM(po.total_amount), 0) - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS outstanding_amount
      FROM suppliers s
      LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND po.active = 1 AND po.status != 'CANCELLED'
      WHERE s.active = 1
      GROUP BY s.id, s.name
      ORDER BY outstanding_amount DESC, s.name
    `).all();
    res.json({ success: true, suppliers: rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/purchase-orders/reports', (req, res) => {
  const { restaurantId, role, fromDate, toDate } = req.query;
  if (!restaurantId || !canViewPurchases(role)) return res.status(403).json({ success: false, message: 'Purchase view permission required' });
  const from = fromDate || '1970-01-01';
  const to = toDate || '2999-12-31';
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      purchaseReport: db.prepare(`
        SELECT DATE(created_at) AS day, status, COUNT(*) AS orders, COALESCE(SUM(total_amount), 0) AS total
        FROM purchase_orders
        WHERE active = 1 AND DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        GROUP BY DATE(created_at), status
        ORDER BY day DESC
      `).all(from, to),
      supplierOutstanding: db.prepare(`
        SELECT s.id, s.name, COALESCE(SUM(po.total_amount), 0) AS billed_amount,
               COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS paid_amount,
               COALESCE(SUM(po.total_amount), 0) - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS outstanding_amount
        FROM suppliers s
        LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND po.active = 1 AND po.status != 'CANCELLED'
        WHERE s.active = 1
        GROUP BY s.id, s.name
        ORDER BY outstanding_amount DESC
      `).all(),
      ingredientPurchases: db.prepare(`
        SELECT ing.id, ing.name, ing.unit, SUM(poi.quantity) AS quantity, SUM(poi.line_total) AS total
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        JOIN ingredients ing ON ing.id = poi.ingredient_id
        WHERE po.active = 1 AND po.status != 'CANCELLED' AND DATE(po.created_at) BETWEEN DATE(?) AND DATE(?)
        GROUP BY ing.id, ing.name, ing.unit
        ORDER BY total DESC
      `).all(from, to),
      paymentModeReport: db.prepare(`
        SELECT payment_mode, COUNT(*) AS payments, SUM(amount) AS total
        FROM supplier_payments
        WHERE DATE(paid_at) BETWEEN DATE(?) AND DATE(?)
        GROUP BY payment_mode
        ORDER BY total DESC
      `).all(from, to)
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/ingredients/save', (req, res) => {
  const { restaurantId, actor, id, name, unit, lowStockLevel, lowStockAlert } = req.body;
  const lowStock = lowStockAlert ?? lowStockLevel ?? 0;
  if (!restaurantId || !canManageInventory(actor?.role) || !hasText(name) || !hasText(unit) || !isValidAmount(lowStock)) {
    return res.status(400).json({ success: false, message: 'Ingredient name, unit and valid stock values are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const duplicate = activeNameExists(db, 'ingredients', 'name', name, id);
    if (duplicate) return res.status(409).json({ success: false, message: 'Ingredient name already exists' });
    const oldValue = id ? db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) : null;
    const result = id
      ? db.prepare('UPDATE ingredients SET name = ?, unit = ?, low_stock_alert = ?, active = 1 WHERE id = ?')
          .run(normaliseText(name), normaliseText(unit), Number(lowStock), id)
      : db.prepare('INSERT INTO ingredients (name, unit, low_stock_alert) VALUES (?, ?, ?)')
          .run(normaliseText(name), normaliseText(unit), Number(lowStock));
    const savedId = id || result.lastInsertRowid;
    const newValue = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(savedId);
    writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'INVENTORY_INGREDIENT', savedId, oldValue, newValue);
    res.json({ success: true, id: savedId });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/ingredients/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManageInventory(actor?.role) || !isPositiveId(id)) {
    return res.status(400).json({ success: false, message: 'Ingredient and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    db.prepare('UPDATE ingredients SET active = 0 WHERE id = ?').run(id);
    db.prepare('UPDATE recipe_items SET active = 0 WHERE ingredient_id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'INVENTORY_INGREDIENT', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/purchase-orders/save', (req, res) => {
  const { restaurantId, actor, id, supplierId, orderDate, status, notes, items } = req.body;
  const statuses = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'];
  if (!restaurantId || !canManageInventory(actor?.role) || !isPositiveId(supplierId) || !statuses.includes(status || 'DRAFT') || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Supplier, status and purchase items are required' });
  }
  if (items.some((item) => !isPositiveId(item.ingredientId) || !isPositiveNumber(item.quantity) || !isValidAmount(item.unitCost || 0))) {
    return res.status(400).json({ success: false, message: 'Purchase items must have valid ingredients, quantities and costs' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ? AND active = 1').get(supplierId);
      if (!supplier) throw new Error('Supplier not found');
      const uniqueIngredientIds = [...new Set(items.map((item) => Number(item.ingredientId)))];
      const foundIngredients = db.prepare(`SELECT id FROM ingredients WHERE active = 1 AND id IN (${uniqueIngredientIds.map(() => '?').join(',')})`).all(...uniqueIngredientIds);
      if (foundIngredients.length !== uniqueIngredientIds.length) throw new Error('One or more ingredients are invalid');
      const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost || 0), 0);
      let purchaseOrderId = id;
      const oldValue = purchaseOrderId ? db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId) : null;
      if (purchaseOrderId) {
        db.prepare('UPDATE purchase_orders SET supplier_id = ?, order_date = ?, status = ?, total_amount = ?, notes = ?, active = 1 WHERE id = ?')
          .run(supplierId, orderDate || new Date().toISOString().slice(0, 10), status || 'DRAFT', total, normaliseText(notes) || null, purchaseOrderId);
        db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(purchaseOrderId);
      } else {
        const result = db.prepare('INSERT INTO purchase_orders (supplier_id, order_date, status, total_amount, notes) VALUES (?, ?, ?, ?, ?)')
          .run(supplierId, orderDate || new Date().toISOString().slice(0, 10), status || 'DRAFT', total, normaliseText(notes) || null);
        purchaseOrderId = result.lastInsertRowid;
      }

      const insertItem = db.prepare('INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost) VALUES (?, ?, ?, ?)');
      items.forEach((item) => insertItem.run(purchaseOrderId, item.ingredientId, Number(item.quantity), Number(item.unitCost || 0)));
      const newValue = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
      writeAudit(db, actor, id ? 'UPDATE' : 'CREATE', 'INVENTORY_PURCHASE_ORDER', purchaseOrderId, oldValue, newValue);
      return { purchaseOrderId, total };
    })();

    res.json({ success: true, id: saved.purchaseOrderId, totalAmount: saved.total });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/stock-in', (req, res) => {
  const { restaurantId, actor, ingredientId, quantity, unitCost, referenceType, referenceId, notes } = req.body;
  if (!restaurantId || !canManageInventory(actor?.role) || !isPositiveId(ingredientId) || !isPositiveNumber(quantity) || !isValidAmount(unitCost || 0)) {
    return res.status(400).json({ success: false, message: 'Valid ingredient, quantity and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    db.transaction(() => {
      const oldValue = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId);
      if (!oldValue || oldValue.active !== 1) throw new Error('Ingredient not found');
      db.prepare('UPDATE ingredients SET current_stock = current_stock + ? WHERE id = ?')
        .run(Number(quantity), ingredientId);
      db.prepare(`
        INSERT INTO stock_movements (ingredient_id, movement_type, quantity, reference_type, reference_id, notes)
        VALUES (?, 'PURCHASE', ?, ?, ?, ?)
      `).run(ingredientId, Number(quantity), referenceType || 'MANUAL', referenceId || null, normaliseText(notes) || null);
      const newValue = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId);
      writeAudit(db, actor, 'PURCHASE', 'INVENTORY_INGREDIENT', ingredientId, oldValue, newValue);
    })();
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/stock-out', (req, res) => {
  const { restaurantId, actor, ingredientId, quantity, reason, notes } = req.body;
  const movementType = ['WASTAGE', 'ADJUSTMENT'].includes(reason) ? reason : 'ADJUSTMENT';
  if (!restaurantId || !canManageInventory(actor?.role) || !isPositiveId(ingredientId) || !isPositiveNumber(quantity)) {
    return res.status(400).json({ success: false, message: 'Valid ingredient, quantity and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    db.transaction(() => {
      const oldValue = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId);
      if (!oldValue || oldValue.active !== 1) throw new Error('Ingredient not found');
      if (Number(oldValue.current_stock || 0) < Number(quantity)) throw new Error('Insufficient ingredient stock');
      db.prepare('UPDATE ingredients SET current_stock = current_stock - ? WHERE id = ?').run(Number(quantity), ingredientId);
      db.prepare(`
        INSERT INTO stock_movements (ingredient_id, movement_type, quantity, reference_type, notes)
        VALUES (?, ?, ?, 'MANUAL', ?)
      `).run(ingredientId, movementType, Number(quantity), normaliseText(notes) || null);
      const newValue = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId);
      writeAudit(db, actor, movementType, 'INVENTORY_INGREDIENT', ingredientId, oldValue, newValue);
    })();
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/recipes/save', (req, res) => {
  const { restaurantId, actor, menuItemId, ingredientId, quantityPerItem } = req.body;
  if (!restaurantId || !canManageInventory(actor?.role) || !isPositiveId(menuItemId) || !isPositiveId(ingredientId) || !isPositiveNumber(quantityPerItem)) {
    return res.status(400).json({ success: false, message: 'Menu item, ingredient and quantity are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const saved = db.transaction(() => {
      db.prepare(`
        INSERT INTO recipes (menu_item_id, active)
        VALUES (?, 1)
        ON CONFLICT(menu_item_id) DO UPDATE SET active = 1
      `).run(menuItemId);
      const recipe = db.prepare('SELECT id FROM recipes WHERE menu_item_id = ?').get(menuItemId);
      const oldValue = db.prepare('SELECT * FROM recipe_items WHERE recipe_id = ? AND ingredient_id = ?').get(recipe.id, ingredientId);
      const result = db.prepare(`
        INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, active)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(recipe_id, ingredient_id)
        DO UPDATE SET quantity = excluded.quantity, active = 1
      `).run(recipe.id, ingredientId, Number(quantityPerItem));
      const mappingId = oldValue?.id || result.lastInsertRowid;
      const newValue = db.prepare('SELECT * FROM recipe_items WHERE id = ?').get(mappingId);
      writeAudit(db, actor, oldValue ? 'UPDATE' : 'CREATE', 'INVENTORY_RECIPE', mappingId, oldValue, newValue);
      return mappingId;
    })();
    res.json({ success: true, id: saved });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.post('/inventory/recipes/delete', (req, res) => {
  const { restaurantId, actor, id } = req.body;
  if (!restaurantId || !canManageInventory(actor?.role) || !isPositiveId(id)) {
    return res.status(400).json({ success: false, message: 'Recipe mapping and permission are required' });
  }

  const db = openRestaurantDatabase(restaurantId);
  try {
    const oldValue = db.prepare('SELECT * FROM recipe_items WHERE id = ?').get(id);
    db.prepare('UPDATE recipe_items SET active = 0 WHERE id = ?').run(id);
    const newValue = db.prepare('SELECT * FROM recipe_items WHERE id = ?').get(id);
    writeAudit(db, actor, 'DELETE', 'INVENTORY_RECIPE', id, oldValue, newValue);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/inventory/reports', (req, res) => {
  const { restaurantId, fromDate, toDate } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const from = fromDate || new Date().toISOString().slice(0, 10);
  const to = toDate || from;

  const db = openRestaurantDatabase(restaurantId);
  try {
    const currentStock = db.prepare(`
      SELECT id, name, unit, current_stock, low_stock_alert, low_stock_alert AS low_stock_level
      FROM ingredients
      WHERE active = 1
      ORDER BY name
    `).all();
    const lowStockAlerts = db.prepare(`
      SELECT id, name, unit, current_stock, low_stock_alert, low_stock_alert AS low_stock_level
      FROM ingredients
      WHERE active = 1 AND current_stock <= low_stock_alert
      ORDER BY name
    `).all();
    const stockMovements = db.prepare(`
      SELECT sm.*, ing.name AS ingredient_name, ing.unit
      FROM stock_movements sm
      JOIN ingredients ing ON ing.id = sm.ingredient_id
      WHERE DATE(sm.created_at) BETWEEN DATE(?) AND DATE(?)
      ORDER BY sm.created_at DESC
    `).all(from, to);
    const ingredientUsage = db.prepare(`
      SELECT ing.id, ing.name, ing.unit, COALESCE(SUM(sm.quantity), 0) AS quantity
      FROM stock_movements sm
      JOIN ingredients ing ON ing.id = sm.ingredient_id
      WHERE sm.movement_type = 'SALE_CONSUMPTION' AND DATE(sm.created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY ing.id
      ORDER BY quantity DESC
    `).all(from, to);
    const wastage = db.prepare(`
      SELECT ing.id, ing.name, ing.unit, COALESCE(SUM(sm.quantity), 0) AS quantity
      FROM stock_movements sm
      JOIN ingredients ing ON ing.id = sm.ingredient_id
      WHERE sm.movement_type = 'WASTAGE' AND DATE(sm.created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY ing.id
      ORDER BY quantity DESC
    `).all(from, to);

    res.json({
      success: true,
      currentStock,
      stockMovements,
      ingredientUsage,
      wastage,
      stockOnHand: currentStock,
      lowStockAlerts,
      movementSummary: db.prepare(`
        SELECT movement_type, COUNT(*) AS rows, SUM(quantity) AS quantity
        FROM stock_movements
        WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        GROUP BY movement_type
      `).all(from, to),
      purchaseSummary: db.prepare(`
        SELECT status, COUNT(*) AS orders, SUM(total_amount) AS total
        FROM purchase_orders
        WHERE active = 1 AND DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        GROUP BY status
      `).all(from, to),
      recipeCosting: db.prepare(`
        SELECT i.id AS item_id, i.name AS item_name, COUNT(ri.id) AS ingredient_count, SUM(ri.quantity) AS mapped_quantity, 0 AS estimated_cost
        FROM recipes r
        JOIN recipe_items ri ON ri.recipe_id = r.id
        JOIN items i ON i.id = r.menu_item_id
        WHERE r.active = 1 AND ri.active = 1
        GROUP BY i.id
        ORDER BY i.name
      `).all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/inventory/low-stock', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({
      success: true,
      items: db.prepare(`
        SELECT id, name, unit, current_stock, low_stock_alert, low_stock_alert AS low_stock_level
        FROM ingredients
        WHERE active = 1 AND current_stock <= low_stock_alert
        ORDER BY name
      `).all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

// ========================
// BACKUP, RESTORE & ONEDRIVE FOLDER SYNC
// ========================

app.get('/backup/settings', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    res.json({
      success: true,
      settings: getBackupConfig(db),
      logs: db.prepare('SELECT * FROM backup_logs WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 20').all(restaurantId)
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    if (db) db.close();
  }
});

app.post('/backup/settings', (req, res) => {
  const { restaurantId, actor, settings } = req.body;
  if (!restaurantId || !canManage(actor?.role) || !settings || typeof settings !== 'object') {
    return res.status(400).json({ success: false, message: 'Backup settings and permission are required' });
  }

  const interval = Number(settings.backup_interval_minutes || 60);
  if (!Number.isInteger(interval) || interval < 1) {
    return res.status(400).json({ success: false, message: 'Backup interval must be a whole number of minutes' });
  }
  if (!hasText(settings.backup_folder_path)) {
    return res.status(400).json({ success: false, message: 'Backup folder path is required' });
  }

  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    const safeSettings = {
      backup_enabled: settings.backup_enabled === '1' || settings.backup_enabled === true ? '1' : '0',
      backup_folder_path: normaliseText(settings.backup_folder_path),
      onedrive_folder_path: normaliseText(settings.onedrive_folder_path),
      backup_interval_minutes: String(interval)
    };
    setBackupConfig(db, safeSettings);
    writeAudit(db, actor, 'UPDATE', 'BACKUP_SETTINGS', null, null, safeSettings);
    res.json({ success: true, settings: getBackupConfig(db) });
  } catch (err) {
    sendError(res, err);
  } finally {
    if (db) db.close();
  }
});

app.post('/backup/run', (req, res) => {
  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ success: false, backupPath: null, message: 'restaurantId required' });

  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    const backup = backupRestaurantDatabase(db, restaurantId);
    if (!backup.success) return res.status(errorStatus({ message: backup.message })).json(backup);
    res.json(backup);
  } catch (err) {
    const message = friendlyErrorMessage(err);
    res.status(errorStatus({ message, status: err.status })).json({ success: false, backupPath: null, message });
  } finally {
    if (db) db.close();
  }
});

app.post('/backup/sync', (req, res) => {
  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ success: false, syncPath: null, message: 'restaurantId required' });

  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    const sync = syncLatestBackupToOneDrive(db, restaurantId);
    if (!sync.success) return res.status(errorStatus({ message: sync.message })).json(sync);
    res.json(sync);
  } catch (err) {
    const message = friendlyErrorMessage(err);
    res.status(errorStatus({ message, status: err.status })).json({ success: false, syncPath: null, message });
  } finally {
    if (db) db.close();
  }
});

app.get('/backup/list', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    res.json({ success: true, backups: listBackups(db, restaurantId) });
  } catch (err) {
    const message = friendlyErrorMessage(err);
    res.status(errorStatus({ message, status: err.status })).json({ success: false, message, backups: [] });
  } finally {
    if (db) db.close();
  }
});

app.post('/backup/restore', (req, res) => {
  const { restaurantId, actor, filename } = req.body;
  if (!restaurantId || !filename) {
    return res.status(400).json({ success: false, message: 'Backup filename and permission are required' });
  }

  let db;
  let dbClosed = false;
  try {
    db = openRestaurantDatabase(restaurantId);
    requirePermission(db, actor?.role, 'backup.manage', 'Backup restore permission required');
    const restored = restoreBackup(db, restaurantId, filename);
    dbClosed = !!restored.dbClosed;
    if (!restored.success) return res.status(errorStatus({ message: restored.message })).json(restored);
    const auditDb = dbClosed ? openRestaurantDatabase(restaurantId) : db;
    try {
      writeAudit(auditDb, actor, 'RESTORE', 'BACKUP', null, null, { filename, safetyBackupPath: restored.safetyBackupPath }, { restaurantId, ipAddress: requestIp(req) });
      writeCompliance(auditDb, 'BACKUP_RESTORE', 'HIGH', `Backup restored: ${filename}`, 'BACKUP', null);
    } finally {
      if (dbClosed) auditDb.close();
    }
    res.json(restored);
  } catch (err) {
    sendError(res, err);
  } finally {
    if (db && !dbClosed) db.close();
  }
});

function runBackupSchedulerTick() {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return;

  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    const config = getBackupConfig(db);
    if (!dueForScheduledBackup(config)) return;
    const backup = backupRestaurantDatabase(db, restaurantId);
    if (backup.success && config.onedrive_folder_path) {
      syncLatestBackupToOneDrive(db, restaurantId);
    }
  } catch (err) {
    console.warn('Scheduled backup skipped:', err.message);
  } finally {
    if (db) db.close();
  }
}

setInterval(runBackupSchedulerTick, 60 * 1000);

function isoDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Invalid report date');
  return date.toISOString().slice(0, 10);
}

function cloudSyncStatus(db, restaurantId, status, message) {
  db.prepare(`
    INSERT INTO cloud_sync_status (restaurant_id, last_attempt_at, status, message)
    VALUES (?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT(restaurant_id) DO UPDATE SET
      last_attempt_at = CURRENT_TIMESTAMP,
      status = excluded.status,
      message = excluded.message,
      last_successful_sync_at = CASE WHEN excluded.status = 'SYNCED' THEN CURRENT_TIMESTAMP ELSE cloud_sync_status.last_successful_sync_at END
  `).run(restaurantId, status, message || null);
  setConfigValues(db, {
    last_cloud_sync_at: new Date().toISOString(),
    last_cloud_sync_status: status,
    last_cloud_sync_message: message || ''
  });
}

function buildDailyReportPayload(restaurantId, dateValue) {
  const reportDate = isoDateOnly(dateValue);
  const db = openRestaurantDatabase(restaurantId);
  try {
    const paidOrderDateClause = `
      payment_status = 'PAID'
      AND COALESCE(status, '') != 'CANCELLED'
      AND DATE(COALESCE(settled_at, created_at)) = DATE(?)
    `;
    const orderSummary = db.prepare(`
      SELECT
        COUNT(*) AS orders_count,
        COALESCE(SUM(total_amount), 0) AS net_sales,
        COALESCE(SUM(tax_amount), 0) AS tax_amount,
        COALESCE(SUM(loyalty_discount), 0) AS loyalty_discount
      FROM orders
      WHERE ${paidOrderDateClause}
    `).get(reportDate);
    const gross = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.price, i.price, 0)), 0) + COALESCE((
        SELECT SUM(delivery_fee)
        FROM orders
        WHERE ${paidOrderDateClause}
      ), 0) AS gross_sales
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN items i ON i.id = oi.item_id
      WHERE o.payment_status = 'PAID'
        AND COALESCE(o.status, '') != 'CANCELLED'
        AND DATE(COALESCE(o.settled_at, o.created_at)) = DATE(?)
    `).get(reportDate, reportDate);
    const paymentRows = tableExists(db, 'payments') ? db.prepare(`
      SELECT UPPER(payment_mode) AS mode, COALESCE(SUM(amount), 0) AS total
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE o.payment_status = 'PAID'
        AND COALESCE(o.status, '') != 'CANCELLED'
        AND DATE(COALESCE(o.settled_at, p.created_at)) = DATE(?)
      GROUP BY UPPER(payment_mode)
    `).all(reportDate) : [];
    const paymentTotals = paymentRows.reduce((totals, row) => {
      totals[row.mode] = Number(row.total || 0);
      return totals;
    }, {});
    const manualDiscounts = tableExists(db, 'discounts') ? db.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN UPPER(value_type) IN ('AMOUNT', 'FLAT') THEN value
          WHEN UPPER(value_type) = 'PERCENT' THEN (o.total_amount * value / 100.0)
          ELSE 0
        END
      ), 0) AS total
      FROM discounts d
      JOIN orders o ON o.id = d.order_id
      WHERE o.payment_status = 'PAID'
        AND COALESCE(o.status, '') != 'CANCELLED'
        AND DATE(COALESCE(o.settled_at, d.created_at)) = DATE(?)
    `).get(reportDate).total : 0;
    const refunds = tableExists(db, 'refunds') ? db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM refunds
      WHERE DATE(created_at) = DATE(?)
    `).get(reportDate).total : 0;
    const itemSales = db.prepare(`
      SELECT COALESCE(i.name, oi.combo_name, 'Item #' || oi.item_id) AS itemName,
             COALESCE(SUM(oi.quantity), 0) AS quantitySold,
             COALESCE(SUM(oi.quantity * COALESCE(oi.price, i.price, 0)), 0) AS totalSales
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN items i ON i.id = oi.item_id
      WHERE o.payment_status = 'PAID'
        AND COALESCE(o.status, '') != 'CANCELLED'
        AND DATE(COALESCE(o.settled_at, o.created_at)) = DATE(?)
      GROUP BY COALESCE(i.name, oi.combo_name, 'Item #' || oi.item_id)
      ORDER BY totalSales DESC
    `).all(reportDate);

    return {
      restaurantId,
      reportDate,
      summary: {
        grossSales: Number(gross.gross_sales || 0),
        netSales: Number(orderSummary.net_sales || 0),
        taxAmount: Number(orderSummary.tax_amount || 0),
        discountAmount: Number(orderSummary.loyalty_discount || 0) + Number(manualDiscounts || 0),
        refundsAmount: Number(refunds || 0),
        ordersCount: Number(orderSummary.orders_count || 0),
        cashTotal: Number(paymentTotals.CASH || 0),
        cardTotal: Number(paymentTotals.CARD || 0),
        upiTotal: Number(paymentTotals.UPI || 0)
      },
      itemSales: itemSales.map((row) => ({
        itemName: row.itemName,
        quantitySold: Number(row.quantitySold || 0),
        totalSales: Number(row.totalSales || 0)
      }))
    };
  } finally {
    db.close();
  }
}

function saveCloudSyncQueue(db, payload) {
  const entityType = 'DAILY_REPORT';
  const entityId = payload.reportDate;
  const existing = db.prepare(`
    SELECT id FROM cloud_sync_queue
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(entityType, entityId);
  const json = JSON.stringify(payload);
  if (existing) {
    db.prepare(`
      UPDATE cloud_sync_queue
      SET payload = ?, status = 'PENDING', last_error = NULL, synced_at = NULL
      WHERE id = ?
    `).run(json, existing.id);
    return existing.id;
  }
  return db.prepare(`
    INSERT INTO cloud_sync_queue (entity_type, entity_id, payload, status)
    VALUES (?, ?, ?, 'PENDING')
  `).run(entityType, entityId, json).lastInsertRowid;
}

async function sendDailyReportToSaas(db, restaurantId, payload) {
  const saasUrl = process.env.SAAS_URL;
  if (!saasUrl) throw new Error('SAAS_URL is not configured');
  const license = db.prepare('SELECT license_key FROM license_status WHERE restaurant_id = ?').get(restaurantId);
  const syncToken = getConfigValue(db, 'cloud_sync_token', '');
  if (!syncToken && !license?.license_key) throw new Error('Cloud sync token or license key is required');
  const response = await axios.post(`${saasUrl.replace(/\/$/, '')}/sync/daily-report`, {
    restaurantId,
    licenseKey: license?.license_key || null,
    syncToken: syncToken || null,
    reportDate: payload.reportDate,
    summary: payload.summary,
    itemSales: payload.itemSales
  }, { timeout: 7000 });
  if (!response.data?.success) throw new Error(response.data?.message || 'Cloud sync failed');
  return response.data;
}

async function syncQueuedReport(db, restaurantId, row) {
  const payload = JSON.parse(row.payload);
  try {
    await sendDailyReportToSaas(db, restaurantId, payload);
    db.prepare(`
      UPDATE cloud_sync_queue
      SET status = 'SYNCED', attempts = attempts + 1, last_error = NULL, synced_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(row.id);
    cloudSyncStatus(db, restaurantId, 'SYNCED', `Synced ${payload.reportDate}`);
    trackModuleUsage(restaurantId, 'CLOUD_REPORTING', 'DAILY_REPORT_UPLOADED').catch(() => {});
    return { success: true, reportDate: payload.reportDate };
  } catch (err) {
    db.prepare(`
      UPDATE cloud_sync_queue
      SET status = 'FAILED', attempts = attempts + 1, last_error = ?
      WHERE id = ?
    `).run(err.message, row.id);
    cloudSyncStatus(db, restaurantId, 'FAILED', err.message);
    return { success: false, reportDate: payload.reportDate, message: err.message };
  }
}

async function runCloudSyncForDate(restaurantId, dateValue) {
  const payload = buildDailyReportPayload(restaurantId, dateValue);
  const db = openRestaurantDatabase(restaurantId);
  try {
    const queueId = saveCloudSyncQueue(db, payload);
    const row = db.prepare('SELECT * FROM cloud_sync_queue WHERE id = ?').get(queueId);
    return await syncQueuedReport(db, restaurantId, row);
  } finally {
    db.close();
  }
}

async function retryCloudSyncQueue(restaurantId) {
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT * FROM cloud_sync_queue
      WHERE status IN ('PENDING', 'FAILED') AND attempts < 20
      ORDER BY created_at ASC
      LIMIT 10
    `).all();
    const results = [];
    for (const row of rows) {
      results.push(await syncQueuedReport(db, restaurantId, row));
    }
    return results;
  } finally {
    db.close();
  }
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

async function runCloudSyncSchedulerTick() {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return;
  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    if (!getBooleanConfig(db, 'cloud_sync_enabled', true)) return;
    const lastSevenRun = getConfigValue(db, 'cloud_sync_last_7_days_at', '');
    db.close();
    db = null;

    await retryCloudSyncQueue(restaurantId);
    await runCloudSyncForDate(restaurantId, dateDaysAgo(0));

    if (lastSevenRun !== dateDaysAgo(0)) {
      for (let offset = 1; offset <= 7; offset += 1) {
        await runCloudSyncForDate(restaurantId, dateDaysAgo(offset));
      }
      const settingsDb = openRestaurantDatabase(restaurantId);
      try {
        setConfigValues(settingsDb, { cloud_sync_last_7_days_at: dateDaysAgo(0) });
      } finally {
        settingsDb.close();
      }
    }
  } catch (err) {
    console.warn('Cloud reporting sync skipped:', err.message);
  } finally {
    if (db) db.close();
  }
}

setInterval(runCloudSyncSchedulerTick, 15 * 60 * 1000);

async function sendPosHeartbeat() {
  const restaurantId = getSingleRestaurantId();
  const saasUrl = process.env.SAAS_URL;
  if (!restaurantId || !saasUrl) return;
  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    const license = db.prepare('SELECT license_key, status FROM license_status WHERE restaurant_id = ?').get(restaurantId) || {};
    const syncToken = getConfigValue(db, 'cloud_sync_token', '');
    const backup = getBackupConfig(db);
    const pendingPrintJobs = db.prepare("SELECT COUNT(*) AS count FROM print_jobs WHERE status = 'PENDING'").get().count;
    await axios.post(`${saasUrl.replace(/\/$/, '')}/monitoring/heartbeat`, {
      restaurantId,
      licenseKey: license.license_key || null,
      syncToken: syncToken || null,
      posVersion: posPackageInfo().version,
      backupStatus: backup.last_backup_at ? `Last backup ${backup.last_backup_at}` : 'No backup yet',
      printerStatus: pendingPrintJobs > 0 ? `PENDING:${pendingPrintJobs}` : 'OK',
      licenseStatus: license.status || 'UNKNOWN',
      appStatus: 'OK'
    }, { timeout: 5000 });
  } catch (err) {
    console.warn('POS heartbeat skipped:', err.message);
  } finally {
    if (db) db.close();
  }
}

setInterval(sendPosHeartbeat, 60 * 1000);

app.post('/cloud-sync/run', async (req, res) => {
  const { restaurantId, actor, date } = req.body;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  let db;
  try {
    db = openRestaurantDatabase(restaurantId);
    if (actor?.role) requirePermission(db, actor.role, 'reports.export', 'Cloud sync requires report export permission');
    db.close();
    db = null;
    const retryResults = await retryCloudSyncQueue(restaurantId);
    const result = await runCloudSyncForDate(restaurantId, date || dateDaysAgo(0));
    res.json({ success: true, result, retryResults });
  } catch (err) {
    sendError(res, err);
  } finally {
    if (db) db.close();
  }
});

app.get('/cloud-sync/status', (req, res) => {
  const restaurantId = req.query.restaurantId || getSingleRestaurantId();
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const status = db.prepare('SELECT * FROM cloud_sync_status WHERE restaurant_id = ?').get(restaurantId) || null;
    res.json({ success: true, status });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/cloud-sync/queue', (req, res) => {
  const restaurantId = req.query.restaurantId || getSingleRestaurantId();
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    const rows = db.prepare(`
      SELECT id, entity_type, entity_id, status, attempts, last_error, created_at, synced_at
      FROM cloud_sync_queue
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    res.json({ success: true, queue: rows });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

function posPackageInfo() {
  return require('../package.json');
}

function printAgentPackageInfo() {
  try {
    return require('../../print-agent/package.json');
  } catch (_) {
    return null;
  }
}

function compareSemver(a, b) {
  const left = String(a || '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

function logUpdate(db, currentVersion, targetVersion, status, message) {
  db.prepare(`
    INSERT INTO update_logs (current_version, target_version, status, message)
    VALUES (?, ?, ?, ?)
  `).run(currentVersion || null, targetVersion || null, status, message || null);
}

function latestUpdateUrl() {
  const saasUrl = process.env.SAAS_URL;
  if (!saasUrl) return null;
  return `${saasUrl.replace(/\/$/, '')}/updates/latest`;
}

function hasActiveOrders(db) {
  return Boolean(db.prepare(`
    SELECT id FROM orders
    WHERE payment_status != 'PAID'
      AND status NOT IN ('CANCELLED', 'PAID')
    LIMIT 1
  `).get());
}

function canViewAudit(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return ['OWNER', 'MANAGER_2'].includes(role);
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'audit.view');
  } finally {
    db.close();
  }
}

function canExportAudit(role) {
  const restaurantId = getSingleRestaurantId();
  if (!restaurantId) return role === 'OWNER';
  const db = openRestaurantDatabase(restaurantId);
  try {
    return canRole(db, role, 'reports.export');
  } finally {
    db.close();
  }
}

function auditFilters(query) {
  const clauses = [];
  const params = [];
  if (query.fromDate) {
    clauses.push('DATE(created_at) >= DATE(?)');
    params.push(query.fromDate);
  }
  if (query.toDate) {
    clauses.push('DATE(created_at) <= DATE(?)');
    params.push(query.toDate);
  }
  if (query.user) {
    clauses.push('(performed_by LIKE ? OR user_role LIKE ? OR actor_role LIKE ?)');
    params.push(`%${query.user}%`, `%${query.user}%`, `%${query.user}%`);
  }
  if (query.action) {
    clauses.push('action = ?');
    params.push(query.action);
  }
  if (query.entityType) {
    clauses.push('entity_type = ?');
    params.push(query.entityType);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

app.get('/audit/logs', (req, res) => {
  const { restaurantId, role } = req.query;
  if (!restaurantId || !canViewAudit(role)) {
    return res.status(403).json({ success: false, message: 'Audit dashboard requires OWNER or MANAGER_2' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    const filters = auditFilters(req.query);
    const rows = db.prepare(`
      SELECT id, restaurant_id, COALESCE(performed_by, user_role, actor_role) AS user,
             COALESCE(user_role, actor_role) AS user_role, action, entity_type, entity_id,
             old_value, new_value, ip_address, created_at
      FROM audit_logs
      ${filters.where}
      ORDER BY created_at DESC
      LIMIT 200
    `).all(...filters.params);

    let events = [];
    if (req.query.severity) {
      events = db.prepare(`
        SELECT * FROM compliance_events
        WHERE severity = ?
          AND (? IS NULL OR DATE(created_at) >= DATE(?))
          AND (? IS NULL OR DATE(created_at) <= DATE(?))
        ORDER BY created_at DESC
        LIMIT 100
      `).all(req.query.severity, req.query.fromDate || null, req.query.fromDate || null, req.query.toDate || null, req.query.toDate || null);
    }
    res.json({ success: true, logs: rows, complianceEvents: events });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/audit/compliance-summary', (req, res) => {
  const { restaurantId, role } = req.query;
  if (!restaurantId || !canViewAudit(role)) {
    return res.status(403).json({ success: false, message: 'Audit dashboard requires OWNER or MANAGER_2' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    const countEvent = db.prepare("SELECT COUNT(*) AS count FROM compliance_events WHERE event_type = ? AND DATE(created_at) = DATE('now')");
    const failedLogins = db.prepare("SELECT COUNT(*) AS count FROM compliance_events WHERE event_type = 'FAILED_LOGIN' AND DATE(created_at) = DATE('now')").get().count;
    res.json({
      success: true,
      cards: {
        refundsToday: countEvent.get('REFUND').count,
        voidedBillsToday: countEvent.get('VOIDED_BILL').count,
        manualDiscountsToday: countEvent.get('MANUAL_DISCOUNT').count,
        nonInvoiceSalesToday: countEvent.get('NON_INVOICE_ORDER').count,
        failedLogins,
        backupRestoreEvents: countEvent.get('BACKUP_RESTORE').count
      },
      events: db.prepare('SELECT * FROM compliance_events ORDER BY created_at DESC LIMIT 100').all()
    });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/audit/export', (req, res) => {
  const { restaurantId, role } = req.query;
  if (!restaurantId || !canExportAudit(role)) {
    return res.status(403).json({ success: false, message: 'Audit export requires OWNER' });
  }
  const db = openRestaurantDatabase(restaurantId);
  try {
    const filters = auditFilters(req.query);
    const rows = db.prepare(`
      SELECT created_at, COALESCE(performed_by, user_role, actor_role) AS user,
             COALESCE(user_role, actor_role) AS user_role, action, entity_type, entity_id,
             old_value, new_value, ip_address
      FROM audit_logs
      ${filters.where}
      ORDER BY created_at DESC
    `).all(...filters.params);
    const header = ['created_at', 'user', 'user_role', 'action', 'entity_type', 'entity_id', 'old_value', 'new_value', 'ip_address'];
    const csv = [header.join(',')]
      .concat(rows.map((row) => header.map((key) => csvCell(row[key])).join(',')))
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.csv"');
    res.send(csv);
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

function downloadFile(fileUrl, targetPath) {
  const fs = require('fs');
  const http = require('http');
  const https = require('https');
  const client = fileUrl.startsWith('https:') ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(fileUrl, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, targetPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      const stream = fs.createWriteStream(targetPath);
      response.pipe(stream);
      stream.on('finish', () => stream.close(resolve));
      stream.on('error', reject);
    });
    request.on('error', reject);
  });
}

function sha256File(filePath) {
  const fs = require('fs');
  const crypto = require('crypto');
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

app.get('/version', (req, res) => {
  const restaurantId = getSingleRestaurantId();
  const printInfo = printAgentPackageInfo();
  res.json({
    success: true,
    app: 'POS',
    posVersion: posPackageInfo().version,
    printAgentVersion: printInfo?.version || null,
    restaurantId: restaurantId || null,
    timestamp: new Date().toISOString()
  });
});

app.get('/updates/check', async (req, res) => {
  const restaurantId = req.query.restaurantId || getSingleRestaurantId();
  const currentVersion = posPackageInfo().version;
  const url = latestUpdateUrl();

  if (!url) {
    return res.json({ success: true, updateAvailable: false, message: 'SAAS_URL is not configured', currentVersion });
  }

  let db;
  try {
    if (restaurantId) db = openRestaurantDatabase(restaurantId);
    const response = await axios.get(url, { timeout: 5000 });
    const latest = response.data;
    const latestVersion = latest.version || latest.release?.version;
    const updateAvailable = latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false;
    if (db) logUpdate(db, currentVersion, latestVersion, 'CHECKED', updateAvailable ? 'Update available' : 'POS is up to date');
    res.json({
      success: true,
      updateAvailable,
      currentVersion,
      latestVersion: latestVersion || null,
      releaseNotes: latest.release_notes || latest.release?.release_notes || '',
      mandatoryUpdate: Boolean(latest.mandatory_update || latest.release?.mandatory_update),
      files: latest.files || latest.release?.files || [],
      message: updateAvailable ? 'Update available' : 'POS is up to date'
    });
  } catch (err) {
    if (db) logUpdate(db, currentVersion, null, 'FAILED', 'Update check offline or failed');
    res.json({ success: true, updateAvailable: false, currentVersion, message: 'offline' });
  } finally {
    if (db) db.close();
  }
});

app.post('/updates/download', async (req, res) => {
  const { restaurantId, version, files } = req.body;
  const activeRestaurantId = restaurantId || getSingleRestaurantId();
  const currentVersion = posPackageInfo().version;
  if (!activeRestaurantId || !version || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ success: false, message: 'restaurantId, version and files are required' });
  }

  let db;
  try {
    db = openRestaurantDatabase(activeRestaurantId);
    if (hasActiveOrders(db)) {
      logUpdate(db, currentVersion, version, 'FAILED', 'Update download blocked because active orders exist');
      return res.status(409).json({ success: false, message: 'Finish or cancel active orders before downloading updates' });
    }

    const fs = require('fs');
    const path = require('path');
    const stagingDir = path.join(__dirname, '../updates/staging', version);
    fs.mkdirSync(stagingDir, { recursive: true });
    const downloaded = [];

    for (const file of files) {
      if (!file.file_name || !file.file_url) throw new Error('Each update file needs file_name and file_url');
      const safeName = path.basename(file.file_name);
      const targetPath = path.join(stagingDir, safeName);
      await downloadFile(file.file_url, targetPath);
      if (file.checksum) {
        const expected = String(file.checksum).replace(/^sha256:/i, '').toLowerCase();
        const actual = (await sha256File(targetPath)).toLowerCase();
        if (actual !== expected) {
          fs.unlinkSync(targetPath);
          throw new Error(`Checksum mismatch for ${safeName}`);
        }
      }
      downloaded.push({ fileName: safeName, path: targetPath });
    }

    logUpdate(db, currentVersion, version, 'DOWNLOADED', `Downloaded ${downloaded.length} file(s) to staging`);
    res.json({ success: true, status: 'DOWNLOADED', version, stagingDir, files: downloaded });
  } catch (err) {
    if (db) logUpdate(db, currentVersion, version, 'FAILED', err.message);
    sendError(res, err);
  } finally {
    if (db) db.close();
  }
});

app.get('/updates/logs', (req, res) => {
  const restaurantId = req.query.restaurantId || getSingleRestaurantId();
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const db = openRestaurantDatabase(restaurantId);
  try {
    res.json({ success: true, logs: db.prepare('SELECT * FROM update_logs ORDER BY created_at DESC LIMIT 20').all() });
  } catch (err) {
    sendError(res, err);
  } finally {
    db.close();
  }
});

app.get('/health', (req, res) => {
  const activeRestaurantId = getSingleRestaurantId();
  const packageInfo = posPackageInfo();
  const health = {
    success: true,
    app: 'POS',
    version: packageInfo.version,
    database: {
      status: activeRestaurantId ? 'UNKNOWN' : 'NO_ACTIVE_RESTAURANT',
      fileExists: false
    },
    activeRestaurantId: activeRestaurantId || null,
    timestamp: new Date().toISOString()
  };

  if (!activeRestaurantId) return res.json(health);

  let db;
  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, '../data', `restaurant_${activeRestaurantId}.db`);
    health.database.fileExists = fs.existsSync(dbPath);
    db = openRestaurantDatabase(activeRestaurantId);
    db.prepare('SELECT 1').get();
    health.database.status = 'OK';
  } catch (err) {
    health.success = false;
    health.database.status = 'ERROR';
    health.database.message = err.message;
    res.status(503);
  } finally {
    if (db) db.close();
  }

  res.json(health);
});

// ========================
// START SERVER
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 POS backend running at http://localhost:${PORT}`);
});
