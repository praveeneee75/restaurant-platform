const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('saas-backend/src/db/migrate.js');
const subscriptions = read('saas-backend/src/routes/subscriptions.js');
const tenantModules = read('saas-backend/src/routes/tenantModules.js');
const admin = read('saas-backend/public/admin.html');

assert.match(
  migration,
  /\('REMOTE_MENU',\s*'Remote Menu Publishing'/,
  'Remote Menu Publishing must exist in the SaaS module catalog'
);
assert.match(
  migration,
  /\('ENTERPRISE',\s*'REMOTE_MENU'\)/,
  'Remote Menu Publishing must be included in the Enterprise plan'
);
assert.match(
  migration,
  /INSERT INTO tenant_owner_capabilities[\s\S]*'REMOTE_MENU'[\s\S]*FROM tenant_modules/,
  'migration must synchronize the owner capability from the module entitlement'
);
assert.match(
  subscriptions,
  /applyPlanModules[\s\S]*syncOwnerCapabilities\(client,\s*tenantId\)/,
  'assigning or renewing a plan must synchronize owner capabilities'
);
assert.match(
  tenantModules,
  /modules\/enable[\s\S]*syncOwnerCapability\(tenant\.id,\s*module\.code,\s*true\)/,
  'enabling the module must enable owner portal branch publishing'
);
assert.match(
  tenantModules,
  /modules\/disable[\s\S]*syncOwnerCapability\(tenant\.id,\s*module\.code,\s*false\)/,
  'disabling the module must disable owner portal branch publishing'
);
assert.match(admin, /id="planFeatureGrid"/, 'Plan Builder must render the module catalog');
assert.match(admin, /id="moduleTable"/, 'Modules must render the same module catalog');

console.log('Remote menu entitlement regression passed');
