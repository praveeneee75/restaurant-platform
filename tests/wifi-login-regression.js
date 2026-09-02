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
  const mobileHtml = fs.readFileSync(path.join(root, 'mobile-app/www/index.html'), 'utf8');
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
  const waiterCss = fs.readFileSync(path.join(root, 'pos-app/backend/public/css/waiter.css'), 'utf8');
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
  assert.match(waiterCss, /\.check-panel\.mobile-active \.check-bottom-actions \{ position:fixed;[\s\S]*bottom:0/, 'mobile Check actions must remain anchored to the bottom safe area');
  assert.match(waiterCss, /\[data-waiter-panel="menu"\]\.mobile-active \.mobile-bottom-action \{ position:fixed;[\s\S]*bottom:0/, 'mobile Items review action must remain anchored to the bottom safe area');
  assert.match(waiter, /class="review-bottom-actions"[\s\S]*class="actions review-icon-actions"/, 'mobile Review must group order actions into one bottom icon control area');
  assert.match(waiter, /id="orderTransferDialog"[\s\S]*data-transfer-mode="TABLE"[\s\S]*data-transfer-mode="KOT"[\s\S]*data-transfer-mode="ITEM"/, 'mobile Review transfer action must open the table, KOT and item transfer dialog');
  assert.match(waiterCss, /\.cart-panel\.mobile-active \.review-bottom-actions \{ position:fixed;[\s\S]*bottom:0/, 'mobile Review transfer and order actions must remain anchored to the bottom safe area');
  assert.match(waiterCss, /\.customer-controls \{ grid-template-columns:minmax\(0,1fr\) auto; align-items:end; \}/, 'mobile Review customer fields and action buttons must share aligned rows');
  assert.match(waiterJs, /parcelWaiterCheck\.hidden = !state\.selectedTable \|\| state\.fulfillmentType !== "DINE_IN"/, 'captain parcel must be available for a selected table even when its earlier customer check is final-bill locked');
  assert.match(waiterJs, /if \(!state\.orderId \|\| state\.billingReady\) \{[\s\S]*state\.orderId = null;[\s\S]*state\.billingReady = false;/, 'captain parcel must start an independent check instead of inheriting a final-bill lock');
  assert.match(waiterJs, /const user = userFromMobileParams\(\) \|\| JSON\.parse/, 'the current authenticated mobile session must override stale waiter-page storage');
  assert.match(waiterJs, /waiterOrderSelectorLabel\.hidden = state\.openOrders\.length <= 1/, 'the customer-check dropdown must only appear when multiple checks require a choice');
  assert.match(waiterJs, /state\.openOrders\.length === 1[\s\S]*loadWaiterOrder\(onlyOrderId\)/, 'a single existing customer check must be selected automatically');
  assert.match(waiterJs, /await returnToTables\(\)/, 'successful KOT and final-check actions must return the Captain to Tables');
  assert.doesNotMatch(waiter, /unlockWaiterTable/, 'manual table unlock must not be exposed in the Captain workflow');
  assert.match(mobile, /if \(!state\.user\?\.cloudOwner\) return/, 'POS users must be blocked from mobile owner pages');
  assert.match(waiterJs, /function taxInclusiveUnitPrice/, 'mobile Dine In must display tax-inclusive item prices');
  assert.match(waiterJs, /waiterItemSearch\.addEventListener\("input", renderItems\)/, 'mobile menu must support item search');
  assert.match(waiterJs, /forcePin: true/, 'mobile order cancellation must always request approval PIN validation');
  assert.match(mobile, /function staffPosOfflineMessage/, 'mobile app must provide a visible desktop-POS-offline validation message');
  assert.match(mobile, /await validateStaffPosConnection\(remembered\)/, 'saved staff sessions must validate the desktop POS before hiding login');
  assert.match(mobile, /if \(!state\.user\?\.cloudOwner\) showLoginView\(message\)/, 'workspace connection failures must return staff to a visible error state');
  assert.match(mobile, /retryPosConnection\.addEventListener/, 'offline validation state must provide an operational retry action');
  assert.match(mobileHtml, /id="posOfflineActions"[\s\S]*id="loginBiometricSettings"[\s\S]*id="retryPosConnection"[\s\S]*id="offlineLogoutButton"/, 'offline state must expose biometric, retry and sign-out actions in one group');
  assert.match(mobile, /showLoginView\(staffPosOfflineMessage\(err\), \{ loginAttempt: true \}\)/, 'an explicit failed login must display the detailed POS connection error');
  assert.match(mobile, /showLoginView\("POS is Offline"\)/, 'background saved-session validation must show only the concise offline state');
  assert.match(mobileHtml, /id="wifiInterruptionScreen"[\s\S]*id="refreshWifiConnection"/, 'active staff workspaces must provide a Wi-Fi interruption screen with refresh');
  assert.match(mobile, /setInterval\(\(\) => checkActiveStaffConnection\(\), 5000\)/, 'active staff workspaces must continuously validate POS reachability');
  assert.match(mobile, /wifiInterruptionScreen\.hidden = true[\s\S]*dispatchEvent\(new Event\("online"\)\)/, 'successful reconnection must reveal and resume the preserved workspace');
  assert.doesNotMatch(mobile, /refreshWifiConnection[\s\S]{0,300}appFrame\.src\s*=/, 'Wi-Fi refresh must not replace the preserved POS page');

  console.log('Wi-Fi login regression checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
