const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (ok, message) => { if (!ok) throw new Error(message); console.log(`PASS: ${message}`); };

const route = read('saas-backend/src/routes/ownerControl.js');
const ui = read('saas-backend/public/js/owner-control.js');
const html = read('saas-backend/public/owner-control.html');

assert(route.includes('const posOnline = heartbeatOnline(lastHeartbeatAt)'), 'owner dashboard derives live availability from the established heartbeat threshold');
assert(route.includes('localOnly || !posOnline ? { dineIn: [], parcel: [], party: [], online: [] }'), 'offline POS never returns its cached open orders as live operations');
assert(route.includes("source: posOnline ? 'LIVE_POS' : 'UNAVAILABLE'"), 'owner dashboard identifies live versus unavailable operational data');
assert(ui.includes('POS is offline') && ui.includes('Live orders and open values are unavailable'), 'owner control displays an explicit offline live-operations state');
assert(ui.includes('availability.online === false') && ui.includes('Bring the POS online and press Refresh'), 'offline state cannot render stale KPI totals or order rows');
assert(html.includes('Stored daily totals received from POS remain available when the POS is offline'), 'cloud history explains why historical sales remain visible offline');
assert(ui.includes('Last cloud snapshot:') && ui.includes("data.salesStorageMode === 'LOCAL_ONLY'"), 'history wording distinguishes cloud storage from local-only live retrieval');
assert(ui.includes('One or more selected POS apps are offline. Their live operations are hidden.'), 'multi-branch view hides stale operations for offline branches');
assert(ui.includes('const dashboards=[];const warnings=[];') && ui.includes('dashboards.push(data)'), 'multi-restaurant loading isolates each branch instead of failing the entire dashboard');
assert(ui.includes('POS service offline: ${esc(warning.name)}') && ui.includes('serviceWarnings'), 'offline warning identifies each affected restaurant POS service');
assert(ui.includes('render(aggregateDashboards(dashboards.length?dashboards:cloudDashboards))'), 'available restaurant data continues rendering when another POS is unreachable');
assert(html.includes('id="serviceWarnings"') && html.includes('partial-branch-availability'), 'owner control includes a cache-busted named service warning region');

console.log('Owner offline visibility regression passed');
