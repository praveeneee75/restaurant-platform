const path = require('path');

function appDataRoot() {
  if (process.env.POS_DATA_DIR) return path.resolve(process.env.POS_DATA_DIR);
  if (process.env.POS_DESKTOP === '1') {
    return path.join(process.env.APPDATA || process.cwd(), 'pos-app');
  }
  return path.join(__dirname, '..', '..');
}

function dataDir() {
  return path.join(appDataRoot(), 'data');
}

function backupsDir() {
  return path.join(appDataRoot(), 'backups');
}

function restaurantDbPath(restaurantId) {
  return path.join(dataDir(), 'restaurant_' + String(restaurantId || '').trim() + '.db');
}

module.exports = {
  appDataRoot,
  dataDir,
  backupsDir,
  restaurantDbPath
};
