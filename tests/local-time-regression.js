const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { posDate, compactLocalDateTime } = require('../pos-app/electron/thermalEscPos');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/ui-feedback.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/admin-dashboard.js'), 'utf8');
const customer = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/customer.js'), 'utf8');
const orders = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/orders.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'pos-app/backend/server.js'), 'utf8');

assert.strictEqual(posDate('2026-07-22 05:30:42').getTime(), Date.parse('2026-07-22T05:30:42Z'), 'SQLite timestamps must be interpreted as UTC');
assert(!compactLocalDateTime('2026-07-22T05:30:42.042Z').includes('.042'), 'thermal output must use compact desktop-local time');
assert(ui.includes('window.formatPosDateTime') && ui.includes('date.toLocaleString(undefined, options)'), 'shared UI must format against the desktop locale/timezone');
assert(admin.includes('return window.formatPosDateTime(value)') && admin.includes('window.localIsoDate()'), 'Admin timestamps and date filters must use desktop-local time');
assert(customer.includes('window.formatPosDateTime(note.created_at)'), 'Customer history must show desktop-local time');
assert(orders.includes('window.formatPosDateTime(order.created_at)'), 'Orders must show desktop-local time');
assert(server.includes('function localIsoDateOnly') && server.includes('localIsoDateOnly().replace'), 'server-generated local business dates must follow the POS computer date');

console.log('Desktop-local time regression passed across print, POS, Admin, reports and customer/order history');
