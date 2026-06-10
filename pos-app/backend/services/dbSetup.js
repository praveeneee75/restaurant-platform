const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { openDatabase } = require('../db/database');
const { runMigrations } = require('./migrationRunner');

function setupDatabase(restaurantId) {
  const db = openDatabase(restaurantId);

  const exists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='db_meta'"
    )
    .get();

  if (exists) {
    // Existing restaurant databases are backed up and migrated automatically.
    runMigrations(db, restaurantId);
    console.log('✅ Database already initialized');
    db.close();
    return;
  }

  console.log('🛠 Initializing database schema...');

  const initSql = fs.readFileSync(
    path.join(__dirname, '../db/init.sql'),
    'utf8'
  );
  db.exec(initSql);
  runMigrations(db, restaurantId);

  // 👉 Create default OWNER user
  db.prepare(`
    INSERT INTO users (name, username, pin, pin_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Administrator',
    'admin',
    '',
    bcrypt.hashSync('1234', 10),
    'OWNER'
  );

  console.log('👤 Default OWNER user created (admin / 1234)');
  db.close();
}

module.exports = { setupDatabase };
