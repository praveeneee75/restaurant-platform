require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');
const { config, requireProductionConfig } = require('../config');

async function migrate() {
  requireProductionConfig();

  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      country TEXT,
      currency TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      license_key TEXT UNIQUE NOT NULL,
      sync_token TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE licenses ADD COLUMN IF NOT EXISTS sync_token TEXT');
  await pool.query("UPDATE licenses SET sync_token = uuid_generate_v4()::text WHERE sync_token IS NULL OR sync_token = ''");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'OWNER',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS releases (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      version TEXT UNIQUE NOT NULL,
      release_notes TEXT,
      mandatory_update BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS release_files (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      release_id UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      checksum TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_daily_reports (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      report_date DATE NOT NULL,
      gross_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
      net_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      refunds_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      orders_count INTEGER NOT NULL DEFAULT 0,
      cash_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      card_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      upi_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, report_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_item_sales (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      report_date DATE NOT NULL,
      item_name TEXT NOT NULL,
      quantity_sold NUMERIC(12,3) NOT NULL DEFAULT 0,
      total_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
      UNIQUE(tenant_id, report_date, item_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_sync_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
      restaurant_code TEXT,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_tenants_restaurant_code ON tenants(restaurant_code)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_licenses_tenant_id ON licenses(tenant_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_licenses_license_key ON licenses(license_key)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_sync_token ON licenses(sync_token)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_releases_status_created ON releases(status, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_release_files_release_id ON release_files(release_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tenant_daily_reports_date ON tenant_daily_reports(tenant_id, report_date)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tenant_item_sales_date ON tenant_item_sales(tenant_id, report_date)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tenant_sync_logs_tenant ON tenant_sync_logs(tenant_id, created_at DESC)');

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const existing = await pool.query('SELECT id FROM admin_users WHERE email = $1', [process.env.ADMIN_EMAIL]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await pool.query(
        'INSERT INTO admin_users (email, password_hash, role) VALUES ($1, $2, $3)',
        [process.env.ADMIN_EMAIL, hash, process.env.ADMIN_ROLE || 'OWNER']
      );
      console.log(`Created admin user ${process.env.ADMIN_EMAIL}`);
    }
  }

  console.log(`SaaS migrations complete for ${config.db.database}`);
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
