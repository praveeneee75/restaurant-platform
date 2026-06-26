const Database = require('better-sqlite3');
const fs = require('fs-extra');
const { dataDir, restaurantDbPath } = require('../utils/dataPaths');

function openDatabase(restaurantId) {
  if (!restaurantId) {
    throw new Error('restaurantId is required');
  }

  const cleanRestaurantId = restaurantId.trim();
  fs.ensureDirSync(dataDir());

  const dbPath = restaurantDbPath(cleanRestaurantId);

  if (process.env.POS_DB_DEBUG === '1') {
    console.log('OPENING DATABASE:', dbPath);
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  return db;
}

module.exports = { openDatabase };
