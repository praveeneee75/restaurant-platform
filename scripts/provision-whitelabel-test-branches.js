#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const path = require('path');
function dependency(name) {
  try {
    return require(name);
  } catch (_error) {
    return require(path.join(__dirname, '..', 'saas-backend', 'node_modules', name));
  }
}
dependency('dotenv').config({
  path: process.env.SAAS_ENV_FILE || path.join(__dirname, '..', 'deploy', '.env')
});
const { Pool } = dependency('pg');
const { menu } = require('./load-white-label-pilot-menu');

const sourceCode = String(process.env.WHITELABEL_SOURCE_CODE || 'RESTOWHITELABEL').toUpperCase();
const branchDefinitions = [
  { code: `${sourceCode}B2`, name: 'Food Paradise - Branch 2', slug: 'food-paradise-branch-2' },
  { code: `${sourceCode}B3`, name: 'Food Paradise - Branch 3', slug: 'food-paradise-branch-3' },
  { code: `${sourceCode}B4`, name: 'Food Paradise - Branch 4', slug: 'food-paradise-branch-4' }
];

function token(prefix) {
  return `${prefix}-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
}

function menuPayload(displayName) {
  const categories = Object.keys(menu).map((name, index) => ({ id: index + 1, name }));
  let nextId = 1;
  const items = categories.flatMap((category) =>
    menu[category.name].map(([name, price, isVeg]) => ({
      id: String(nextId++),
      name,
      price,
      category_id: category.id,
      item_code: String(nextId - 1).padStart(4, '0'),
      is_veg: isVeg,
      active: 1,
      online_enabled: 1,
      allow_dine_in: 1,
      allow_parcel: 1,
      allow_party_order: 1,
      online_description: ''
    }))
  );
  return {
    restaurant: { displayName, currency: 'INR' },
    categories,
    items
  };
}

async function main() {
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceResult = await client.query('SELECT * FROM tenants WHERE restaurant_code = $1 FOR UPDATE', [sourceCode]);
    if (!sourceResult.rowCount) throw new Error(`Source tenant ${sourceCode} was not found.`);
    const source = sourceResult.rows[0];

    const ownerResult = await client.query('SELECT owner_user_id FROM restaurant_owners WHERE tenant_id = $1 AND active = true', [source.id]);
    if (!ownerResult.rowCount) throw new Error(`Source tenant ${sourceCode} has no active owner assignment.`);

    let organizationResult = await client.query(`
      SELECT o.id
      FROM organizations o
      JOIN organization_restaurants r ON r.organization_id = o.id
      WHERE r.tenant_id = $1
      LIMIT 1
    `, [source.id]);
    if (!organizationResult.rowCount) {
      organizationResult = await client.query(`
        INSERT INTO organizations (name, legal_name, email, phone)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, ['KMaster White Label Test Group', source.legal_name || source.name, source.email, source.phone]);
      await client.query(`
        INSERT INTO organization_restaurants (organization_id, tenant_id, branch_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (organization_id, tenant_id) DO NOTHING
      `, [organizationResult.rows[0].id, source.id, source.name]);
    }
    const organizationId = organizationResult.rows[0].id;
    const groupResult = await client.query(`
      INSERT INTO branch_groups (organization_id, name, description)
      VALUES ($1, 'Food Paradise Pilot', 'White-label SaaS branches for pilot testing')
      ON CONFLICT (organization_id, name) DO UPDATE SET active = true
      RETURNING id
    `, [organizationId]);
    const branchGroupId = groupResult.rows[0].id;

    const created = [];
    for (const branch of branchDefinitions) {
      const tenantResult = await client.query(`
        INSERT INTO tenants (
          restaurant_code, name, legal_name, gstin, fssai_license_no, sac_code, tax_rate, state_code,
          address_line_1, address_line_2, city, state, country, phone, email, currency, timezone,
          contact_name, contact_email, contact_phone, mobile_pos_url
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (restaurant_code) DO UPDATE SET
          name = EXCLUDED.name, legal_name = EXCLUDED.legal_name, gstin = EXCLUDED.gstin,
          fssai_license_no = EXCLUDED.fssai_license_no, address_line_1 = EXCLUDED.address_line_1,
          address_line_2 = EXCLUDED.address_line_2, city = EXCLUDED.city, state = EXCLUDED.state,
          country = EXCLUDED.country, phone = EXCLUDED.phone, email = EXCLUDED.email,
          currency = EXCLUDED.currency, timezone = EXCLUDED.timezone
        RETURNING id
      `, [
        branch.code, branch.name, source.legal_name, source.gstin, source.fssai_license_no,
        source.sac_code, source.tax_rate, source.state_code, source.address_line_1,
        source.address_line_2, source.city, source.state, source.country, source.phone,
        source.email, source.currency || 'INR', source.timezone || 'Asia/Kolkata',
        source.contact_name, source.contact_email, source.contact_phone, source.mobile_pos_url
      ]);
      const tenantId = tenantResult.rows[0].id;
      let licenseResult = await client.query('SELECT license_key, sync_token FROM licenses WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1', [tenantId]);
      if (!licenseResult.rowCount) {
        licenseResult = await client.query(`
          INSERT INTO licenses (tenant_id, license_key, sync_token, status, expires_at)
          VALUES ($1, $2, $3, 'ACTIVE', NOW() + INTERVAL '2 years')
          RETURNING license_key, sync_token
        `, [tenantId, token('KMASTER-TEST'), crypto.randomUUID()]);
      } else {
        await client.query("UPDATE licenses SET status = 'ACTIVE', expires_at = GREATEST(expires_at, NOW() + INTERVAL '1 year') WHERE tenant_id = $1", [tenantId]);
      }
      for (const owner of ownerResult.rows) {
        await client.query(`
          INSERT INTO restaurant_owners (owner_user_id, tenant_id, active)
          VALUES ($1, $2, true)
          ON CONFLICT (owner_user_id, tenant_id) DO UPDATE SET active = true
        `, [owner.owner_user_id, tenantId]);
      }
      await client.query(`
        INSERT INTO organization_restaurants (organization_id, tenant_id, branch_group_id, branch_name, active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (organization_id, tenant_id) DO UPDATE
        SET branch_group_id = EXCLUDED.branch_group_id, branch_name = EXCLUDED.branch_name, active = true
      `, [organizationId, tenantId, branchGroupId, branch.name]);
      await client.query(`
        INSERT INTO tenant_modules (tenant_id, module_id, enabled, trial_ends_at)
        SELECT $1, module_id, enabled, trial_ends_at FROM tenant_modules WHERE tenant_id = $2
        ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = EXCLUDED.enabled
      `, [tenantId, source.id]);
      await client.query(`
        INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
        SELECT $1, plan_id, 'ACTIVE', CURRENT_DATE, GREATEST(expires_at, CURRENT_DATE + 365)
        FROM subscriptions
        WHERE tenant_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions existing
            WHERE existing.tenant_id = $1 AND existing.status = 'ACTIVE'
          )
        ORDER BY created_at DESC LIMIT 1
      `, [tenantId, source.id]);
      await client.query(`
        INSERT INTO online_storefronts (
          organization_id, tenant_id, slug, display_name, description, active,
          delivery_enabled, takeaway_enabled, min_order_amount, delivery_fee, service_area
        )
        VALUES ($1,$2,$3,$4,'Food Paradise pilot menu',true,true,true,0,0,$5)
        ON CONFLICT (slug) DO UPDATE SET
          organization_id = EXCLUDED.organization_id, tenant_id = EXCLUDED.tenant_id,
          display_name = EXCLUDED.display_name, active = true, updated_at = NOW()
      `, [organizationId, tenantId, branch.slug, branch.name, source.city || 'Chennai']);
      await client.query('INSERT INTO online_menu_snapshots (tenant_id, source, payload) VALUES ($1, $2, $3::jsonb)', [
        tenantId, 'FOOD_PARADISE_PILOT', JSON.stringify(menuPayload(branch.name))
      ]);
      created.push({ ...branch, tenantId, ...licenseResult.rows[0] });
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ success: true, sourceCode, organizationId, branches: created }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
