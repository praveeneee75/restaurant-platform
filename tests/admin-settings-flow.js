const fs = require('fs');
const path = require('path');
const http = require('http');

const testDataDir = path.join(__dirname, '..', '.codex-admin-settings-test');
fs.rmSync(testDataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = testDataDir;
process.env.PORT = '3404';
process.env.POS_HEARTBEAT_DISABLED = '1';

const restaurantId = 'RESTOWHITELABEL';
const actor = { id: 1, role: 'OWNER' };
const { setupDatabase } = require('../pos-app/backend/services/dbSetup');
const { openDatabase } = require('../pos-app/backend/db/database');
const { seedWhitelabelDemoData } = require('../pos-app/backend/services/whitelabelDemoSeed');

setupDatabase(restaurantId);
const seedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(seedDb, { restaurantId, force: true });
seedDb.close();
require('../pos-app/backend/server');

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3404,
      path: url,
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const contentType = String(res.headers['content-type'] || '');
        resolve({ status: res.statusCode, data: contentType.includes('application/json') ? JSON.parse(data) : data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function post(url, body) {
  const response = await request('POST', url, { restaurantId, actor, ...body });
  if (response.status >= 400 || response.data.success === false) {
    throw new Error(`${url}: ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

function assertSettings(actual, expected, label) {
  Object.entries(expected).forEach(([key, value]) => {
    if (String(actual[key]) !== String(value)) {
      throw new Error(`${label}: ${key} expected ${JSON.stringify(String(value))}, received ${JSON.stringify(actual[key])}`);
    }
  });
}

(async () => {
  const legacyDb = openDatabase(restaurantId);
  legacyDb.prepare("UPDATE system_config SET value = '33DEMO1234F1Z5' WHERE key = 'gstin'").run();
  seedWhitelabelDemoData(legacyDb, { restaurantId, force: true });
  const migratedGstin = legacyDb.prepare("SELECT value FROM system_config WHERE key = 'gstin'").get()?.value;
  legacyDb.close();
  if (migratedGstin !== '33ABCDE1234F1Z5') throw new Error(`Legacy demo GSTIN was not corrected: ${migratedGstin}`);

  const settings = {
    restaurant_display_name: 'Persisted Restaurant Name',
    legal_name: 'Persisted Foods Private Limited',
    gstin: '33ABCDE1234F1Z5',
    fssai_license_no: '12345678901234',
    state_code: '33',
    address_line_1: '12 Test High Street',
    address_line_2: 'Near Test Bus Stand',
    city: 'Chennai',
    state: 'Tamil Nadu',
    country: 'India',
    phone: '9876543210',
    email: 'billing@example.test',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    logo_path: 'C:\\Restaurant\\logo.png',
    default_order_type: 'DINE_IN',
    allow_non_invoice_orders: '0',
    allow_discount: '1',
    allow_manual_price_override: '1',
    allow_refund: '1',
    allow_order_cancel: '1',
    require_manager_pin_for_discount: '1',
    require_manager_pin_for_refund: '1',
    require_manager_pin_for_void: '1',
    require_clock_in_before_order: '1',
    invoice_prefix: 'TST',
    invoice_reset_frequency: 'MONTHLY',
    show_tax_on_bill: '1',
    tax_name: 'GST',
    tax_rate: '5',
    sac_code: '996331',
    show_qr_on_bill: '1',
    upi_id: 'test@upi',
    service_charge_enabled: '1',
    service_charge_percent: '2.5',
    round_off_enabled: '1',
    auto_print_kot: '1',
    print_kot_on_save: '0',
    print_kot_on_submit: '1',
    allow_kot_reprint: '1',
    kot_header_text: 'TEST KITCHEN',
    kot_footer_text: 'PREPARE CAREFULLY',
    kot_template: 'BORDERLESS',
    kot_print_table: '1',
    kot_print_customer: '1',
    kot_print_kitchen: '1',
    kot_compact_spacing: '1',
    kot_left_margin_dots: '4',
    kot_trailing_feed_lines: '1',
    kot_cut_mode: 'PARTIAL',
    kot_print_width_58: '29',
    kot_print_width_80: '41',
    kot_font_type: 'FONT_B',
    kot_font_size: 'COMPACT',
    kot_line_spacing_dots: '20',
    bill_print_contact: '1',
    bill_print_kot_references: '1',
    bill_print_customer: '1',
    bill_print_payment: '1',
    bill_print_authorised_signatory: '1',
    bill_footer_text: 'THANK YOU',
    bill_template: 'COMPACT',
    bill_left_margin_dots: '3',
    bill_trailing_feed_lines: '2',
    bill_cut_mode: 'FULL',
    bill_print_width_58: '28',
    bill_print_width_80: '40',
    bill_font_type: 'FONT_A',
    bill_font_size: 'NORMAL',
    bill_line_spacing_dots: '22',
    require_open_register_for_cash_payment: '1',
    allow_cashier_register_close: '1',
    cash_discrepancy_threshold: '25.5',
    qr_ordering_enabled: '0',
    mobile_app_enabled: '0',
    online_order_enabled: '0',
    online_storefront_slug: 'persisted-restaurant',
    online_theme: 'MODERN',
    online_primary_color: '#123456',
    online_accent_color: '#abcdef',
    online_logo_path: 'https://example.test/logo.png',
    online_payment_methods: 'UPI,CARD,COD',
    online_require_otp: '1',
    online_allow_loyalty_credit: '0',
    online_delivery_enabled: '1',
    online_takeaway_enabled: '1',
    online_min_order_amount: '150'
  };

  await post('/settings/update', { settings });
  let loaded = await request('GET', `/settings?restaurantId=${restaurantId}`);
  assertSettings(loaded.data.settings, settings, 'save and reload');

  const refreshDb = openDatabase(restaurantId);
  seedWhitelabelDemoData(refreshDb, { restaurantId, force: true });
  refreshDb.close();
  loaded = await request('GET', `/settings?restaurantId=${restaurantId}`);
  assertSettings(loaded.data.settings, settings, 'demo licence refresh');

  const invalidFssai = await request('POST', '/settings/update', {
    restaurantId,
    actor,
    settings: { fssai_license_no: '1234' }
  });
  if (invalidFssai.status < 400 || !/14 digits/i.test(invalidFssai.data.message || '')) {
    throw new Error(`Invalid FSSAI value was not rejected clearly: ${JSON.stringify(invalidFssai)}`);
  }

  const backupSettings = {
    backup_enabled: '1',
    backup_folder_path: 'C:\\Restaurant\\Backups',
    onedrive_folder_path: 'C:\\Users\\Restaurant\\OneDrive\\Backups',
    backup_interval_minutes: '45'
  };
  await post('/backup/settings', { settings: backupSettings });
  const backup = await request('GET', `/backup/settings?restaurantId=${restaurantId}`);
  assertSettings(backup.data.settings, backupSettings, 'backup save and reload');

  await post('/admin/promo-codes/save', {
    code: 'SETTINGS25',
    discountType: 'PERCENT',
    discountValue: 25,
    maxDiscountAmount: 250,
    minOrderAmount: 500,
    validFrom: '2026-07-01',
    validTo: '2026-12-31',
    active: true
  });
  const promos = await request('GET', `/admin/promo-codes?restaurantId=${restaurantId}&includeInactive=true`);
  const promo = promos.data.promoCodes.find((row) => row.code === 'SETTINGS25');
  if (!promo || promo.discount_type !== 'PERCENT' || Number(promo.discount_value) !== 25 || Number(promo.max_discount_amount) !== 250) {
    throw new Error(`Promo code did not save and reload: ${JSON.stringify(promo)}`);
  }

  const qrPage = await request('GET', `/qr-menu.html?restaurantId=${restaurantId}&tableId=1`);
  if (qrPage.status !== 200 || !String(qrPage.data || '').includes('QR Menu')) throw new Error('QR menu page did not load from the local POS');
  const network = await request('GET', '/network/info');
  if (!/^https:\/\//.test(network.data.publicQrBaseUrl || '') || !String(network.data.publicQrBaseUrl).includes('pos.kmasterpos.com')) {
    throw new Error(`Public QR base URL is not customer-reachable: ${network.data.publicQrBaseUrl}`);
  }

  const reports = await request('GET', `/reports/dashboard?restaurantId=${restaurantId}&role=OWNER&fromDate=2026-01-01&toDate=2026-12-31`);
  if (reports.status !== 200 || !Array.isArray(reports.data.dailySales) || !Array.isArray(reports.data.topSellingItems) || !Array.isArray(reports.data.orderSummary)) {
    throw new Error(`Reports dashboard returned an invalid payload: ${JSON.stringify(reports.data)}`);
  }

  const html = fs.readFileSync(path.join(__dirname, '..', 'pos-app', 'backend', 'public', 'admin.html'), 'utf8');
  const requiredUi = [
    'Table Management', 'User Management', 'data-view="staff-cash"', 'data-view="devices"', 'data-view="users"',
    'data-view="printers"', 'data-settings-section="kot"', 'data-settings-section="profile"',
    'data-settings-section="billing"', 'data-settings-section="promos"', 'data-settings-section="pos"',
    'data-view="backup"', 'data-settings-section="online"'
  ];
  requiredUi.forEach((marker) => {
    if (!html.includes(marker)) throw new Error(`Admin navigation is missing ${marker}`);
  });
  if ((html.match(/data-view="backup"/g) || []).length !== 1) throw new Error('Backup navigation is duplicated');
  if (/<form[^>]*id="promoCodeForm"/i.test(html)) throw new Error('Promo editor is still an invalid nested form');
  if (!/<form[^>]*id="settingsForm"[^>]*novalidate/i.test(html)) throw new Error('Settings form can still be silently blocked by hidden browser validation');

  const dashboardJs = fs.readFileSync(path.join(__dirname, '..', 'pos-app', 'backend', 'public', 'js', 'admin-dashboard.js'), 'utf8');
  if (!dashboardJs.includes('collectSettingsSection(activeSection)')) throw new Error('Settings UI does not save the active subsection independently');
  if (!dashboardJs.includes('control.disabled = !active')) throw new Error('Hidden subsection controls can still block form submission');
  if (!dashboardJs.includes('validateSettingsSection(activeSection)')) throw new Error('Settings sections are not validated without locking the form');
  if (!dashboardJs.includes('input.addEventListener("input"')) throw new Error('Settings validation errors are not cleared while the user edits');
  if (!dashboardJs.includes('data.topSellingItems')) throw new Error('Reports UI does not use the dashboard API top-selling field');

  const feedbackJs = fs.readFileSync(path.join(__dirname, '..', 'pos-app', 'backend', 'public', 'js', 'ui-feedback.js'), 'utf8');
  if (!feedbackJs.includes('window.alert = showAppMessage')) throw new Error('Native blocking alerts can still leave Electron inputs without focus');

  for (const page of ['admin.html', 'billing.html', 'kds.html', 'orders.html', 'pos-live.html', 'waiter.html', 'pos.html', 'customer.html', 'online-order.html', 'change-pin.html']) {
    const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'pos-app', 'backend', 'public', page), 'utf8');
    if (!pageHtml.includes('/js/ui-feedback.js')) throw new Error(`${page} does not use non-blocking application feedback`);
  }

  const css = fs.readFileSync(path.join(__dirname, '..', 'pos-app', 'backend', 'public', 'css', 'style.css'), 'utf8');
  if (/\.nav-sub-btn\s*\{[^}]*font-size/i.test(css)) throw new Error('Admin subsection font size still differs from normal navigation');

  for (const page of ['admin.html', 'billing.html', 'kds.html', 'orders.html', 'pos-live.html']) {
    const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'pos-app', 'backend', 'public', page), 'utf8');
    if (!pageHtml.includes('data-notification-center') || !pageHtml.includes('/js/nav-notifications.js')) {
      throw new Error(`${page} does not use the shared notification centre`);
    }
  }

  console.log(JSON.stringify({
    success: true,
    settingsFieldsVerified: Object.keys(settings).length,
    fssaiPersistsAfterRefresh: true,
    backupVerified: true,
    promoVerified: true,
    navigationVerified: true
  }));
  process.exit(0);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
