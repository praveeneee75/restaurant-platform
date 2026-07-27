const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const seedPath = path.join(root, 'pos-app', 'backend', 'services', 'whitelabelDemoSeed.js');
const menuPath = path.join(root, 'pos-app', 'backend', 'services', 'foodParadiseMenu.js');
const serverPath = path.join(root, 'pos-app', 'backend', 'server.js');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'bcrypt') return { hashSync: () => 'test-hash' };
  return originalLoad.call(this, request, parent, isMain);
};

let seedModule;
try {
  delete require.cache[require.resolve(seedPath)];
  seedModule = require(seedPath);
} finally {
  Module._load = originalLoad;
}

const { menu } = require(menuPath);
const seedSource = fs.readFileSync(seedPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const categoryCount = Object.keys(menu).length;
const itemCount = Object.values(menu).reduce((sum, items) => sum + items.length, 0);

assert(seedModule.isWhitelabelDemo('RESTOWHITELABEL'), 'main white-label restaurant must be recognized');
assert(seedModule.isWhitelabelDemo('RESTOWHITELABELB2'), 'branch 2 must be recognized');
assert(seedModule.isWhitelabelDemo('restowhitelabelb4'), 'branch matching must be case-insensitive');
assert(!seedModule.isWhitelabelDemo('UNRELATEDRESTAURANT'), 'unrelated restaurants must not receive pilot data');

assert(categoryCount >= 15, `expected the Food Paradise category set, received ${categoryCount}`);
assert(itemCount >= 100, `expected the Food Paradise menu, received ${itemCount} items`);
assert(menu.Biryani.some(([name]) => name === 'Chicken Dum Biryani'), 'Food Paradise biryani data is missing');
assert(menu.Juice.some(([name]) => name === 'Arabian Grape Juice'), 'Food Paradise juice data is missing');

for (const requiredTable of ['Table 1', 'Parcel', 'Delivery', 'Parcel Counter']) {
  assert(seedSource.includes(`'${requiredTable}'`), `default table ${requiredTable} is missing`);
}
for (const requiredPrinter of ['Bill Counter Printer', 'Kitchen KOT Printer']) {
  assert(seedSource.includes(requiredPrinter), `default printer ${requiredPrinter} is missing`);
}
assert(seedSource.includes('FOOD_PARADISE_MENU'), 'activation seed must use the shared Food Paradise menu');
assert(seedSource.includes("allow_dine_in: 1"), 'Dine In availability must be seeded');
assert(seedSource.includes("allow_parcel: 1"), 'Parcel availability must be seeded');
assert(seedSource.includes("allow_party_order: 1"), 'Party Order availability must be seeded');
assert(
  serverSource.includes('seedWhitelabelDemoData(db, {') && serverSource.includes('isWhitelabelDemo(restaurantId, licenseKey)'),
  'license activation must invoke the white-label bootstrap'
);

console.log(JSON.stringify({
  success: true,
  branchesCovered: ['RESTOWHITELABEL', 'RESTOWHITELABELB2', 'RESTOWHITELABELB4'],
  categoryCount,
  itemCount,
  defaults: { printers: 2, tables: 11 }
}, null, 2));
