#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const path = require('path');

function dependency(name) {
  try { return require(name); }
  catch (_error) { return require(path.join(__dirname, '..', 'saas-backend', 'node_modules', name)); }
}

dependency('dotenv').config({ path: process.env.SAAS_ENV_FILE || path.join(__dirname, '..', 'deploy', '.env') });
const { Pool } = dependency('pg');

const sourceCode = String(process.env.WHITELABEL_SOURCE_CODE || 'RESTOWHITELABEL').toUpperCase();
const profile = {
  code: String(process.env.FORTY_FIVE_FEET_RESTAURANT_CODE || `${sourceCode}45FT`).toUpperCase(),
  branchName: '45 Feet Street',
  displayName: 'Food Paradise - 45 Feet Street',
  legalName: 'Food Paradise',
  addressLine1: 'Indian Bank Plot 29, 45 Feet Road',
  addressLine2: 'Kamaraj Nagar',
  city: 'Puducherry',
  state: 'Puducherry',
  stateCode: '34',
  country: 'India',
  phone: '+91 413 221 2116',
  email: 'foodparadaise@gmail.com',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  slug: '45-feet-street'
};

function token() {
  return `KMASTER-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
}

async function main() {
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceResult = await client.query('SELECT * FROM tenants WHERE restaurant_code = $1 FOR UPDATE', [sourceCode]);
    if (!sourceResult.rowCount) throw new Error(`Source white-label tenant ${sourceCode} was not found`);
    const source = sourceResult.rows[0];
    const organizationResult = await client.query('SELECT organization_id FROM organization_restaurants WHERE tenant_id = $1 AND active = true LIMIT 1', [source.id]);
    if (!organizationResult.rowCount) throw new Error(`Source tenant ${sourceCode} is not attached to an organization`);
    const organizationId = organizationResult.rows[0].organization_id;
    const groupResult = await client.query(`
      INSERT INTO branch_groups (organization_id, name, description)
      VALUES ($1, 'Food Paradise Pilot', 'White-label SaaS branches for pilot and production validation')
      ON CONFLICT (organization_id, name) DO UPDATE SET active = true
      RETURNING id
    `, [organizationId]);
    const tenantResult = await client.query(`
      INSERT INTO tenants (
        restaurant_code, name, legal_name, state_code, sac_code, tax_rate,
        address_line_1, address_line_2, city, state, country, phone, email,
        currency, timezone, contact_name, contact_email, contact_phone, mobile_pos_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (restaurant_code) DO UPDATE SET
        name=EXCLUDED.name, legal_name=EXCLUDED.legal_name, state_code=EXCLUDED.state_code,
        address_line_1=EXCLUDED.address_line_1, address_line_2=EXCLUDED.address_line_2,
        city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country,
        phone=EXCLUDED.phone, email=EXCLUDED.email, currency=EXCLUDED.currency,
        timezone=EXCLUDED.timezone, updated_at=NOW()
      RETURNING id
    `, [profile.code, profile.displayName, profile.legalName, profile.stateCode, source.sac_code || '996331', source.tax_rate || 5,
      profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.country, profile.phone, profile.email,
      profile.currency, profile.timezone, source.contact_name, source.contact_email, source.contact_phone, source.mobile_pos_url]);
    const tenantId = tenantResult.rows[0].id;
    await client.query(`INSERT INTO restaurant_owners (owner_user_id, tenant_id, active)
      SELECT owner_user_id, $1, true FROM restaurant_owners WHERE tenant_id=$2 AND active=true
      ON CONFLICT (owner_user_id, tenant_id) DO UPDATE SET active=true`, [tenantId, source.id]);
    await client.query(`INSERT INTO organization_restaurants (organization_id, tenant_id, branch_group_id, branch_name, active)
      VALUES ($1,$2,$3,$4,true) ON CONFLICT (organization_id, tenant_id) DO UPDATE
      SET branch_group_id=EXCLUDED.branch_group_id, branch_name=EXCLUDED.branch_name, active=true`, [organizationId, tenantId, groupResult.rows[0].id, profile.branchName]);
    await client.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled, trial_ends_at)
      SELECT $1,module_id,enabled,trial_ends_at FROM tenant_modules WHERE tenant_id=$2
      ON CONFLICT (tenant_id,module_id) DO UPDATE SET enabled=EXCLUDED.enabled`, [tenantId, source.id]);
    await client.query(`INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
      SELECT $1,plan_id,'ACTIVE',CURRENT_DATE,GREATEST(expires_at,CURRENT_DATE+365) FROM subscriptions
      WHERE tenant_id=$2 AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id=$1 AND status='ACTIVE')
      ORDER BY created_at DESC LIMIT 1`, [tenantId, source.id]);
    const licenseResult = await client.query('SELECT license_key FROM licenses WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1', [tenantId]);
    if (!licenseResult.rowCount) await client.query(`INSERT INTO licenses (tenant_id,license_key,sync_token,status,expires_at)
      VALUES ($1,$2,$3,'ACTIVE',NOW()+INTERVAL '2 years')`, [tenantId, token(), crypto.randomUUID()]);
    else await client.query("UPDATE licenses SET status='ACTIVE', expires_at=GREATEST(expires_at,NOW()+INTERVAL '1 year') WHERE tenant_id=$1", [tenantId]);
    await client.query(`INSERT INTO online_storefronts (organization_id,tenant_id,slug,display_name,description,active,delivery_enabled,takeaway_enabled,min_order_amount,delivery_fee,service_area)
      VALUES ($1,$2,$3,$4,'Food Paradise on 45 Feet Road, Puducherry',true,true,true,0,0,$5)
      ON CONFLICT (slug) DO UPDATE SET organization_id=EXCLUDED.organization_id,tenant_id=EXCLUDED.tenant_id,display_name=EXCLUDED.display_name,
      description=EXCLUDED.description,active=true,service_area=EXCLUDED.service_area,updated_at=NOW()`, [organizationId, tenantId, profile.slug, profile.displayName, profile.city]);
    await client.query(`INSERT INTO online_menu_snapshots (tenant_id,source,payload)
      SELECT $1,'WHITELABEL_45_FEET_STREET',payload FROM online_menu_snapshots WHERE tenant_id=$2 ORDER BY created_at DESC LIMIT 1`, [tenantId, source.id]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ success:true, tenantId, restaurantCode:profile.code, branchName:profile.branchName, profile }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
