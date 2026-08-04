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
  assert.doesNotMatch(mobile, /CAPTAIN[^\n]+WAITER[^\n]+\]\s*,\s*\n\s*waiter:/, 'captains should not be offered the separate waiter role');

  const posLive = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/pos-live.js'), 'utf8');
  assert.match(posLive, /mobileSessionParams\.get\("mobileRole"\)/, 'generic mobile POS links should restore the authenticated mobile session');

  const waiter = fs.readFileSync(path.join(root, 'pos-app/backend/public/waiter.html'), 'utf8');
  for (const step of ['tables', 'menu', 'order']) {
    assert.match(waiter, new RegExp(`data-waiter-step="${step}"`), `mobile Dine In should provide the ${step} step`);
  }

  console.log('Wi-Fi login regression checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
