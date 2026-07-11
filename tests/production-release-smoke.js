const assert = require('assert');

const baseUrl = process.env.PROD_API_URL || 'https://api.kmasterpos.com';
const restaurantId = process.env.PROD_TEST_RESTAURANT || 'RESTOWHITELABEL';
const licenseKey = process.env.PROD_TEST_LICENSE || 'WLTEST-2026-KMASTER';
const ownerEmail = process.env.PROD_TEST_OWNER_EMAIL || 'qa.restaurant@kmasterpos.com';
const ownerPassword = process.env.PROD_TEST_OWNER_PASSWORD || 'KMasterTest!2026';
const expectedPosVersion = process.env.EXPECTED_POS_VERSION;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return { response, body };
}

async function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

(async () => {
  const health = await request('/health');
  assert.strictEqual(health.body.success, true, 'production health failed');
  assert.strictEqual(health.body.database.status, 'OK', 'production database is not OK');

  const license = await postJson('/license/validate', { restaurantId, licenseKey });
  assert.strictEqual(license.body.valid, true, 'test license did not validate');
  assert(license.body.enabledModules.includes('WHITE_LABEL'), 'test restaurant is missing WHITE_LABEL module');
  assert(license.body.enabledModules.includes('MOBILE_APP'), 'test restaurant is missing MOBILE_APP module');

  const ownerLogin = await postJson('/license/owner-pos-login', {
    restaurantId,
    email: ownerEmail,
    password: ownerPassword
  });
  assert.strictEqual(ownerLogin.body.success, true, 'owner cloud POS login failed');
  assert.strictEqual(ownerLogin.body.user.role, 'OWNER', 'owner cloud POS login did not return OWNER role');

  const mobileDirectory = await request('/mobile/restaurants');
  assert(mobileDirectory.body.restaurants.some((restaurant) => restaurant.restaurantId === restaurantId), 'test restaurant missing from mobile directory');

  const latest = await request('/updates/latest');
  assert.strictEqual(latest.body.success, true, 'latest update endpoint failed');
  if (expectedPosVersion) assert.strictEqual(latest.body.version, expectedPosVersion, 'latest POS version mismatch');
  assert(latest.body.files?.[0]?.file_name, 'latest update is missing installer file metadata');
  assert(latest.body.checksum, 'latest update is missing checksum');

  const installers = await request('/updates/installers');
  assert.strictEqual(installers.body.success, true, 'installer manifest failed');
  const windows = installers.body.platforms.find((platform) => platform.key === 'windows');
  assert(windows?.available, 'Windows installer is not available');
  if (expectedPosVersion) assert(windows.fileName.includes(expectedPosVersion), 'Windows installer does not match expected POS version');

  const installerHead = await fetch(`${baseUrl}${windows.fileUrl}`, { method: 'HEAD' });
  assert.strictEqual(installerHead.status, 200, 'Windows installer HEAD failed');
  assert(Number(installerHead.headers.get('content-length') || 0) > 1000000, 'Windows installer content length is too small');

  console.log(JSON.stringify({
    success: true,
    baseUrl,
    restaurantId,
    latestVersion: latest.body.version,
    installer: windows.fileName
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
