const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/db');
const { config, publicError } = require('../config');

const WHITELABEL_RESTAURANT_ID = 'RESTOWHITELABEL';
const WHITELABEL_LICENSE_KEY = 'WLTEST-2026-KMASTER';

const router = express.Router();

function restaurantProfile(row) {
  return {
    restaurant_display_name: row.restaurant_name,
    legal_name: row.legal_name || '',
    gstin: row.gstin || '',
    fssai_license_no: row.fssai_license_no || '',
    sac_code: row.sac_code || '996331',
    tax_rate: row.tax_rate ?? '5',
    state_code: row.state_code || '',
    address_line_1: row.address_line_1 || '',
    address_line_2: row.address_line_2 || '',
    city: row.city || '',
    state: row.state || '',
    country: row.country || '',
    phone: row.phone || '',
    email: row.email || '',
    currency: row.currency || '',
    timezone: row.timezone || '',
    logo_path: row.logo_path || ''
  };
}

router.post('/validate', async (req, res) => {
  const { restaurantId, licenseKey } = req.body;
  const normalizedRestaurantId = String(restaurantId || '').trim().toUpperCase();
  const normalizedLicenseKey = String(licenseKey || '').trim().toUpperCase();

  if (!restaurantId || !licenseKey) {
    return res.status(400).json({
      valid: false,
      message: 'Missing fields'
    });
  }

  try {
    if (normalizedRestaurantId === WHITELABEL_RESTAURANT_ID && normalizedLicenseKey === WHITELABEL_LICENSE_KEY) {
      const release = await pool.query(`
        SELECT version, release_notes, mandatory_update
        FROM releases
        WHERE status = 'ACTIVE'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return res.json({
        valid: true,
        restaurantName: 'KMaster White Label Demo Restaurant',
        restaurantProfile: {
          restaurant_display_name: 'KMaster White Label Demo Restaurant', legal_name: 'KMaster Demo Foods',
          gstin: '33ABCDE1234F1Z5', fssai_license_no: '12345678901234', sac_code: '996331', tax_rate: '5', state_code: '33',
          address_line_1: 'Demo High Street', address_line_2: 'Near Central Bus Stand', city: 'Chennai',
          state: 'Tamil Nadu', country: 'India', phone: '+91 98765 43210', email: 'demo@kmasterpos.com',
          currency: 'INR', timezone: 'Asia/Kolkata', logo_path: ''
        },
        expiresAt: new Date(Date.now() + (3650 * 24 * 60 * 60 * 1000)).toISOString(),
        syncToken: null,
        packageCode: 'WHITE_LABEL_DEMO',
        packageName: 'White Label Demo',
        enabledModules: ['INVENTORY', 'KDS', 'LOYALTY', 'QR_ORDERING', 'RESERVATIONS', 'CLOUD_REPORTING', 'MULTI_BRANCH', 'WHITE_LABEL', 'ONLINE_ORDERING', 'MOBILE_APP'],
        updatePolicy: release.rowCount === 0 ? null : {
          latestVersion: release.rows[0].version,
          minimumVersion: release.rows[0].mandatory_update ? release.rows[0].version : null,
          mandatory: release.rows[0].mandatory_update,
          releaseNotes: release.rows[0].release_notes || ''
        }
      });
    }

    const result = await pool.query(
      `
      SELECT l.status, l.expires_at, l.sync_token,
             t.id AS tenant_id, t.name AS restaurant_name, t.legal_name, t.gstin,
             t.fssai_license_no, t.sac_code, t.tax_rate, t.state_code, t.address_line_1, t.address_line_2,
             t.city, t.state, t.country, t.phone, t.email, t.currency, t.timezone, t.logo_path,
             p.code AS package_code, p.name AS package_name
      FROM licenses l
      JOIN tenants t ON t.id = l.tenant_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM subscriptions
        WHERE tenant_id = t.id
        ORDER BY created_at DESC
        LIMIT 1
      ) s ON true
      LEFT JOIN subscription_plans p ON p.id = s.plan_id
      WHERE t.restaurant_code = $1
      AND l.license_key = $2
      `,
      [restaurantId, licenseKey]
    );

    if (result.rowCount === 0) {
      return res.json({ valid: false });
    }

    const license = result.rows[0];

    if (license.status !== 'ACTIVE' || new Date(license.expires_at).getTime() <= Date.now()) {
      return res.json({
        valid: false,
        message: license.status !== 'ACTIVE' ? 'License is inactive' : 'License has expired',
        expiresAt: license.expires_at
      });
    }

    const modules = await pool.query(`
      SELECT m.code
      FROM tenant_modules tm
      JOIN modules m ON m.id = tm.module_id
      WHERE tm.tenant_id = $1
        AND tm.enabled = true
        AND m.status = 'ACTIVE'
      ORDER BY m.code
    `, [license.tenant_id]);

    const release = await pool.query(`
      SELECT version, release_notes, mandatory_update
      FROM releases
      WHERE status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const ownerCapabilities = await pool.query(`
      SELECT capability_code FROM tenant_owner_capabilities
      WHERE tenant_id = $1 AND enabled = true ORDER BY capability_code
    `, [license.tenant_id]);

    res.json({
      valid: true,
      restaurantName: license.restaurant_name,
      restaurantProfile: restaurantProfile(license),
      expiresAt: license.expires_at,
      syncToken: license.sync_token,
      packageCode: license.package_code || null,
      packageName: license.package_name || null,
      enabledModules: modules.rows.map((row) => row.code),
      ownerCapabilities: ownerCapabilities.rows.map((row) => row.capability_code),
      updatePolicy: release.rowCount === 0 ? null : {
        latestVersion: release.rows[0].version,
        minimumVersion: release.rows[0].mandatory_update ? release.rows[0].version : null,
        mandatory: release.rows[0].mandatory_update,
        releaseNotes: release.rows[0].release_notes || ''
      }
    });

  } catch (err) {
    console.error('LICENSE VALIDATE ERROR:', err.message);
    res.status(500).json({
      valid: false,
      message: publicError(err)
    });
  }
});

router.post('/owner-pos-login', async (req, res) => {
  const { restaurantId, email, password } = req.body || {};

  if (!restaurantId || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Restaurant, owner email and password are required'
    });
  }

  try {
    const result = await pool.query(`
      SELECT ou.id, ou.name, ou.email, ou.password_hash, ou.reset_required,
             t.restaurant_code, t.name AS restaurant_name,
             l.status AS license_status, l.expires_at
      FROM owner_users ou
      JOIN restaurant_owners ro ON ro.owner_user_id = ou.id AND ro.active = true
      JOIN tenants t ON t.id = ro.tenant_id
      JOIN licenses l ON l.tenant_id = t.id
      WHERE LOWER(ou.email) = LOWER($1)
        AND ou.active = true
        AND t.restaurant_code = $2
      LIMIT 1
    `, [String(email).trim(), String(restaurantId).trim().toUpperCase()]);

    if (result.rowCount === 0) {
      return res.status(401).json({ success: false, message: 'Invalid owner credentials' });
    }

    const owner = result.rows[0];
    if (!await bcrypt.compare(password, owner.password_hash)) {
      return res.status(401).json({ success: false, message: 'Invalid owner credentials' });
    }
    if (owner.reset_required) {
      return res.status(403).json({
        success: false,
        message: 'Owner password change is required before POS cloud login'
      });
    }
    if (owner.license_status !== 'ACTIVE' || new Date(owner.expires_at).getTime() <= Date.now()) {
      return res.status(403).json({
        success: false,
        message: owner.license_status !== 'ACTIVE' ? 'License is inactive' : 'License has expired'
      });
    }

    res.json({
      success: true,
      token: jwt.sign({ id: owner.id, role: 'OWNER_USER', type: 'OWNER', resetRequired: false }, config.jwtSecret, { expiresIn: '8h' }),
      user: {
        id: `cloud-owner:${owner.id}`,
        name: owner.name,
        username: owner.email,
        role: 'OWNER',
        cloudOwner: true
      },
      restaurant: {
        id: owner.restaurant_code,
        name: owner.restaurant_name
      }
    });
  } catch (err) {
    console.error('OWNER POS LOGIN ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
