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
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mobile_pos_url TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_name TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_name TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gstin TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fssai_license_no TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS state_code TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_line_1 TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_line_2 TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS state TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT');
  await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_path TEXT');

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS owner_users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      reset_required BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash TEXT PRIMARY KEY,
      revoked_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurant_owners (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      owner_user_id UUID NOT NULL REFERENCES owner_users(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(owner_user_id, tenant_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_inquiries (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      business_name TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT,
      outlet_count INTEGER NOT NULL DEFAULT 1,
      message TEXT,
      source TEXT NOT NULL DEFAULT 'WEBSITE',
      status TEXT NOT NULL DEFAULT 'NEW',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plan_id UUID NOT NULL REFERENCES subscription_plans(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      starts_at DATE NOT NULL DEFAULT CURRENT_DATE,
      expires_at DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_payments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_mode TEXT,
      reference_no TEXT,
      paid_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_heartbeats (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
      restaurant_code TEXT NOT NULL,
      pos_version TEXT,
      backup_status TEXT,
      printer_status TEXT,
      license_status TEXT,
      app_status TEXT,
      payload JSONB,
      last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(restaurant_code)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partners (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      business_name TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'PARTNER_ADMIN',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_branding (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id UUID NOT NULL UNIQUE REFERENCES partners(id) ON DELETE CASCADE,
      brand_name TEXT,
      logo_url TEXT,
      primary_color TEXT,
      secondary_color TEXT,
      support_email TEXT,
      support_phone TEXT,
      custom_domain TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_restaurants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      restaurant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(partner_id, restaurant_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
      restaurant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
      revenue_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payout_status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_commissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
      restaurant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
      revenue_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payout_status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_payouts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      reference_no TEXT,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saas_audit_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      actor_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      old_value JSONB,
      new_value JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS modules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_modules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT true,
      trial_ends_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ DEFAULT NOW(),
      deactivated_at TIMESTAMPTZ,
      UNIQUE(tenant_id, module_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS module_pricing (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY',
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      UNIQUE(module_id, billing_cycle, currency)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_plan_modules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
      module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      included BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(plan_id, module_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS module_usage_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      module_code TEXT NOT NULL,
      usage_type TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_messaging_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'SMPP',
      provider_account_name TEXT,
      sender_id TEXT,
      sms_enabled BOOLEAN NOT NULL DEFAULT true,
      whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
      email_enabled BOOLEAN NOT NULL DEFAULT false,
      smpp_host TEXT,
      smpp_port INTEGER,
      smpp_system_id TEXT,
      smpp_password TEXT,
      api_base_url TEXT,
      api_key TEXT,
      whatsapp_business_id TEXT,
      email_from_name TEXT,
      email_from_address TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      UNIQUE(tenant_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messaging_campaigns (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'ALL_CUSTOMERS',
      campaign_name TEXT NOT NULL,
      message_body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      recipients_estimate INTEGER NOT NULL DEFAULT 0,
      scheduled_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messaging_delivery_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      campaign_id UUID NOT NULL REFERENCES messaging_campaigns(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      recipient_name TEXT,
      recipient_phone TEXT,
      recipient_email TEXT,
      channel TEXT NOT NULL,
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_allowed_modules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      allowed BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(partner_id, module_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      legal_name TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ORG_OWNER',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_groups (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(organization_id, name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_restaurants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      branch_group_id UUID REFERENCES branch_groups(id) ON DELETE SET NULL,
      branch_name TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(organization_id, tenant_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_storefronts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      delivery_enabled BOOLEAN NOT NULL DEFAULT true,
      takeaway_enabled BOOLEAN NOT NULL DEFAULT true,
      min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      service_area TEXT,
      opening_time TEXT,
      closing_time TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_menu_snapshots (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'POS',
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      storefront_id UUID REFERENCES online_storefronts(id) ON DELETE SET NULL,
      order_no TEXT UNIQUE NOT NULL,
      order_type TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      delivery_address TEXT,
      payment_mode TEXT NOT NULL DEFAULT 'COD',
      payment_status TEXT NOT NULL DEFAULT 'UNPAID',
      order_status TEXT NOT NULL DEFAULT 'PLACED',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT,
      pos_pulled_at TIMESTAMPTZ,
      pos_order_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);
  await pool.query('ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS table_id TEXT');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_order_items (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      online_order_id UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
      item_id TEXT,
      item_name TEXT NOT NULL,
      quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT
    )
  `);

  const demoTenant = await pool.query("SELECT id FROM tenants WHERE restaurant_code = 'RESTOWHITELABEL' LIMIT 1");
  if (demoTenant.rowCount) {
    const demoTenantId = demoTenant.rows[0].id;
    await pool.query(`
      INSERT INTO online_storefronts (tenant_id, slug, display_name, description, active, delivery_enabled, takeaway_enabled, min_order_amount, delivery_fee, service_area)
      VALUES ($1, 'kmaster-whitelabel-demo', 'KMaster White Label Demo Restaurant', 'Demo online ordering storefront', true, true, true, 0, 0, 'Chennai')
      ON CONFLICT(slug) DO UPDATE SET active = true, display_name = EXCLUDED.display_name, updated_at = NOW()
    `, [demoTenantId]);
    const demoSnapshot = await pool.query('SELECT 1 FROM online_menu_snapshots WHERE tenant_id = $1 LIMIT 1', [demoTenantId]);
    if (!demoSnapshot.rowCount) {
      const demoItems = [
        ['1', 'Idli Sambar', 55, 1], ['2', 'Masala Dosa', 95, 1], ['3', 'Ghee Pongal', 85, 1],
        ['4', 'Paneer Tikka', 190, 2], ['5', 'Chicken 65', 180, 2], ['6', 'Veg Biryani', 160, 3],
        ['7', 'Chicken Biryani', 220, 3], ['8', 'South Indian Veg Meals', 145, 4],
        ['9', 'Butter Naan', 55, 5], ['10', 'Chapati', 35, 5], ['11', 'Filter Coffee', 35, 6],
        ['12', 'Fresh Lime Soda', 60, 6], ['13', 'Gulab Jamun', 70, 7]
      ].map(([id, name, price, category_id]) => ({ id, name, price, category_id, online_description: '' }));
      await pool.query('INSERT INTO online_menu_snapshots (tenant_id, source, payload) VALUES ($1, $2, $3::jsonb)', [demoTenantId, 'DEMO_SEED', JSON.stringify({
        restaurant: { displayName: 'KMaster White Label Demo Restaurant', currency: 'INR' },
        categories: [
          { id: 1, name: 'Breakfast' }, { id: 2, name: 'Starters' }, { id: 3, name: 'Biryanis' },
          { id: 4, name: 'Meals' }, { id: 5, name: 'Breads' }, { id: 6, name: 'Beverages' }, { id: 7, name: 'Desserts' }
        ],
        items: demoItems
      })]);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_notes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      restaurant_code TEXT,
      note TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO subscription_plans (code, name, duration_days, price)
    VALUES
      ('TRIAL', 'Trial', 14, 0),
      ('BASIC', 'Basic POS', 365, 0),
      ('STANDARD', 'Standard POS', 365, 0),
      ('PREMIUM', 'Premium POS', 365, 0),
      ('ENTERPRISE', 'Enterprise POS', 365, 0),
      ('MONTHLY', 'Monthly', 30, 0),
      ('QUARTERLY', 'Quarterly', 90, 0),
      ('YEARLY', 'Yearly', 365, 0)
    ON CONFLICT(code) DO UPDATE SET
      name = EXCLUDED.name,
      duration_days = EXCLUDED.duration_days,
      active = true
  `);

  await pool.query(`
    INSERT INTO modules (code, name, description, category, status)
    VALUES
      ('INVENTORY', 'Inventory Management', 'Ingredients, suppliers, stock movements and recipe mapping', 'OPERATIONS', 'ACTIVE'),
      ('KDS', 'Kitchen Display System', 'Kitchen display order preparation screens', 'OPERATIONS', 'ACTIVE'),
      ('LOYALTY', 'Customer CRM & Loyalty', 'Customer profiles, visits and loyalty points', 'CUSTOMER', 'ACTIVE'),
      ('QR_ORDERING', 'QR Ordering', 'Customer self-ordering through table QR links', 'SALES', 'ACTIVE'),
      ('RESERVATIONS', 'Reservations', 'Table reservation management', 'SALES', 'ACTIVE'),
      ('CLOUD_REPORTING', 'Cloud Reporting', 'Owner remote summary reporting sync', 'REPORTING', 'ACTIVE'),
      ('MULTI_BRANCH', 'Multi Branch', 'Franchise and multi-location management placeholder', 'ENTERPRISE', 'ACTIVE'),
      ('WHITE_LABEL', 'White Label', 'Partner branding and reseller management', 'ENTERPRISE', 'ACTIVE'),
      ('ONLINE_ORDERING', 'Online Ordering', 'Customer web ordering for takeaway, delivery and prepaid/cash orders', 'SALES', 'ACTIVE'),
      ('MOBILE_APP', 'White-label Mobile App', 'Cross-platform owner, captain and waiter mobile app packaging', 'PREMIUM', 'ACTIVE'),
      ('MESSAGING', 'SMS / WhatsApp / Email Marketing', 'Bulk customer communication with per-restaurant sender and gateway configuration', 'CUSTOMER', 'ACTIVE')
    ON CONFLICT(code) DO NOTHING
  `);
  await pool.query(`
    UPDATE subscription_plans SET price = CASE code
      WHEN 'BASIC' THEN 2399
      WHEN 'STANDARD' THEN 5999
      WHEN 'PREMIUM' THEN 11999
      ELSE price
    END
    WHERE code IN ('BASIC', 'STANDARD', 'PREMIUM')
  `);

  await pool.query(`
    INSERT INTO module_pricing (module_id, billing_cycle, price, currency)
    SELECT id, 'MONTHLY', 0, 'INR' FROM modules
    ON CONFLICT(module_id, billing_cycle, currency) DO NOTHING
  `);

  await pool.query(`
    WITH plan_modules(plan_code, module_code) AS (
      VALUES
        ('BASIC', 'KDS'),
        ('STANDARD', 'KDS'),
        ('STANDARD', 'INVENTORY'),
        ('STANDARD', 'LOYALTY'),
        ('PREMIUM', 'KDS'),
        ('PREMIUM', 'INVENTORY'),
        ('PREMIUM', 'LOYALTY'),
        ('PREMIUM', 'QR_ORDERING'),
        ('PREMIUM', 'RESERVATIONS'),
        ('PREMIUM', 'CLOUD_REPORTING'),
        ('PREMIUM', 'ONLINE_ORDERING'),
        ('PREMIUM', 'MOBILE_APP'),
        ('PREMIUM', 'MESSAGING'),
        ('ENTERPRISE', 'KDS'),
        ('ENTERPRISE', 'INVENTORY'),
        ('ENTERPRISE', 'LOYALTY'),
        ('ENTERPRISE', 'QR_ORDERING'),
        ('ENTERPRISE', 'RESERVATIONS'),
        ('ENTERPRISE', 'CLOUD_REPORTING'),
        ('ENTERPRISE', 'ONLINE_ORDERING'),
        ('ENTERPRISE', 'MOBILE_APP'),
        ('ENTERPRISE', 'MESSAGING'),
        ('ENTERPRISE', 'MULTI_BRANCH'),
        ('ENTERPRISE', 'WHITE_LABEL')
    )
    INSERT INTO subscription_plan_modules (plan_id, module_id, included)
    SELECT p.id, m.id, true
    FROM plan_modules pm
    JOIN subscription_plans p ON p.code = pm.plan_code
    JOIN modules m ON m.code = pm.module_code
    ON CONFLICT(plan_id, module_id) DO UPDATE SET included = true
  `);

  await pool.query(`
    INSERT INTO tenant_modules (tenant_id, module_id, enabled, activated_at)
    SELECT t.id, spm.module_id, true, NOW()
    FROM tenants t
    JOIN LATERAL (
      SELECT s.plan_id
      FROM subscriptions s
      WHERE s.tenant_id = t.id AND s.status = 'ACTIVE'
      ORDER BY s.created_at DESC
      LIMIT 1
    ) s ON true
    JOIN subscription_plan_modules spm ON spm.plan_id = s.plan_id AND spm.included = true
    ON CONFLICT(tenant_id, module_id) DO NOTHING
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
  await pool.query('CREATE INDEX IF NOT EXISTS idx_restaurant_owners_owner ON restaurant_owners(owner_user_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id, status, expires_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_subscription_payments_tenant ON subscription_payments(tenant_id, paid_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pos_heartbeats_time ON pos_heartbeats(last_heartbeat_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_partner_users_partner ON partner_users(partner_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_partner_restaurants_partner ON partner_restaurants(partner_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_partner_restaurants_restaurant ON partner_restaurants(restaurant_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner ON partner_commissions(partner_id, payout_status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON partner_payouts(partner_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_saas_audit_logs_entity ON saas_audit_logs(entity_type, entity_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_modules_code ON modules(code)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tenant_modules_tenant ON tenant_modules(tenant_id, enabled)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_module_usage_tenant ON module_usage_logs(tenant_id, module_code, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_tenant_messaging_accounts_tenant ON tenant_messaging_accounts(tenant_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_messaging_campaigns_tenant ON messaging_campaigns(tenant_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_messaging_delivery_logs_campaign ON messaging_delivery_logs(campaign_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_partner_allowed_modules_partner ON partner_allowed_modules(partner_id, allowed)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_organization_users_org ON organization_users(organization_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_organization_restaurants_org ON organization_restaurants(organization_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_organization_restaurants_tenant ON organization_restaurants(tenant_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_branch_groups_org ON branch_groups(organization_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_subscription_plan_modules_plan ON subscription_plan_modules(plan_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_online_storefronts_tenant ON online_storefronts(tenant_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_online_menu_snapshots_tenant ON online_menu_snapshots(tenant_id, synced_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_online_orders_tenant_status ON online_orders(tenant_id, order_status, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_online_orders_org_created ON online_orders(organization_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_support_notes_restaurant ON support_notes(restaurant_code, created_at DESC)');

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
