const fs = require('fs');
const path = require('path');

function getAllRestaurantIds() {
  const dataDir = path.join(__dirname, '../../data');

  if (!fs.existsSync(dataDir)) {
    return [];
  }

  const files = fs.readdirSync(dataDir);

  const restaurantFiles = files.filter(file =>
    file.startsWith('restaurant_') && file.endsWith('.db')
  );

  const restaurantIds = restaurantFiles.map(file =>
    file.replace('restaurant_', '').replace('.db', '')
  );

  return restaurantIds;
}

function getSingleRestaurantId() {
  const restaurants = getAllRestaurantIds();

  if (restaurants.length === 0) {
    return null;
  }

  if (restaurants.length > 1) {
    console.warn('⚠ Multiple restaurant DBs detected. Using first one.');
  }

  return restaurants[0];
}

module.exports = {
  getAllRestaurantIds,
  getSingleRestaurantId
};