const fs = require('fs');
const path = require('path');
const Database = require('../pos-app/node_modules/better-sqlite3');

const databasePath = process.argv[2] || path.join(process.env.APPDATA || '', 'pos-app', 'data', 'restaurant_RESTOWHITELABEL.db');
if (!fs.existsSync(databasePath)) throw new Error(`White Label database not found: ${databasePath}`);

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backupDir = path.join(path.dirname(path.dirname(databasePath)), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `restaurant_RESTOWHITELABEL_before_pilot_menu_${stamp}.db`);
fs.copyFileSync(databasePath, backupPath);

const menu = {
  Biryani: [
    ['Chicken Dum Biryani', 230, 0], ['Mutton Dum Biryani', 360, 0], ['Chicken 65 Biryani', 300, 0], ['Egg Biryani', 210, 0],
    ['Plain Biryani', 190, 1], ['Prawn Biryani', 350, 0], ['Kaadai Biryani', 350, 0], ['Tandoori Chicken Biryani', 350, 0], ['Grilled Chicken Biryani', 350, 0]
  ],
  'Bucket Biryani': [
    ['Chicken Biryani - 4 Person', 900, 0], ['Chicken Biryani - 6 Person', 1350, 0], ['Chicken Biryani - 8 Person', 1800, 0],
    ['Mutton Biryani - 4 Person', 1400, 0], ['Mutton Biryani - 6 Person', 2100, 0], ['Mutton Biryani - 8 Person', 2800, 0],
    ['Chicken 65 - 1 Bird', 900, 0], ['Pepper Chicken - 1 Bird', 900, 0]
  ],
  Soups: [
    ['Veg Clear Soup', 120, 1], ['Mushroom Soup', 120, 1], ['Sweet Corn Veg Soup', 120, 1], ['Hot & Sour Veg Soup', 120, 1], ['Cream of Mushroom Soup', 140, 1],
    ['Chicken Clear Soup', 130, 0], ['Chicken Noodles Soup', 130, 0], ['Sweet Corn Chicken Soup', 130, 0], ['Hot & Sour Chicken Soup', 130, 0], ['Cream of Chicken Soup', 150, 0]
  ],
  Egg: [
    ['Boiled Egg', 20, 0], ['Egg Podimass', 100, 0], ['Egg Onion Fry', 150, 0], ['Cheese Omlette', 110, 0], ['Omlette', 100, 0],
    ['Chilly Egg (D/G)', 200, 0], ['Egg Manchurian (D/G)', 200, 0], ['Egg Masala (G)', 150, 0], ['Egg Butter Masala (G)', 200, 0]
  ],
  Mutton: [
    ['Mutton Sukka - Boneless', 360, 0], ['Mutton Pepper Fry', 360, 0], ['Mutton Liver Fry', 300, 0], ['Mutton Brain Fry', 260, 0],
    ['Mutton Brain Egg Fry', 280, 0], ['Mutton Masala (G)', 360, 0], ['Mutton Pepper Masala (G)', 360, 0], ['Mutton Chettinadu (G)', 360, 0], ['Mutton Paya (G)', 240, 0]
  ],
  Chicken: [
    ['Chicken 65', 200, 0], ['Chicken 65 - Boneless', 280, 0], ['Chicken Lollipop', 240, 0], ['Saucy Chicken Lollipop', 260, 0],
    ['Dragon Chicken', 260, 0], ['Pepper Chicken Fry', 240, 0], ['Chilly Chicken (D/G)', 260, 0], ['Chicken Manchurian (D/G)', 260, 0],
    ['Chicken Masala', 240, 0], ['Pepper Chicken Masala', 250, 0], ['Kadaai Chicken', 250, 0], ['Chicken Chettinadu', 250, 0],
    ['Hyderabadi Chicken', 250, 0], ['Butter Chicken Masala', 300, 0], ['Chicken Tikka Masala', 300, 0]
  ],
  Veg: [
    ['Mushroom Pepper Fry', 240, 1], ['Mushroom 65', 240, 1], ['Paneer 65', 240, 1], ['Gobi 65', 240, 1],
    ['Chilly Mushroom (D/G)', 240, 1], ['Chilly Paneer (D/G)', 240, 1], ['Chilly Gobi (D/G)', 240, 1], ['Mushroom Manchurian (D/G)', 240, 1],
    ['Paneer Manchurian (D/G)', 240, 1], ['Gobi Manchurian (D/G)', 240, 1], ['Paneer Butter Masala Gravy', 240, 1],
    ['Mushroom Masala Gravy', 240, 1], ['Kadaai Paneer Gravy', 240, 1], ['Mix Veg Masala Gravy', 240, 1]
  ],
  Seafoods: [
    ['Nethili 65', 250, 0], ['Fish Finger', 300, 0], ['Fish Fry - Small', 180, 0], ['Fish Fry - Medium', 220, 0], ['Fish Fry - Large', 250, 0],
    ['Prawn Fry', 300, 0], ['Prawn Pepper Fry', 320, 0], ['Prawn Masala (G)', 320, 0], ['Pepper Prawn Masala (G)', 320, 0], ['Prawn Chettinadu (G)', 320, 0]
  ],
  Kaadai: [['Kaadai 65', 200, 0], ['Kaadai Fry', 200, 0], ['Kaadai Masala', 220, 0], ['Kaadai Chettinadu', 220, 0]],
  Rice: [['Ghee Rice', 180, 1], ['Jeera Rice', 180, 1], ['Steam Rice', 100, 1]],
  'Fried Rice': [
    ['Veg Fried Rice', 190, 1], ['Mushroom Fried Rice', 220, 1], ['Paneer Fried Rice', 220, 1], ['Egg Fried Rice', 190, 0],
    ['Chicken Fried Rice', 220, 0], ['Mutton Fried Rice', 340, 0], ['Prawn Fried Rice', 320, 0], ['Non-Veg Mixed Fried Rice', 360, 0]
  ],
  Noodles: [
    ['Veg Noodles', 190, 1], ['Paneer Noodles', 220, 1], ['Mushroom Noodles', 220, 1], ['Egg Noodles', 190, 0],
    ['Chicken Noodles', 220, 0], ['Mutton Noodles', 340, 0], ['Prawn Noodles', 320, 0], ['Non-Veg Mixed Noodles', 360, 0]
  ],
  'Indian Breads': [
    ['Plain Naan', 60, 1], ['Butter Naan', 70, 1], ['Cheese Naan', 100, 1], ['Garlic Naan', 100, 1],
    ['Roti', 50, 1], ['Butter Roti', 60, 1], ['Tandoori Parotta', 60, 1], ['Phulka (1 Nos)', 30, 1]
  ],
  'Parotta & Dosa': [
    ['Parotta (1 Nos)', 30, 1], ['Chapathi (1 Nos)', 50, 1], ['Chilly Parotta', 150, 1], ['Egg Kothu Parotta', 200, 0],
    ['Chicken Kothu Parotta', 240, 0], ['Mutton Kothu Parotta', 300, 0], ['Ceylon Egg Parotta', 200, 0], ['Ceylon Chicken Parotta', 240, 0],
    ['Ceylon Mutton Parotta', 300, 0], ['Plain Dosa', 50, 1], ['Ghee Dosa', 90, 1], ['Kal Dosa', 50, 1], ['Egg Dosa', 70, 0],
    ['Egg Kal Dosa', 70, 0], ['Chicken Curry Dosa', 220, 0], ['Mutton Curry Dosa', 280, 0]
  ],
  'Tandoori & Grills': [
    ['Grilled Chicken - Half', 250, 0], ['Grilled Chicken - Full', 500, 0], ['Tandoori Chicken - Half', 250, 0], ['Tandoori Chicken - Full', 500, 0],
    ['Al-Faham Chicken - Half', 300, 0], ['Al-Faham Chicken - Full', 600, 0], ['Afghani Chicken - Half', 300, 0], ['Afghani Chicken - Full', 600, 0],
    ['Chicken Tikka (6 Pcs)', 300, 0]
  ],
  Juice: [['Arabian Grape Juice', 70, 1], ['Arabian Grape Juice - Mini', 40, 1]]
};

const kitchenForCategory = (name) => name === 'Juice' ? 'Beverage Counter' : ['Indian Breads', 'Parotta & Dosa', 'Tandoori & Grills'].includes(name) ? 'Tandoor' : 'Main Kitchen';
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
const load = db.transaction(() => {
  db.prepare('UPDATE items SET active = 0').run();
  db.prepare('UPDATE categories SET active = 0').run();
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='combos'").get()) db.prepare('UPDATE combos SET active = 0').run();
  const kitchen = db.prepare('SELECT id FROM kitchens WHERE name = ? AND active = 1');
  const insertCategory = db.prepare('INSERT INTO categories (name, kitchen_id, active) VALUES (?, ?, 1)');
  const insertItem = db.prepare('INSERT INTO items (name, category_id, price, is_veg, allow_parcel, active, online_enabled) VALUES (?, ?, ?, ?, 1, 1, 1)');
  let itemCount = 0;
  for (const [categoryName, items] of Object.entries(menu)) {
    const kitchenRow = kitchen.get(kitchenForCategory(categoryName));
    if (!kitchenRow) throw new Error(`Active kitchen missing for ${categoryName}`);
    const categoryId = Number(insertCategory.run(categoryName, kitchenRow.id).lastInsertRowid);
    for (const [name, price, isVeg] of items) {
      insertItem.run(name, categoryId, price, isVeg);
      itemCount += 1;
    }
  }
  return { categories: Object.keys(menu).length, items: itemCount };
});

try {
  const loaded = load();
  const codes = db.prepare("SELECT printf('%04d', id) AS item_code, name FROM items WHERE active = 1 ORDER BY id LIMIT 3").all();
  console.log(JSON.stringify({ success: true, databasePath, backupPath, ...loaded, sampleItemCodes: codes }, null, 2));
} finally {
  db.close();
}
