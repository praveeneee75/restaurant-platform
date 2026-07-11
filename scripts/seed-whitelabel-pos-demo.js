const { setupDatabase } = require('../pos-app/backend/services/dbSetup');
const { openDatabase } = require('../pos-app/backend/db/database');
const { restaurantDbPath } = require('../pos-app/backend/utils/dataPaths');
const {
  WHITELABEL_LICENSE_KEY,
  WHITELABEL_RESTAURANT_ID,
  seedWhitelabelDemoData
} = require('../pos-app/backend/services/whitelabelDemoSeed');

function main() {
  setupDatabase(WHITELABEL_RESTAURANT_ID);
  const db = openDatabase(WHITELABEL_RESTAURANT_ID);
  try {
    const result = seedWhitelabelDemoData(db, {
      restaurantId: WHITELABEL_RESTAURANT_ID,
      licenseKey: WHITELABEL_LICENSE_KEY,
      force: true
    });
    console.log(JSON.stringify({
      success: true,
      restaurantId: WHITELABEL_RESTAURANT_ID,
      licenseKey: WHITELABEL_LICENSE_KEY,
      dbPath: restaurantDbPath(WHITELABEL_RESTAURANT_ID),
      credentials: {
        admin: '123456',
        manager: '111111',
        cashier: '222222',
        captain: '333333',
        waiter: '444444',
        kitchen: '555555'
      },
      counts: result
    }, null, 2));
  } finally {
    db.close();
  }
}

main();
