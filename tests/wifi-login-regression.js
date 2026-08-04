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

  const posLive = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/pos-live.js'), 'utf8');
  assert.match(posLive, /mobileSessionParams\.get\("mobileRole"\)/, 'generic mobile POS links should restore the authenticated mobile session');
  assert.match(posLive, /mobileDineLayout/, 'POS Dine In may expose a mobile presentation mode for cashier fallback');
  for (const control of ['newCheckBtn', 'parcelCheckBtn', 'customerPhone', 'customerName', 'submitKot', 'finalBillPrintOrder']) {
    assert.ok(posLive.includes(control), `mobile POS engine should retain desktop control: ${control}`);
  }

  const waiter = fs.readFileSync(path.join(root, 'pos-app/backend/public/waiter.html'), 'utf8');
  const waiterJs = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/waiter.js'), 'utf8');
  for (const step of ['tables', 'menu', 'order']) {
    assert.match(waiter, new RegExp(`data-waiter-step="${step}"`), `mobile Dine In should provide the ${step} step`);
  }
  assert.match(waiterJs, /postJson\("\/orders\/lock", \{ tableId: state\.selectedTable\.id, orderId \}\)/, 'switching customer checks must rebind the table lock to the selected order');
  assert.match(waiterJs, /fulfillment_type[\s\S]*=== fulfillmentType/, 'dine-in and linked parcel carts must remain visually separated');
  assert.match(waiterJs, /Number\(row\.id\) === Number\(itemId\) && !row\.sentToKitchen/, 'adding an already-KOT item must create a new KOT line instead of changing the submitted line');

  console.log('Wi-Fi login regression checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
