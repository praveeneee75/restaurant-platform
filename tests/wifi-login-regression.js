const assert = require('assert');
const net = require('net');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { PREFERRED_POS_PORT, findAvailablePort } = require(path.join(root, 'pos-app/electron/posPort'));

(async () => {
  const preferred = await findAvailablePort();
  assert.strictEqual(preferred, PREFERRED_POS_PORT, 'POS should use its stable LAN port when available');

  const blocker = net.createServer();
  await new Promise((resolve, reject) => blocker.once('error', reject).listen(PREFERRED_POS_PORT, '127.0.0.1', resolve));
  try {
    const fallback = await findAvailablePort();
    assert.notStrictEqual(fallback, PREFERRED_POS_PORT, 'POS should fall back safely if the stable port is occupied');
    assert.ok(fallback > 0, 'fallback port should be valid');
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }

  const server = fs.readFileSync(path.join(root, 'pos-app/backend/server.js'), 'utf8');
  assert.match(server, /sendPosHeartbeat\(\).*Initial POS heartbeat skipped/, 'POS should advertise its port as soon as it starts');

  const mobile = fs.readFileSync(path.join(root, 'mobile-app/www/js/app.js'), 'utf8');
  const loginStart = mobile.indexOf('async function findLocalStaffLogin');
  const attemptsStart = mobile.indexOf('const attempts = candidates.map', loginStart);
  const refreshStart = mobile.indexOf('await fetchRestaurantDirectory()', loginStart);
  assert.ok(refreshStart > loginStart && refreshStart < attemptsStart, 'mobile login should refresh POS discovery before connecting');
  assert.match(mobile, /CAPTAIN:\s*"captain"/, 'captains should land in the dedicated Dine In workspace');
  assert.match(mobile, /captain:\s*`\$\{posBase\}\/waiter\.html/, 'captains should use the dedicated mobile Dine In interface');
  assert.match(mobile, /webviewPanel\.classList\.toggle\("staff-workspace"/, 'staff should not see the duplicate outer workspace header');
  assert.doesNotMatch(mobile, /if \(state\.user && !state\.user\.cloudOwner\) logoutButton\.click/, 'closing a workspace must not log staff out');
  assert.doesNotMatch(mobile, /CAPTAIN[^\n]+WAITER[^\n]+\]\s*,\s*\n\s*waiter:/, 'captains should not be offered the separate waiter role');
  assert.match(mobile, /Update POS Desktop to 1\.0\.147 or later/, 'mobile Dine In must reject an older POS instead of silently showing the old workflow');

  const posLive = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/pos-live.js'), 'utf8');
  assert.match(posLive, /mobileSessionParams\.get\("mobileRole"\)/, 'generic mobile POS links should restore the authenticated mobile session');
  assert.match(posLive, /mobileDineLayout/, 'POS Dine In may expose a mobile presentation mode for cashier fallback');
  for (const control of ['newCheckBtn', 'parcelCheckBtn', 'customerPhone', 'customerName', 'submitKot', 'finalBillPrintOrder']) {
    assert.ok(posLive.includes(control), `mobile POS engine should retain desktop control: ${control}`);
  }

  const waiter = fs.readFileSync(path.join(root, 'pos-app/backend/public/waiter.html'), 'utf8');
  const waiterJs = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/waiter.js'), 'utf8');
  for (const step of ['tables', 'check', 'menu', 'order']) {
    assert.match(waiter, new RegExp(`data-waiter-step="${step}"`), `mobile Dine In should provide the ${step} step`);
  }
  assert.match(waiterJs, /postJson\("\/orders\/lock", \{ tableId: state\.selectedTable\.id, orderId \}\)/, 'switching customer checks must rebind the table lock to the selected order');
  assert.match(waiterJs, /fulfillment_type[\s\S]*=== fulfillmentType/, 'dine-in and linked parcel carts must remain visually separated');
  assert.match(waiterJs, /Number\(row\.id\) === Number\(itemId\) && !row\.sentToKitchen/, 'adding an already-KOT item must create a new KOT line instead of changing the submitted line');
  assert.match(waiterJs, /showMobileStep\(state\.openOrders\.length \|\| table\.status === "OCCUPIED" \? "check" : "menu"\)/, 'occupied tables must require check selection before item entry');
  assert.doesNotMatch(waiterJs, /loadWaiterOrder\(state\.openOrders\[0\]/, 'selecting an occupied table must not silently choose its first customer');
  assert.match(waiterJs, /data-menu-note/, 'selected menu items must expose an inline mobile note field');
  assert.match(waiterJs, /reviewWaiterOrder/, 'the item screen must provide a clear next step to customer validation and review');
  assert.match(waiterJs, /finalWaiterCheck\.hidden = state\.settings\.showFinalBillPrintDineIn === false/, 'Final Check, Bill & Print must follow the Dine In admin setting');
  assert.match(waiterJs, /parcelWaiterCheck\.disabled = !state\.orderId \|\| state\.fulfillmentType !== "DINE_IN"/, 'captain parcel must only be created from an existing Dine In customer check');
  assert.match(waiterJs, /const user = userFromMobileParams\(\) \|\| JSON\.parse/, 'the current authenticated mobile session must override stale waiter-page storage');
  assert.match(waiterJs, /waiterOrderSelectorLabel\.hidden = state\.openOrders\.length <= 1/, 'the customer-check dropdown must only appear when multiple checks require a choice');
  assert.match(waiterJs, /state\.openOrders\.length === 1[\s\S]*loadWaiterOrder\(onlyOrderId\)/, 'a single existing customer check must be selected automatically');
  assert.match(waiterJs, /await returnToTables\(\)/, 'successful KOT and final-check actions must return the Captain to Tables');
  assert.doesNotMatch(waiter, /unlockWaiterTable/, 'manual table unlock must not be exposed in the Captain workflow');
  assert.match(mobile, /showDashboardView\("Owner control loaded\."\)/, 'owner navigation must stay in the mobile owner dashboard');

  console.log('Wi-Fi login regression checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
