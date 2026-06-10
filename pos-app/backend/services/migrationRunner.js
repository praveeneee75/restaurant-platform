const fs = require('fs');
const path = require('path');
const { ensureRestaurantSchema } = require('./schema');

const migrations = [
  {
    id: '001_core_pos_hardening',
    run(db) {
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '002_inventory_management',
    run(db) {
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '003_production_hardening',
    run(db) {
      ensureRestaurantSchema(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    id: '004_inventory_management_module',
    run(db) {
      // The exact inventory module tables are created through the shared SQLite schema helper.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '005_modifiers_combos',
    run(db) {
      // Modifier, combo and order modifier tables are maintained by the shared schema helper.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '006_combo_quantity',
    run(db) {
      // Existing restaurants that already applied 005 need this later combo metadata column.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '007_kds_order_item_timestamps',
    run(db) {
      // KDS item lifecycle timestamps are added without touching the print job flow.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '008_customer_crm_loyalty',
    run(db) {
      // CRM tables, order customer links and loyalty settings are restaurant-local.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '009_delivery_takeaway_orders',
    run(db) {
      // Delivery, takeaway and phone order metadata stays in the restaurant SQLite database.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '010_backup_restore_onedrive_sync',
    run(db) {
      // Backup settings and logs are stored in the restaurant SQLite database.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '011_auto_update_logs',
    run(db) {
      // Update checks and staging downloads are logged locally without changing POS files.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '012_audit_compliance_dashboard',
    run(db) {
      // Audit and compliance dashboards need richer audit fields and local compliance events.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '013_restaurant_settings_center',
    run(db) {
      // Central POS configuration lives in system_config and is safe to seed repeatedly.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '014_staff_attendance_cash_register',
    run(db) {
      // Staff shifts, attendance and cash register controls are restaurant-local POS data.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '015_purchase_ordering_supplier_billing',
    run(db) {
      // Purchase ordering and supplier billing extend the existing inventory purchasing tables.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '016_role_based_access_control',
    run(db) {
      // Role and permission matrix is seeded per restaurant SQLite database.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '017_multi_device_waiter_sync',
    run(db) {
      // Mobile waiter devices use local order locks and device sessions for safe LAN ordering.
      ensureRestaurantSchema(db);
    }
  },
  {
    id: '018_cloud_reporting_sync',
    run(db) {
      // Cloud reporting sync stores only aggregated summaries and retry state locally.
      ensureRestaurantSchema(db);
    }
  }
];

function dbPathForRestaurant(restaurantId) {
  return path.join(__dirname, '../../data', 'restaurant_' + restaurantId.trim() + '.db');
}

function backupDatabase(restaurantId) {
  const source = dbPathForRestaurant(restaurantId);
  if (!fs.existsSync(source)) return null;

  const backupsDir = path.join(__dirname, '../../backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const compact = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  const stamp = compact.slice(0, 8) + '_' + compact.slice(8);
  const backupName = 'restaurant_' + restaurantId.trim() + '_' + stamp + '.db';
  const target = path.join(backupsDir, backupName);
  try {
    fs.copyFileSync(source, target);
    return target;
  } catch (err) {
    console.warn('Database backup skipped:', err.message);
    return null;
  }
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function runMigrations(db, restaurantId) {
  ensureMigrationTable(db);

  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
  const pending = migrations.filter((migration) => !applied.has(migration.id));

  if (pending.length === 0) {
    ensureRestaurantSchema(db);
    return { applied: [], backupPath: null };
  }

  const backupPath = backupDatabase(restaurantId);
  const insertMigration = db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)');

  db.transaction(() => {
    for (const migration of pending) {
      migration.run(db);
      insertMigration.run(migration.id);
    }
  })();

  return { applied: pending.map((migration) => migration.id), backupPath };
}

module.exports = { runMigrations, backupDatabase, dbPathForRestaurant };
