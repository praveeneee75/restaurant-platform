const assert = require('assert');
const fs = require('fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const css = read('pos-app/backend/public/css/style.css');
const pos = read('pos-app/backend/public/js/pos-live.js');
const admin = read('pos-app/backend/public/js/admin-dashboard.js');
const adminHtml = read('pos-app/backend/public/admin.html');
const server = read('pos-app/backend/server.js');
const mobile = read('mobile-app/www/js/app.js');

assert(css.includes('.parcel-bill-header') && css.includes('background:var(--primary)'),
  'Parcel bill heading must use the application primary colour');
assert(css.includes('@media (max-width: 1400px)') && css.includes('text-overflow: ellipsis'),
  'Zoomed desktop layouts must keep operational labels on one line');
assert(pos.includes('function taxInclusiveUnitPrice') && pos.includes('money(taxInclusiveUnitPrice(item))'),
  'POS menu and order views must display tax-inclusive unit prices');
assert(pos.includes('tax_mode: item.tax_mode || "INCLUSIVE"'),
  'Retrieved POS cart lines must preserve tax treatment for totals and unit prices');
assert(pos.includes('fetchOpenOrderDetails(orderId, { fresh: true })') && pos.includes('controller.abort(), 12000'),
  'Explicit order retrieval must bypass stale cache and fail promptly instead of hanging');
assert(adminHtml.includes('id="itemValidationStatus"') && admin.includes('This ${field} is already used by'),
  'Menu item duplicate validation must be shown beside the editor');
assert(server.includes("if (activeNameExists(db, 'items', 'name', name, id))") && server.includes('Alphabetic and numeric short codes must be unique'),
  'Server must reject duplicate item names and short codes');
assert(server.includes('EXISTS (SELECT 1 FROM order_items live_items WHERE live_items.order_id = o.id AND live_items.kot_id IS NOT NULL)'),
  'Live Orders must exclude saved drafts without a submitted KOT');
assert(mobile.includes('const reachedPosError') && mobile.includes('if (reachedPosError) throw new Error(reachedPosError.message'),
  'Mobile login must preserve authentication errors returned by a reachable POS');

console.log('POS UI and data-integrity regression passed');
