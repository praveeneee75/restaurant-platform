const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const tenants = read('saas-backend/src/routes/tenants.js');
const partners = read('saas-backend/src/routes/partners.js');
const license = read('saas-backend/src/routes/license.js');
const migration = read('saas-backend/src/db/migrate.js');
const adminHtml = read('saas-backend/public/admin.html');
const adminJs = read('saas-backend/public/js/admin.js');
const pos = read('pos-app/backend/server.js');

const requiredKeys = [
  'legal_name', 'gstin', 'fssai_license_no', 'state_code', 'address_line_1', 'address_line_2',
  'city', 'state', 'country', 'phone', 'email', 'currency', 'timezone'
];
const migratedKeys = requiredKeys.filter((key) => !['country', 'currency'].includes(key));

for (const key of requiredKeys) {
  if (!license.includes(`${key}: row.${key}`)) throw new Error(`License response does not map ${key}`);
  if (!pos.includes(`'${key}'`)) throw new Error(`POS cloud profile allow-list missing ${key}`);
}
for (const key of migratedKeys) {
  if (!migration.includes(`ADD COLUMN IF NOT EXISTS ${key}`)) throw new Error(`Missing tenant migration for ${key}`);
}

for (const source of [tenants, partners]) {
  if (!source.includes('All restaurant profile')) throw new Error('An onboarding API does not enforce the full profile');
  if (!source.includes('15-character GSTIN')) throw new Error('An onboarding API lacks GSTIN validation');
  if (!source.includes('14 digits')) throw new Error('An onboarding API lacks FSSAI validation');
}

if (!adminHtml.includes('Logo path (optional)')) throw new Error('Logo is not identified as optional');
if (!adminJs.includes('restaurantProfile')) {
  // The client sends individual profile fields; this guard ensures the onboarding implementation remains present.
  if (!adminJs.includes('fssaiLicenseNo') || !adminJs.includes('addressLine2') || !adminJs.includes('timezone')) {
    throw new Error('SaaS onboarding client does not send the complete profile');
  }
}
if (!license.includes('restaurantProfile: restaurantProfile(license)')) throw new Error('License validation does not return restaurantProfile');
if ((pos.match(/applyCloudRestaurantProfile\(db, response\.data\)/g) || []).length < 2) {
  throw new Error('POS must apply cloud profile during activation and license refresh');
}

console.log('SaaS onboarding profile regression passed');
