const DEFAULT_ROLES = [
  ['OWNER', 'Restaurant owner with full access'],
  ['MANAGER_2', 'Senior manager with financial and operational access'],
  ['MANAGER_1', 'Floor manager with limited reports and operations access'],
  ['CASHIER', 'Cashier with billing access'],
  ['CAPTAIN', 'Captain with floor order and table transfer access'],
  ['WAITER', 'Waiter with order entry access'],
  ['KITCHEN', 'Kitchen display and preparation access']
];

const DEFAULT_PERMISSIONS = [
  ['admin.view', 'View admin dashboard', 'ADMIN'],
  ['admin.menu.manage', 'Manage kitchens, categories, items and tables', 'ADMIN'],
  ['admin.users.manage', 'Manage POS users', 'ADMIN'],
  ['admin.settings.manage', 'Manage restaurant settings and permissions', 'ADMIN'],
  ['orders.create', 'Create and update orders', 'ORDERS'],
  ['orders.cancel', 'Cancel orders', 'ORDERS'],
  ['orders.reopen', 'Reopen orders', 'ORDERS'],
  ['orders.merge', 'Merge orders', 'ORDERS'],
  ['orders.transfer_table', 'Transfer tables', 'ORDERS'],
  ['billing.settle', 'Settle bills', 'BILLING'],
  ['billing.discount', 'Apply discounts', 'BILLING'],
  ['billing.refund', 'Process refunds', 'BILLING'],
  ['billing.void', 'Void bills', 'BILLING'],
  ['billing.non_invoice', 'Create or settle non-invoice sales', 'BILLING'],
  ['reports.view_invoice_only', 'View invoice-only reports', 'REPORTS'],
  ['reports.view_all', 'View all sales and operational reports', 'REPORTS'],
  ['reports.export', 'Export reports and audit CSV', 'REPORTS'],
  ['inventory.view', 'View inventory', 'INVENTORY'],
  ['inventory.manage', 'Manage ingredients, suppliers, stock and recipes', 'INVENTORY'],
  ['inventory.purchase_orders', 'Manage purchase orders and supplier payments', 'INVENTORY'],
  ['kitchen.kds.view', 'View KDS', 'KITCHEN'],
  ['kitchen.status.update', 'Update kitchen item status', 'KITCHEN'],
  ['backup.manage', 'Manage backup, restore and sync', 'SYSTEM'],
  ['audit.view', 'View audit and compliance dashboard', 'SYSTEM'],
  ['tax.export', 'Export tax reports', 'SYSTEM']
];

const DEFAULT_ROLE_PERMISSIONS = {
  OWNER: DEFAULT_PERMISSIONS.map(([code]) => code),
  MANAGER_2: [
    'admin.view',
    'admin.menu.manage',
    'admin.users.manage',
    'admin.settings.manage',
    'orders.create',
    'orders.cancel',
    'orders.reopen',
    'orders.merge',
    'orders.transfer_table',
    'billing.settle',
    'billing.discount',
    'billing.refund',
    'billing.void',
    'billing.non_invoice',
    'reports.view_all',
    'reports.export',
    'inventory.view',
    'inventory.manage',
    'inventory.purchase_orders',
    'kitchen.kds.view',
    'kitchen.status.update',
    'backup.manage',
    'audit.view',
    'tax.export'
  ],
  MANAGER_1: [
    'admin.view',
    'orders.create',
    'billing.settle',
    'billing.non_invoice',
    'orders.reopen',
    'orders.merge',
    'orders.transfer_table',
    'reports.view_invoice_only',
    'inventory.view',
    'kitchen.kds.view',
    'kitchen.status.update'
  ],
  CASHIER: ['orders.create', 'billing.settle', 'inventory.view'],
  CAPTAIN: ['orders.create', 'orders.transfer_table', 'inventory.view'],
  WAITER: ['orders.create'],
  KITCHEN: ['kitchen.kds.view', 'kitchen.status.update']
};

const seededPermissionDbs = new WeakSet();

function ensurePermissionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      module TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      allowed INTEGER DEFAULT 1,
      UNIQUE(role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id),
      FOREIGN KEY (permission_id) REFERENCES permissions(id)
    );
  `);
}

function seedDefaultPermissions(db) {
  if (seededPermissionDbs.has(db)) return;
  ensurePermissionTables(db);
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
  DEFAULT_ROLES.forEach(([name, description]) => insertRole.run(name, description));

  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions (code, description, module) VALUES (?, ?, ?)');
  DEFAULT_PERMISSIONS.forEach(([code, description, module]) => insertPermission.run(code, description, module));

  const roles = db.prepare('SELECT id, name FROM roles').all().reduce((map, row) => ({ ...map, [row.name]: row.id }), {});
  const permissions = db.prepare('SELECT id, code FROM permissions').all().reduce((map, row) => ({ ...map, [row.code]: row.id }), {});
  const upsert = db.prepare(`
    INSERT INTO role_permissions (role_id, permission_id, allowed)
    VALUES (?, ?, ?)
    ON CONFLICT(role_id, permission_id) DO NOTHING
  `);
  Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([role, codes]) => {
    Object.entries(permissions).forEach(([code, permissionId]) => {
      upsert.run(roles[role], permissionId, codes.includes(code) ? 1 : 0);
    });
  });
  // Add newly introduced operational permissions without overwriting owner-customized settings.
  const grantPilotRole = db.prepare(`
    UPDATE role_permissions SET allowed = 1
    WHERE role_id = (SELECT id FROM roles WHERE name = ?)
      AND permission_id IN (SELECT id FROM permissions WHERE code = ?)
  `);
  [['MANAGER_1', 'billing.settle'], ['MANAGER_1', 'billing.non_invoice'], ['CASHIER', 'inventory.view'], ['CAPTAIN', 'inventory.view']]
    .forEach(([role, code]) => grantPilotRole.run(role, code));
  seededPermissionDbs.add(db);
}

function hasPermission(db, role, permissionCode) {
  if (!role || !permissionCode) return false;
  seedDefaultPermissions(db);
  const row = db.prepare(`
    SELECT rp.allowed
    FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.name = ? AND r.active = 1 AND p.code = ? AND p.active = 1
    LIMIT 1
  `).get(role, permissionCode);
  return Number(row?.allowed || 0) === 1;
}

function permissionsForRole(db, role) {
  seedDefaultPermissions(db);
  return db.prepare(`
    SELECT p.code, p.description, p.module, COALESCE(rp.allowed, 0) AS allowed
    FROM permissions p
    LEFT JOIN roles r ON r.name = ?
    LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = r.id
    WHERE p.active = 1
    ORDER BY p.module, p.code
  `).all(role);
}

module.exports = {
  DEFAULT_ROLES,
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  seedDefaultPermissions,
  hasPermission,
  permissionsForRole
};
