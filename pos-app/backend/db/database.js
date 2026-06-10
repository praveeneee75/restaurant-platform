const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');

/**
 * Opens (or creates) a SQLite database for a restaurant
 * Each restaurant gets its own DB file
 */
function openDatabase(restaurantId) {
  if (!restaurantId) {
    throw new Error('restaurantId is required');
  }

  const cleanRestaurantId = restaurantId.trim();

  const dataDir = path.join(__dirname, '../../data');
  fs.ensureDirSync(dataDir);

  // ✅ NO TEMPLATE STRING, NO COPY-PASTE ISSUES
  const dbPath = path.join(
    dataDir,
    'restaurant_' + cleanRestaurantId + '.db'
  );

  console.log('🗄️ OPENING DATABASE:', dbPath);

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  return db;
}


module.exports = { openDatabase };
