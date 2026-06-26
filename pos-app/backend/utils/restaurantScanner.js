const fs = require('fs');
const path = require('path');
const { dataDir } = require('./dataPaths');

function getAllRestaurantIds() {
  const restaurantDataDir = dataDir();

  if (!fs.existsSync(restaurantDataDir)) {
    return [];
  }

  return fs.readdirSync(restaurantDataDir)
    .filter(file => file.startsWith('restaurant_') && file.endsWith('.db'))
    .map(file => {
      const filePath = path.join(restaurantDataDir, file);
      const stats = fs.statSync(filePath);
      return {
        restaurantId: file.replace('restaurant_', '').replace('.db', ''),
        stats
      };
    })
    // Ignore placeholder DBs such as restaurant_null.db and tiny incomplete files.
    .filter(entry => entry.restaurantId && entry.restaurantId !== 'null' && entry.stats.size > 50000)
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
    .map(entry => entry.restaurantId);
}

function getSingleRestaurantId() {
  const restaurants = getAllRestaurantIds();

  if (restaurants.length === 0) {
    return null;
  }

  if (restaurants.length > 1) {
    console.warn('Multiple restaurant DBs detected. Using most recently updated valid DB.');
  }

  return restaurants[0];
}

module.exports = {
  getAllRestaurantIds,
  getSingleRestaurantId
};
